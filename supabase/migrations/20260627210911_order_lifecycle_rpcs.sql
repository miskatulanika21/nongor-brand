-- Stage 3 Pass 4 — Order lifecycle RPCs + payment evidence.
-- Part: payments status CHECK update + helper functions.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','submitted','verified','rejected'));

CREATE OR REPLACE FUNCTION private.consume_reservations(
  p_order_id uuid,
  p_actor    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE r record; v_current_stock integer; v_size text; v_new_qty integer;
BEGIN
  FOR r IN
    SELECT ir.id, ir.product_id, ir.variant_size, ir.qty, p.stock
      FROM public.inventory_reservations ir
      JOIN public.products p ON p.id = ir.product_id
     WHERE ir.order_id = p_order_id AND ir.status = 'active'
     ORDER BY ir.product_id, COALESCE(ir.variant_size, '')
       FOR UPDATE OF ir
  LOOP
    v_size := r.variant_size;
    IF v_size IS NOT NULL THEN
      SELECT stock INTO v_current_stock
        FROM public.product_variants
       WHERE product_id = r.product_id AND size = v_size;
      v_current_stock := COALESCE(v_current_stock, 0);
    ELSE
      v_current_stock := COALESCE(r.stock, 0);
    END IF;
    v_new_qty := v_current_stock - r.qty;
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'insufficient_stock_at_confirm'
        USING DETAIL = 'product_id=' || r.product_id || ' size=' || COALESCE(v_size, 'none')
                       || ' stock=' || v_current_stock || ' reserved=' || r.qty;
    END IF;
    PERFORM api.set_inventory(
      p_product_id := r.product_id,
      p_size       := v_size,
      p_new_qty    := v_new_qty,
      p_actor_id   := p_actor,
      p_reason     := 'sale'
    );
    UPDATE public.inventory_reservations SET status = 'consumed' WHERE id = r.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.release_reservations(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.inventory_reservations
     SET status = 'released'
   WHERE order_id = p_order_id AND status = 'active';
END;
$$;
