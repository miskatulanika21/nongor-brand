-- Migration 18: Stage 2 Pass-2 closure — integrity, idempotency, conservation.
-- Version: 20260623240000
--
-- PRECONDITIONS (asserted at run time):
--   inventory_bulk_ops exists, is empty, PK is (op_key), no request_hash column.
--   product_inventory_movements exists, actor_id FK is ON DELETE SET NULL.
--
-- CHANGES:
-- 1. api.purge_product — owner-only permanent delete (maintenance only, no TS exposure).
-- 2. api.reorder_categories — full validation (dup slug/pos, unknown, full-set, affected==submitted).
-- 3. api.add_product_variant — first-variant conserves stock via paired transfer movements.
-- 4. api.remove_product_variant — hardened (stable error codes, stock invariant check).
-- 5. inventory_bulk_ops — actor-scoped idempotency with canonical request hash.
-- 6. api.bulk_set_inventory — advisory lock, hash replay, stable error_code.
-- 7. product_inventory_movements.actor_id FK → ON DELETE RESTRICT.
-- 8. Function grants locked down.

-- ============================================================
-- 0. Precondition assertions
-- ============================================================
DO $$
BEGIN
  -- Assert inventory_bulk_ops is empty (safe for NOT NULL + PK change)
  IF (SELECT count(*) FROM public.inventory_bulk_ops) > 0 THEN
    RAISE EXCEPTION 'Migration 18 blocked: inventory_bulk_ops is not empty';
  END IF;

  -- Assert no request_hash column exists yet
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'inventory_bulk_ops'
       AND column_name = 'request_hash'
  ) THEN
    RAISE EXCEPTION 'Migration 18 blocked: request_hash column already exists';
  END IF;

  -- Assert current PK is single-column op_key (not composite)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid = 'public.inventory_bulk_ops'::regclass
       AND c.contype = 'p'
       AND a.attname = 'op_key'
    HAVING count(*) = 1
  ) THEN
    RAISE EXCEPTION 'Migration 18 blocked: expected single-column PK on op_key';
  END IF;

  -- Assert movement actor FK is currently ON DELETE SET NULL (not already RESTRICT)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.product_inventory_movements'::regclass
       AND conname = 'product_inventory_movements_actor_id_fkey'
       AND confdeltype = 'n' -- 'n' = SET NULL
  ) THEN
    RAISE EXCEPTION 'Migration 18 blocked: movement actor_id FK is not ON DELETE SET NULL as expected';
  END IF;
END
$$;

-- ============================================================
-- 1. Owner-only purge (maintenance, no TS exposure)
-- ============================================================
CREATE OR REPLACE FUNCTION api.purge_product(p_code text, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_pid uuid; v_mov integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles
     WHERE user_id = p_actor_id AND is_active AND role = 'owner'::private.staff_role
  ) THEN
    RAISE EXCEPTION 'Only an active owner may purge products';
  END IF;

  SELECT id INTO v_pid FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT count(*) INTO v_mov FROM public.product_inventory_movements WHERE product_id = v_pid;
  IF v_mov > 0 THEN
    RAISE EXCEPTION 'Cannot purge a product with inventory history (% movement(s)); archive it instead', v_mov;
  END IF;

  -- Audit before delete: if the delete is blocked, this rolls back too.
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'product.purged', 'products', p_code, jsonb_build_object('product_id', v_pid));

  DELETE FROM public.products WHERE id = v_pid;
