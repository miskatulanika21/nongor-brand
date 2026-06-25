-- Stage 2 Pass-2 follow-up: STABLE inventory error codes.
--
-- Problem this fixes
-- ------------------
-- The inventory RPCs previously raised plain-English messages with the default
-- SQLSTATE (P0001). The single-op TS path mapped only constraint SQLSTATEs
-- (23505/23503/23514), so EVERY rule violation collapsed to a generic
-- "Could not complete the change." message — the granular reasons never reached
-- the user. The bulk RPC tried to recover a code via fragile `SQLERRM ILIKE`
-- text matching, which silently breaks if a message is reworded.
--
-- Fix
-- ---
-- Every RAISE now uses a STABLE snake_case CODE as the exception MESSAGE, with
-- the human-readable context in the exception DETAIL. PostgREST surfaces the
-- message as `error.message`, so:
--   * single-op wrappers throw an InventoryError carrying that code, and
--   * bulk_set_inventory forwards the inner code directly (no ILIKE guessing).
-- The TS/UI layer maps codes -> safe messages via inventoryErrorMessage
-- (src/lib/catalog-admin.schema.ts — the single source of truth, shared by the
-- server handlers AND the admin UI).
--
-- Codes are validated downstream against KNOWN_INVENTORY_ERROR_CODES; the bulk
-- handler additionally rejects any non-token value so raw SQL text can never
-- leak into the per-item result JSON.
--
-- This migration is pure CREATE OR REPLACE (privileges + grants preserved); it
-- changes NO behavior other than the error signal.

