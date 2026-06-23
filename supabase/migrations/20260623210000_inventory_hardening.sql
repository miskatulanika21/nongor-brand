-- Migration 15: Inventory integrity, immutability, concurrency & enforcement.
-- Version: 20260623210000
--
-- Hardens the Stage 2 inventory ledger so stock is genuinely canonical:
--   * products.stock can ONLY change through the approved inventory RPC
--     (a DB trigger rejects any other UPDATE that changes stock).
--   * the movement ledger is append-only (UPDATE/DELETE blocked by trigger) and
--     product deletion is blocked while history exists (FK RESTRICT).
--   * api.set_inventory now locks the product row (serializing concurrent
--     adjustments), requires an active privileged actor, enforces sized vs
--     non-sized invariants, refuses to invent size rows, rejects zero-delta and
--     out-of-bounds inputs.
--   * sizes are created/removed only through dedicated variant-management RPCs.

-- ============================================================
-- 1. Preserve history: product FK RESTRICT (was CASCADE)
-- ============================================================
ALTER TABLE public.product_inventory_movements
  DROP CONSTRAINT product_inventory_movements_product_id_fkey;
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

-- ============================================================
-- 2. Integrity constraints on the ledger
-- ============================================================
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT inv_mov_prev_nonneg CHECK (previous_quantity >= 0),
  ADD CONSTRAINT inv_mov_delta_consistent CHECK (delta = new_quantity - previous_quantity),
  ADD CONSTRAINT inv_mov_reason_bounded CHECK (length(btrim(reason)) BETWEEN 1 AND 120),
  ADD CONSTRAINT inv_mov_note_bounded CHECK (note IS NULL OR length(note) <= 500),
  ADD CONSTRAINT inv_mov_size_bounded CHECK (size IS NULL OR length(size) BETWEEN 1 AND 40);
-- actor_id is required at WRITE time (enforced in the RPC). The column stays
-- nullable so ON DELETE SET NULL can preserve a movement row if the acting user
-- is ever hard-deleted (attribution lost, history retained) — we never want user
-- lifecycle to delete ledger rows.

-- ============================================================
-- 3. Append-only ledger: block UPDATE/DELETE
-- ============================================================
CREATE OR REPLACE FUNCTION private.prevent_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'product_inventory_movements is append-only (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_mov_immutable ON public.product_inventory_movements;
CREATE TRIGGER trg_inv_mov_immutable
  BEFORE UPDATE OR DELETE ON public.product_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_movement_mutation();

