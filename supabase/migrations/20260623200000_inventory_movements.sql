-- Migration 14: Inventory movements ledger + atomic set_inventory RPC.
-- Version: 20260623200000
--
-- Makes stock changes canonical and auditable. Every adjustment is recorded as
-- an append-only row in product_inventory_movements AND applied to the live
-- quantity (per-size or product-level) AND written to audit_logs — all inside a
-- single transaction via api.set_inventory, so a movement, its stock effect and
-- its audit record can never diverge (same guarantee as the staff RPCs).
--
-- For sized products, products.stock is kept equal to the sum of size quantities
-- (the public read path already treats the size sum as canonical when size rows
-- exist; this keeps the products.stock projection consistent for the admin list).

-- ============================================================
-- 1. Append-only movement ledger
-- ============================================================
CREATE TABLE public.product_inventory_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size              text,                                   -- NULL = product-level (non-sized)
  previous_quantity integer NOT NULL,
  new_quantity      integer NOT NULL CHECK (new_quantity >= 0),
  delta             integer NOT NULL,
  reason            text NOT NULL,
  note              text,
  actor_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.product_inventory_movements IS
  'Append-only stock ledger. One row per quantity change (product-level or per size). Written only by api.set_inventory.';
CREATE INDEX idx_inv_mov_product_created
  ON public.product_inventory_movements (product_id, created_at DESC);

-- Private: admin-only through the service role. The ensure_rls event trigger also
-- enables RLS on new public tables; we enable it explicitly and add NO policy, so
-- anon/authenticated get nothing and service_role bypasses RLS.
ALTER TABLE public.product_inventory_movements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. api.set_inventory — atomic adjust + ledger + audit
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
BEGIN
  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'Quantity cannot be negative';
  END IF;

  SELECT id INTO v_product_id FROM public.products WHERE code = p_code;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF p_size IS NOT NULL AND length(p_size) > 0 THEN
    SELECT quantity INTO v_prev
      FROM public.product_size_stock
     WHERE product_id = v_product_id AND size = p_size;
    IF v_prev IS NULL THEN
      v_prev := 0;
      INSERT INTO public.product_size_stock (product_id, size, quantity)
      VALUES (v_product_id, p_size, p_quantity);
    ELSE
      UPDATE public.product_size_stock
         SET quantity = p_quantity, updated_at = now()
       WHERE product_id = v_product_id AND size = p_size;
    END IF;
    -- keep products.stock consistent with the size sum
    SELECT coalesce(sum(quantity), 0) INTO v_total
      FROM public.product_size_stock WHERE product_id = v_product_id;
    UPDATE public.products SET stock = v_total, updated_at = now() WHERE id = v_product_id;
  ELSE
    SELECT stock INTO v_prev FROM public.products WHERE id = v_product_id;
    UPDATE public.products SET stock = p_quantity, updated_at = now() WHERE id = v_product_id;
    v_total := p_quantity;
  END IF;

  INSERT INTO public.product_inventory_movements
    (product_id, size, previous_quantity, new_quantity, delta, reason, note, actor_id)
  VALUES
    (v_product_id, p_size, v_prev, p_quantity, p_quantity - v_prev, p_reason, p_note, p_actor_id);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id, 'inventory.adjusted', 'products', p_code,
    jsonb_build_object('size', p_size, 'previous', v_prev, 'new', p_quantity, 'reason', p_reason)
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