-- ---------------------------------------------------------------------------
-- 1. api.set_inventory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.set_inventory(
  p_code text, p_size text, p_quantity integer, p_reason text,
  p_note text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
DECLARE
  v_product_id uuid;
  v_prev       integer;
  v_total      integer;
  v_size_count integer;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An acting user is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'Acting user is not an active staff member';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'invalid_quantity' USING DETAIL = 'Quantity must be zero or more';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_reason' USING DETAIL = 'A reason (1-120 chars) is required';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'note_too_long' USING DETAIL = 'Note is too long (max 500)';
  END IF;
  IF p_size IS NOT NULL AND length(p_size) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'invalid_size' USING DETAIL = 'Invalid size';
  END IF;

  SELECT id INTO v_product_id FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING DETAIL = 'Product not found';
  END IF;

  SELECT count(*) INTO v_size_count
    FROM public.product_size_stock WHERE product_id = v_product_id;

  IF v_size_count > 0 THEN
    IF p_size IS NULL THEN
      RAISE EXCEPTION 'variant_required' USING DETAIL = 'This product uses size variants; specify a size';
    END IF;
    SELECT quantity INTO v_prev
      FROM public.product_size_stock
     WHERE product_id = v_product_id AND size = p_size;
    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'variant_not_found' USING DETAIL = format('Unknown size "%s" for this product', p_size);
    END IF;
    IF p_quantity = v_prev THEN
      RAISE EXCEPTION 'no_change' USING DETAIL = format('No change: quantity is already %s', p_quantity);
    END IF;
    UPDATE public.product_size_stock
       SET quantity = p_quantity, updated_at = now()
     WHERE product_id = v_product_id AND size = p_size;
    SELECT coalesce(sum(quantity), 0) INTO v_total
      FROM public.product_size_stock WHERE product_id = v_product_id;
  ELSE
    IF p_size IS NOT NULL THEN
      RAISE EXCEPTION 'variant_not_allowed' USING DETAIL = 'This product has no size variants; omit the size';
    END IF;
    SELECT stock INTO v_prev FROM public.products WHERE id = v_product_id;
    IF p_quantity = v_prev THEN
      RAISE EXCEPTION 'no_change' USING DETAIL = format('No change: quantity is already %s', p_quantity);
    END IF;
    v_total := p_quantity;
  END IF;

  PERFORM set_config('app.allow_stock_write', 'on', true);
  UPDATE public.products SET stock = v_total, updated_at = now() WHERE id = v_product_id;
  PERFORM set_config('app.allow_stock_write', 'off', true);

  INSERT INTO public.product_inventory_movements
    (product_id, size, previous_quantity, new_quantity, delta, reason, note, actor_id)
  VALUES
    (v_product_id, p_size, v_prev, p_quantity, p_quantity - v_prev, btrim(p_reason), p_note, p_actor_id);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id, 'inventory.adjusted', 'products', p_code,
    jsonb_build_object('size', p_size, 'previous', v_prev, 'new', p_quantity, 'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object(
    'code', p_code, 'size', p_size,
    'previous', v_prev, 'new', p_quantity, 'total', v_total
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. api.add_product_variant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.add_product_variant(p_code text, p_size text, p_actor_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
DECLARE v_pid uuid; v_stock integer; v_size_count integer; v_initial integer;
        v_trimmed text; v_final_stock integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;

  v_trimmed := btrim(coalesce(p_size, ''));
  IF length(v_trimmed) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'invalid_size' USING DETAIL = 'Invalid size';
  END IF;

  SELECT id, stock INTO v_pid, v_stock FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING DETAIL = 'Product not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_size_stock WHERE product_id = v_pid AND size = v_trimmed) THEN
    RAISE EXCEPTION 'size_already_exists' USING DETAIL = 'Size already exists';
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
    RAISE EXCEPTION 'internal_error' USING DETAIL = 'Stock invariant violation after variant add';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'inventory.adjusted', 'products', p_code,
          jsonb_build_object('op', CASE WHEN v_size_count = 0 AND v_initial > 0
            THEN 'variant_transfer' ELSE 'variant_added' END,
            'size', v_trimmed, 'initial', v_initial));

  RETURN jsonb_build_object('code', p_code, 'size', v_trimmed, 'initial', v_initial);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. api.remove_product_variant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.remove_product_variant(p_code text, p_size text, p_actor_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
DECLARE
  v_pid uuid; v_qty integer; v_total integer; v_remaining integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;

  SELECT id INTO v_pid FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING DETAIL = 'Product not found';
  END IF;

  SELECT quantity INTO v_qty
    FROM public.product_size_stock WHERE product_id = v_pid AND size = p_size;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'variant_not_found' USING DETAIL = 'Unknown size';
  END IF;
  IF v_qty <> 0 THEN
    RAISE EXCEPTION 'variant_not_empty' USING DETAIL = 'Set the variant stock to 0 before removing it';
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
$function$;

-- ---------------------------------------------------------------------------
-- 4. api.bulk_set_inventory — forward the inner stable code (no ILIKE guessing)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.bulk_set_inventory(p_items jsonb, p_actor_id uuid, p_op_key text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
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
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;
  IF p_op_key IS NULL OR length(btrim(p_op_key)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'op_key_required' USING DETAIL = 'An operation key is required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items_invalid' USING DETAIL = 'items must be an array';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'batch_empty' USING DETAIL = 'Batch must contain at least one item';
  END IF;
  IF v_count > 100 THEN
    RAISE EXCEPTION 'batch_too_large' USING DETAIL = 'Batch size must not exceed 100';
  END IF;

  -- ---- reject duplicate (code, size) targets ----
  SELECT count(*) - count(DISTINCT (e ->> 'code') || '::' || coalesce(e ->> 'size', ''))
    INTO v_dup_check
    FROM jsonb_array_elements(p_items) e;
  IF v_dup_check > 0 THEN
    RAISE EXCEPTION 'duplicate_target' USING DETAIL = 'Duplicate product/size target in batch';
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
    RAISE EXCEPTION 'idempotency_key_reused'
      USING DETAIL = 'This operation key was already used with a different request';
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
      -- api.set_inventory now raises a STABLE snake_case code as the message, so
      -- forward it directly. Constraint SQLSTATEs map to the closest domain code.
      v_err_code := CASE SQLSTATE
        WHEN 'P0001' THEN SQLERRM          -- raise_exception: message IS the code
        WHEN '23514' THEN 'invalid_quantity'  -- check violation
        WHEN '23503' THEN 'product_not_found' -- FK violation
        ELSE 'internal_error'
      END;
      -- Defensive: only a bare snake_case token may pass through; never raw SQL.
      IF v_err_code IS NULL OR v_err_code !~ '^[a-z_]{1,40}$' THEN
        v_err_code := 'internal_error';
      END IF;
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
$function$;