-- ============================================================
-- 4. products.stock write guard — only via approved inventory context
-- ============================================================
-- Any UPDATE that changes products.stock is rejected unless the transaction-local
-- GUC app.allow_stock_write='on' has been set by an approved inventory RPC. This
-- makes the inventory ledger the single legal stock-write path at the DB level.
-- NOTE: a re-seed/bulk maintenance script must set the same GUC if it writes stock.
CREATE OR REPLACE FUNCTION private.guard_products_stock_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock
     AND coalesce(current_setting('app.allow_stock_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Direct products.stock writes are not allowed; use api.set_inventory';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_stock_guard ON public.products;
CREATE TRIGGER trg_products_stock_guard
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.guard_products_stock_write();

-- ============================================================
-- 5. Hardened api.set_inventory (CREATE OR REPLACE keeps grants)
-- ============================================================
CREATE OR REPLACE FUNCTION api.set_inventory(
  p_code     text,
  p_size     text,
  p_quantity integer,
  p_reason   text,
  p_note     text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_prev       integer;
  v_total      integer;
  v_size_count integer;
BEGIN
  -- ---- validation ----
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'An acting user is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Acting user is not an active staff member';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'Quantity must be zero or more';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A reason (1-120 chars) is required';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long (max 500)';
  END IF;
  IF p_size IS NOT NULL AND length(p_size) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Invalid size';
  END IF;

  -- ---- lock the product row: serializes ALL adjustments for this product ----
  SELECT id INTO v_product_id FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT count(*) INTO v_size_count
    FROM public.product_size_stock WHERE product_id = v_product_id;

  -- ---- enforce sized vs non-sized; never invent size rows ----
  IF v_size_count > 0 THEN
    IF p_size IS NULL THEN
      RAISE EXCEPTION 'This product uses size variants; specify a size';
    END IF;
    SELECT quantity INTO v_prev
      FROM public.product_size_stock
     WHERE product_id = v_product_id AND size = p_size;
    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'Unknown size "%" for this product', p_size;
    END IF;
    IF p_quantity = v_prev THEN
      RAISE EXCEPTION 'No change: quantity is already %', p_quantity;
    END IF;
    UPDATE public.product_size_stock
       SET quantity = p_quantity, updated_at = now()
     WHERE product_id = v_product_id AND size = p_size;
    SELECT coalesce(sum(quantity), 0) INTO v_total
      FROM public.product_size_stock WHERE product_id = v_product_id;
  ELSE
    IF p_size IS NOT NULL THEN
      RAISE EXCEPTION 'This product has no size variants; omit the size';
    END IF;
    SELECT stock INTO v_prev FROM public.products WHERE id = v_product_id;
    IF p_quantity = v_prev THEN
      RAISE EXCEPTION 'No change: quantity is already %', p_quantity;
    END IF;
    v_total := p_quantity;
  END IF;

  -- ---- apply to products.stock through the approved context ----
  PERFORM set_config('app.allow_stock_write', 'on', true);
  UPDATE public.products SET stock = v_total, updated_at = now() WHERE id = v_product_id;
  PERFORM set_config('app.allow_stock_write', 'off', true);

  -- ---- ledger + canonical audit (same transaction) ----
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
$$;

REVOKE ALL ON FUNCTION api.set_inventory(text, text, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_inventory(text, text, integer, text, text, uuid)
  TO service_role;

-- ============================================================
-- 6. Controlled variant management (the only way to create/remove sizes)
-- ============================================================
CREATE OR REPLACE FUNCTION api.add_product_variant(
  p_code     text,
  p_size     text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF length(btrim(coalesce(p_size, ''))) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Invalid size';
  END IF;

  SELECT id INTO v_product_id FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_size_stock WHERE product_id = v_product_id AND size = btrim(p_size)) THEN
    RAISE EXCEPTION 'Size already exists';
  END IF;

  INSERT INTO public.product_size_stock (product_id, size, quantity)
  VALUES (v_product_id, btrim(p_size), 0);

  INSERT INTO public.product_inventory_movements
    (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
  VALUES (v_product_id, btrim(p_size), 0, 0, 0, 'variant_added', p_actor_id);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'inventory.adjusted', 'products', p_code,
          jsonb_build_object('op', 'variant_added', 'size', btrim(p_size)));

  RETURN jsonb_build_object('code', p_code, 'size', btrim(p_size));
END;
$$;

REVOKE ALL ON FUNCTION api.add_product_variant(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.add_product_variant(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION api.remove_product_variant(
  p_code     text,
  p_size     text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_qty integer;
  v_total integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;

  SELECT id INTO v_product_id FROM public.products WHERE code = p_code FOR UPDATE;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  SELECT quantity INTO v_qty
    FROM public.product_size_stock WHERE product_id = v_product_id AND size = p_size;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'Unknown size';
  END IF;
  IF v_qty <> 0 THEN
    RAISE EXCEPTION 'Set the variant stock to 0 before removing it';
  END IF;

  INSERT INTO public.product_inventory_movements
    (product_id, size, previous_quantity, new_quantity, delta, reason, actor_id)
  VALUES (v_product_id, p_size, 0, 0, 0, 'variant_removed', p_actor_id);

  DELETE FROM public.product_size_stock WHERE product_id = v_product_id AND size = p_size;

  SELECT coalesce(sum(quantity), 0) INTO v_total
    FROM public.product_size_stock WHERE product_id = v_product_id;
  PERFORM set_config('app.allow_stock_write', 'on', true);
  UPDATE public.products SET stock = v_total, updated_at = now() WHERE id = v_product_id;
  PERFORM set_config('app.allow_stock_write', 'off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'inventory.adjusted', 'products', p_code,
          jsonb_build_object('op', 'variant_removed', 'size', p_size));

  RETURN jsonb_build_object('code', p_code, 'size', p_size, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION api.remove_product_variant(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.remove_product_variant(text, text, uuid) TO service_role;
