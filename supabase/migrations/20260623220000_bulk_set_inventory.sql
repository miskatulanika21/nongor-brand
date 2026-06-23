-- Migration 16: Bounded, idempotent bulk inventory adjustment.
-- Version: 20260623220000
--
-- Replaces the browser-side Promise.all fan-out (one request, one auth + one
-- rate-limit charge per item, no atomicity, retry-duplicates) with a single
-- server RPC:
--   * bounded batch (1..100 items)
--   * one authorization + one rate-limit charge (enforced by the server handler)
--   * idempotency: a client-supplied op_key is recorded; a replay returns the
--     stored result without re-applying anything
--   * STRUCTURED partial-success: each item runs in its own savepoint, so a bad
--     item is reported (code/size/error) without aborting the others
--   * every per-item change still flows through api.set_inventory, so all the
--     integrity guards (lock, actor, sized/non-sized, ledger, audit) apply
--   * one summary audit row (inventory.bulk_adjusted)

CREATE TABLE public.inventory_bulk_ops (
  op_key     text PRIMARY KEY,
  actor_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_bulk_ops IS
  'Idempotency ledger for bulk inventory operations. Keyed by client op_key; a replay returns the stored result.';
-- Private: admin/service-role only (RLS on, no policy).
ALTER TABLE public.inventory_bulk_ops ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION api.bulk_set_inventory(
  p_items    jsonb,
  p_actor_id uuid,
  p_op_key   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count   integer;
  v_item    jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ok      integer := 0;
  v_failed  integer := 0;
  v_existing jsonb;
  v_summary jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF p_op_key IS NULL OR length(btrim(p_op_key)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'An operation key is required';
  END IF;

  -- Idempotent replay: return the stored result, re-applying nothing.
  SELECT result INTO v_existing FROM public.inventory_bulk_ops WHERE op_key = p_op_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 100 THEN
    RAISE EXCEPTION 'Batch size must be between 1 and 100';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      PERFORM api.set_inventory(
        v_item ->> 'code',
        NULLIF(v_item ->> 'size', ''),
        (v_item ->> 'quantity')::integer,
        coalesce(NULLIF(btrim(v_item ->> 'reason'), ''), 'Bulk update'),
        v_item ->> 'note',
        p_actor_id
      );
      v_ok := v_ok + 1;
      v_results := v_results || jsonb_build_object(
        'code', v_item ->> 'code', 'size', v_item ->> 'size', 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object(
        'code', v_item ->> 'code', 'size', v_item ->> 'size', 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;

  v_summary := jsonb_build_object(
    'op_key', p_op_key, 'count', v_count, 'ok', v_ok, 'failed', v_failed, 'results', v_results);

  INSERT INTO public.audit_logs (actor_id, action, target_type, metadata)
  VALUES (p_actor_id, 'inventory.bulk_adjusted', 'products',
          jsonb_build_object('op_key', p_op_key, 'count', v_count, 'ok', v_ok, 'failed', v_failed));

  INSERT INTO public.inventory_bulk_ops (op_key, actor_id, result)
  VALUES (p_op_key, p_actor_id, v_summary);

  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION api.bulk_set_inventory(jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.bulk_set_inventory(jsonb, uuid, text) TO service_role;