END;
$$;
REVOKE ALL ON FUNCTION api.purge_product(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.purge_product(text, uuid) TO service_role;

-- ============================================================
-- 2. Hardened reorder — full validation
-- ============================================================
-- Replaces the migration-17 version which had no dup/unknown/full-set checks.
CREATE OR REPLACE FUNCTION api.reorder_categories(p_items jsonb, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submitted integer; v_distinct_slugs integer; v_distinct_pos integer;
  v_existing integer; v_total integer; v_affected integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array';
  END IF;

  SELECT count(*), count(DISTINCT slug), count(DISTINCT sort_order)
    INTO v_submitted, v_distinct_slugs, v_distinct_pos
  FROM (
    SELECT e ->> 'slug' AS slug, (e ->> 'sortOrder')::int AS sort_order
    FROM jsonb_array_elements(p_items) e
  ) t;

  IF v_submitted < 1 OR v_submitted > 500 THEN
    RAISE EXCEPTION 'Invalid reorder batch size';
  END IF;
  IF v_distinct_slugs <> v_submitted THEN
    RAISE EXCEPTION 'Duplicate category in reorder';
  END IF;
  IF v_distinct_pos <> v_submitted THEN
    RAISE EXCEPTION 'Duplicate sort position in reorder';
  END IF;

  -- All submitted slugs must exist
  SELECT count(*) INTO v_existing FROM public.product_categories c
   WHERE c.slug IN (SELECT e ->> 'slug' FROM jsonb_array_elements(p_items) e);
  IF v_existing <> v_submitted THEN
    RAISE EXCEPTION 'Unknown category in reorder';
  END IF;

  -- Full-set contract: every category must be submitted
  SELECT count(*) INTO v_total FROM public.product_categories;
  IF v_submitted <> v_total THEN
    RAISE EXCEPTION 'Reorder must include all % categories (got %)', v_total, v_submitted;
  END IF;

  UPDATE public.product_categories c
     SET sort_order = x.sort_order, updated_at = now()
    FROM (
      SELECT e ->> 'slug' AS slug, (e ->> 'sortOrder')::int AS sort_order
      FROM jsonb_array_elements(p_items) e
    ) x
   WHERE c.slug = x.slug;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> v_submitted THEN
    RAISE EXCEPTION 'Reorder affected % of % rows', v_affected, v_submitted;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, metadata)
  VALUES (p_actor_id, 'category.reordered', 'product_categories', jsonb_build_object('count', v_submitted));
END;
$$;
REVOKE ALL ON FUNCTION api.reorder_categories(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.reorder_categories(jsonb, uuid) TO service_role;

-- ============================================================
-- 3. First-variant stock conservation
-- ============================================================
-- When the first size is added to an unsized product with stock N:
--   product-level transfer-out: N → 0, delta -N (variant_transfer_out)
--   size-level transfer-in:    0 → N, delta +N (variant_transfer_in)
--   net delta: 0
--   products.stock stays N = sum(size quantities)
-- When N = 0: insert at 0, single variant_added movement with delta 0.
CREATE OR REPLACE FUNCTION api.add_product_variant(p_code text, p_size text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_pid uuid; v_stock integer; v_size_count integer; v_initial integer;
        v_trimmed text; v_final_stock integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;

  v_trimmed := btrim(coalesce(p_size, ''));
  IF length(v_trimmed) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Invalid size';
  END IF;

  SELECT id, stock INTO v_pid, v_stock FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_size_stock WHERE product_id = v_pid AND size = v_trimmed) THEN
    RAISE EXCEPTION 'Size already exists';
  END IF;

  SELECT count(*) INTO v_size_count FROM public.product_size_stock WHERE product_id = v_pid;

  IF v_size_count = 0 THEN
    -- First variant: transfer existing product-level stock into the new size.
    v_initial := v_stock;

    INSERT INTO public.product_size_stock (product_id, size, quantity)
    VALUES (v_pid, v_trimmed, v_initial);

    IF v_initial > 0 THEN
      -- Transfer-out: product-level stock goes from N to 0
      INSERT INTO public.product_inventory_movements
        (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
      VALUES (v_pid, NULL, v_initial, 0, -v_initial, 'variant_transfer_out', p_actor_id);

      -- Transfer-in: size-level stock goes from 0 to N
      INSERT INTO public.product_inventory_movements
        (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
      VALUES (v_pid, v_trimmed, 0, v_initial, v_initial, 'variant_transfer_in', p_actor_id);
    ELSE
      -- Zero stock: simple add, no misleading movements
      INSERT INTO public.product_inventory_movements
        (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
      VALUES (v_pid, v_trimmed, 0, 0, 0, 'variant_added', p_actor_id);
    END IF;
  ELSE
    -- Additional variant: starts at zero, no stock transfer
    v_initial := 0;
    INSERT INTO public.product_size_stock (product_id, size, quantity)
    VALUES (v_pid, v_trimmed, 0);

    INSERT INTO public.product_inventory_movements
      (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
    VALUES (v_pid, v_trimmed, 0, 0, 0, 'variant_added', p_actor_id);
  END IF;

  -- Recalculate and set products.stock = sum(size quantities)
  SELECT coalesce(sum(quantity), 0) INTO v_final_stock
    FROM public.product_size_stock WHERE product_id = v_pid;
  PERFORM set_config('app.allow_stock_write', 'on', true);
  UPDATE public.products SET stock = v_final_stock, updated_at = now() WHERE id = v_pid;
  PERFORM set_config('app.allow_stock_write', 'off', true);

  -- Verify invariant
  IF v_final_stock <> (SELECT stock FROM public.products WHERE id = v_pid) THEN
    RAISE EXCEPTION 'Stock invariant violation after variant add';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'inventory.adjusted', 'products', p_code,
          jsonb_build_object('op', CASE WHEN v_size_count = 0 AND v_initial > 0
            THEN 'variant_transfer' ELSE 'variant_added' END,
            'size', v_trimmed, 'initial', v_initial));

  RETURN jsonb_build_object('code', p_code, 'size', v_trimmed, 'initial', v_initial);
END;
$$;
REVOKE ALL ON FUNCTION api.add_product_variant(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.add_product_variant(text, text, uuid) TO service_role;

-- ============================================================
-- 4. Hardened remove_product_variant
-- ============================================================
-- Removing the last variant (at qty 0) converts the product back to unsized at stock 0.
CREATE OR REPLACE FUNCTION api.remove_product_variant(p_code text, p_size text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pid uuid; v_qty integer; v_total integer; v_remaining integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;

  SELECT id INTO v_pid FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT quantity INTO v_qty
    FROM public.product_size_stock WHERE product_id = v_pid AND size = p_size;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'Unknown size';
  END IF;
  IF v_qty <> 0 THEN
    RAISE EXCEPTION 'Set the variant stock to 0 before removing it';
  END IF;

  INSERT INTO public.product_inventory_movements
    (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
  VALUES (v_pid, p_size, 0, 0, 0, 'variant_removed', p_actor_id);

  DELETE FROM public.product_size_stock WHERE product_id = v_pid AND size = p_size;

  SELECT coalesce(sum(quantity), 0) INTO v_total
    FROM public.product_size_stock WHERE product_id = v_pid;
  SELECT count(*) INTO v_remaining
    FROM public.product_size_stock WHERE product_id = v_pid;

  PERFORM set_config('app.allow_stock_write', 'on', true);
  UPDATE public.products SET stock = v_total, updated_at = now() WHERE id = v_pid;
  PERFORM set_config('app.allow_stock_write', 'off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'inventory.adjusted', 'products', p_code,
          jsonb_build_object('op', 'variant_removed', 'size', p_size,
                             'remaining_variants', v_remaining));

  RETURN jsonb_build_object('code', p_code, 'size', p_size, 'total', v_total);
END;
$$;
REVOKE ALL ON FUNCTION api.remove_product_variant(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.remove_product_variant(text, text, uuid) TO service_role;

-- ============================================================
-- 5. Harden inventory_bulk_ops schema
-- ============================================================
-- Table is verified empty: safe to restructure.
ALTER TABLE public.inventory_bulk_ops DROP CONSTRAINT inventory_bulk_ops_pkey;
ALTER TABLE public.inventory_bulk_ops DROP CONSTRAINT inventory_bulk_ops_actor_id_fkey;

ALTER TABLE public.inventory_bulk_ops ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE public.inventory_bulk_ops ADD COLUMN request_hash text NOT NULL;
ALTER TABLE public.inventory_bulk_ops
  ADD CONSTRAINT inventory_bulk_ops_pkey PRIMARY KEY (actor_id, op_key);
ALTER TABLE public.inventory_bulk_ops
  ADD CONSTRAINT inventory_bulk_ops_actor_id_fkey FOREIGN KEY (actor_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
-- Validation constraints
ALTER TABLE public.inventory_bulk_ops
  ADD CONSTRAINT bulk_ops_op_key_bounded CHECK (length(btrim(op_key)) BETWEEN 1 AND 100);
ALTER TABLE public.inventory_bulk_ops
  ADD CONSTRAINT bulk_ops_hash_bounded CHECK (length(btrim(request_hash)) BETWEEN 1 AND 256);
COMMENT ON TABLE public.inventory_bulk_ops IS
  'Idempotency cache for bulk inventory operations. Keyed by (actor_id, op_key) with a canonical request hash; replays with the same hash return the stored result, different hash rejects. ON DELETE CASCADE: user removal clears the cache (permanent audit is in audit_logs).';

-- ============================================================
-- 6. Hardened api.bulk_set_inventory
-- ============================================================
CREATE OR REPLACE FUNCTION api.bulk_set_inventory(
  p_items jsonb, p_actor_id uuid, p_op_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer; v_item jsonb; v_results jsonb := '[]'::jsonb;
  v_ok integer := 0; v_failed integer := 0;
  v_existing jsonb; v_existing_hash text; v_hash text; v_summary jsonb;
  v_canonical jsonb; v_dup_check integer;
  v_err_code text;
BEGIN
  -- ---- basic validation ----
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF p_op_key IS NULL OR length(btrim(p_op_key)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'An operation key is required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'Batch must contain at least one item';
  END IF;
  IF v_count > 100 THEN
    RAISE EXCEPTION 'Batch size must not exceed 100';
  END IF;

  -- ---- reject duplicate (code, size) targets ----
  SELECT count(*) - count(DISTINCT (e ->> 'code') || '::' || coalesce(e ->> 'size', ''))
    INTO v_dup_check
    FROM jsonb_array_elements(p_items) e;
  IF v_dup_check > 0 THEN
    RAISE EXCEPTION 'Duplicate product/size target in batch';
  END IF;

  -- ---- advisory lock: serialize concurrent calls for (actor, key) ----
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_actor_id::text || ':' || btrim(p_op_key), 0)
  );

  -- ---- canonical request hash ----
  SELECT jsonb_agg(
    jsonb_build_object(
      'code', e ->> 'code',
      'size', coalesce(NULLIF(e ->> 'size', ''), null),
      'quantity', (e ->> 'quantity')::integer,
      'reason', coalesce(NULLIF(btrim(e ->> 'reason'), ''), 'Bulk update')
    ) ORDER BY e ->> 'code', coalesce(e ->> 'size', '')
  ) INTO v_canonical
  FROM jsonb_array_elements(p_items) e;
  v_hash := md5(v_canonical::text);

  -- ---- idempotency check (after lock) ----
  SELECT result, request_hash INTO v_existing, v_existing_hash
    FROM public.inventory_bulk_ops
   WHERE actor_id = p_actor_id AND op_key = btrim(p_op_key);

  IF v_existing IS NOT NULL THEN
    IF v_existing_hash = v_hash THEN
      -- Identical replay: return stored result with replayed flag
      RETURN v_existing || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'This operation key was already used with a different request';
  END IF;

  -- ---- process each item through the approved RPC ----
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      PERFORM api.set_inventory(
        v_item ->> 'code', NULLIF(v_item ->> 'size', ''),
        (v_item ->> 'quantity')::integer,
        coalesce(NULLIF(btrim(v_item ->> 'reason'), ''), 'Bulk update'),
        v_item ->> 'note', p_actor_id);
      v_ok := v_ok + 1;
      v_results := v_results || jsonb_build_object(
        'code', v_item ->> 'code', 'size', v_item ->> 'size', 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      -- Map SQLSTATE to a stable domain error_code, never expose raw messages
      v_err_code := CASE SQLSTATE
        WHEN 'P0001' THEN -- raise_exception
          CASE
            WHEN SQLERRM ILIKE '%not found%' THEN 'product_not_found'
            WHEN SQLERRM ILIKE '%size variant%' THEN 'variant_required'
            WHEN SQLERRM ILIKE '%no size variant%' THEN 'variant_not_allowed'
            WHEN SQLERRM ILIKE '%Unknown size%' THEN 'variant_not_found'
            WHEN SQLERRM ILIKE '%already%' THEN 'no_change'
            WHEN SQLERRM ILIKE '%negative%' THEN 'invalid_quantity'
            WHEN SQLERRM ILIKE '%reason%' THEN 'invalid_reason'
            ELSE 'internal_error'
          END
        WHEN '23514' THEN 'invalid_quantity'   -- check violation
        WHEN '23503' THEN 'product_not_found'  -- FK violation
        ELSE 'internal_error'
      END;
      v_results := v_results || jsonb_build_object(
        'code', v_item ->> 'code', 'size', v_item ->> 'size',
        'ok', false, 'error_code', v_err_code);
    END;
  END LOOP;

  v_summary := jsonb_build_object(
    'op_key', btrim(p_op_key), 'replayed', false,
    'count', v_count, 'ok', v_ok, 'failed', v_failed, 'results', v_results);

  INSERT INTO public.audit_logs (actor_id, action, target_type, metadata)
  VALUES (p_actor_id, 'inventory.bulk_adjusted', 'products',
          jsonb_build_object('op_key', btrim(p_op_key), 'count', v_count, 'ok', v_ok, 'failed', v_failed));

  INSERT INTO public.inventory_bulk_ops (op_key, actor_id, request_hash, result)
  VALUES (btrim(p_op_key), p_actor_id, v_hash, v_summary);

  RETURN v_summary;
END;
$$;
REVOKE ALL ON FUNCTION api.bulk_set_inventory(jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.bulk_set_inventory(jsonb, uuid, text) TO service_role;

-- ============================================================
-- 7. Fix movement actor FK: SET NULL → RESTRICT
-- ============================================================
-- Staff with inventory history are deactivated rather than hard-deleted.
-- Historical movement attribution is preserved. ON DELETE SET NULL would
-- conflict with the append-only trigger (which blocks UPDATE/DELETE).
ALTER TABLE public.product_inventory_movements
  DROP CONSTRAINT product_inventory_movements_actor_id_fkey;
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.product_inventory_movements.actor_id IS
  'Staff who performed the adjustment. FK RESTRICT: actors with history are deactivated, not deleted. The append-only trigger would reject the SET NULL cascade anyway.';

-- ============================================================
-- 8. Explicit grant lockdown for all sensitive api functions
-- ============================================================
-- set_inventory: already restricted by migration 15, restate for clarity
REVOKE ALL ON FUNCTION api.set_inventory(text, text, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_inventory(text, text, integer, text, text, uuid)
  TO service_role;
