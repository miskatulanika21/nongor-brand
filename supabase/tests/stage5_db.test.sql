-- Stage 5 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty).
--
-- §audit covers api.list_audit_logs (the owner-only read RPC that surfaces the
-- real audit trail on the admin Audit Logs page):
--   * grant posture: service-role only (anon/authenticated hold no EXECUTE)
--   * owner-only: owner succeeds; admin / non-staff / null → actor_not_authorized
--   * actor resolution: actor_id → email (auth.users) + display_name + role
--     (staff_profiles), resolved SQL-side inside the SECURITY DEFINER fn
--   * newest-first ordering, total count, filtering (action / search / date),
--     and limit/offset pagination
--
-- Conventions (same as pass2/pass3/pass4/stage4): expected-SUCCESS runs plainly;
-- expected-FAILURE flips a flag inside a sub-block and RAISE 'FAIL:' if the call
-- did NOT raise (or raised the wrong code); value checks RAISE 'FAIL:' on a
-- violated invariant.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),  -- owner
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),  -- admin
  ('00000000-0000-0000-0000-0000000000c1', 'cust@test.local');   -- non-staff

INSERT INTO public.staff_profiles (user_id, role, is_active, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner', true, 'Owner One'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', true, 'Admin Two');

INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'product.created', 'product', 'PRD-1',
     '{"name":"Kurti Test"}'::jsonb, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000a1', 'shipment.booked', 'shipment', 'SHP-1',
     '{"provider":"steadfast"}'::jsonb, now() - interval '2 days'),
  (NULL, 'order.transition', 'order', 'NGR-1',
     '{"from":"confirmed","to":"processing"}'::jsonb, now() - interval '10 minutes');

-- ============================================================
-- §audit-1 — grant posture: service-role only
-- ============================================================
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r,
      'api.list_audit_logs(uuid,text,text,uuid,timestamptz,timestamptz,text,integer,integer)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on api.list_audit_logs', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role',
    'api.list_audit_logs(uuid,text,text,uuid,timestamptz,timestamptz,text,integer,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role must hold EXECUTE on api.list_audit_logs';
  END IF;
END $$;

-- ============================================================
-- §audit-2 — owner-only authorization
-- ============================================================
-- owner: allowed
DO $$
DECLARE v jsonb;
BEGIN
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1');
  IF (v->>'total')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: owner expected total 3, got %', v->>'total';
  END IF;
END $$;

-- admin / non-staff / null: rejected with actor_not_authorized
DO $$
DECLARE v_raised boolean; a uuid;
BEGIN
  FOREACH a IN ARRAY ARRAY[
    '00000000-0000-0000-0000-0000000000a2'::uuid,  -- admin
    '00000000-0000-0000-0000-0000000000c1'::uuid,  -- non-staff customer
    '00000000-0000-0000-0000-000000000099'::uuid   -- unknown
  ] LOOP
    v_raised := false;
    BEGIN
      PERFORM api.list_audit_logs(p_actor := a);
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
      IF SQLERRM <> 'actor_not_authorized' THEN
        RAISE EXCEPTION 'FAIL: expected actor_not_authorized for %, got %', a, SQLERRM;
      END IF;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'FAIL: actor % was allowed to read audit logs', a;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- §audit-3 — actor resolution + newest-first ordering
-- ============================================================
DO $$
DECLARE v jsonb; first jsonb; prod jsonb;
BEGIN
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1');

  -- newest first: order.transition (10 min ago) leads
  first := v->'rows'->0;
  IF (first->>'action') <> 'order.transition' THEN
    RAISE EXCEPTION 'FAIL: newest-first expected order.transition, got %', first->>'action';
  END IF;
  -- system actor resolves to NULL identity (no email/name)
  IF (first->>'actor_id') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: system row actor_id should be null';
  END IF;

  -- find the product.created row and check resolution
  SELECT elem INTO prod
    FROM jsonb_array_elements(v->'rows') elem
   WHERE elem->>'action' = 'product.created';
  IF (prod->>'actor_email') <> 'owner@test.local' THEN
    RAISE EXCEPTION 'FAIL: actor_email not resolved, got %', prod->>'actor_email';
  END IF;
  IF (prod->>'actor_name') <> 'Owner One' THEN
    RAISE EXCEPTION 'FAIL: actor_name not resolved, got %', prod->>'actor_name';
  END IF;
  IF (prod->>'actor_role') <> 'owner' THEN
    RAISE EXCEPTION 'FAIL: actor_role not resolved, got %', prod->>'actor_role';
  END IF;
END $$;

-- ============================================================
-- §audit-4 — filtering: action / search / date range
-- ============================================================
DO $$
DECLARE v jsonb;
BEGIN
  -- action filter
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_action := 'shipment.booked');
  IF (v->>'total')::int <> 1 THEN RAISE EXCEPTION 'FAIL: action filter total, got %', v->>'total'; END IF;

  -- search over metadata
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_search := 'steadfast');
  IF (v->>'total')::int <> 1 THEN RAISE EXCEPTION 'FAIL: metadata search total, got %', v->>'total'; END IF;

  -- search over actor email → both owner rows
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_search := 'owner@test');
  IF (v->>'total')::int <> 2 THEN RAISE EXCEPTION 'FAIL: email search total, got %', v->>'total'; END IF;

  -- date lower bound excludes the 2-days-ago shipment row
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_from := now() - interval '1 day');
  IF (v->>'total')::int <> 2 THEN RAISE EXCEPTION 'FAIL: date-from total, got %', v->>'total'; END IF;
END $$;

-- ============================================================
-- §audit-5 — pagination (limit/offset with full total)
-- ============================================================
DO $$
DECLARE v jsonb;
BEGIN
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_limit := 1, p_offset := 0);
  IF jsonb_array_length(v->'rows') <> 1 THEN RAISE EXCEPTION 'FAIL: limit 1 rows length'; END IF;
  IF (v->>'total')::int <> 3 THEN RAISE EXCEPTION 'FAIL: total ignores paging, got %', v->>'total'; END IF;

  -- offset past the end → empty rows, total intact
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_limit := 10, p_offset := 10);
  IF jsonb_array_length(v->'rows') <> 0 THEN RAISE EXCEPTION 'FAIL: offset past end not empty'; END IF;
  IF (v->>'total')::int <> 3 THEN RAISE EXCEPTION 'FAIL: total after offset, got %', v->>'total'; END IF;
END $$;

ROLLBACK;
