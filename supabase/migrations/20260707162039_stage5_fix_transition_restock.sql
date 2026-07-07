-- Stage 5 hotfix: fix transition_order restock branch.
--
-- The Stage 5 migration replaced transition_order but used wrong parameter
-- names for api.set_inventory (p_product_id/p_new_qty instead of p_code/p_quantity),
-- referenced a non-existent product_variants table instead of product_size_stock,
-- dropped the Custom-size skip, and dropped the payment_rejected retry window refresh.
-- This migration restores the correct logic from the pre-Stage-5 version while
-- keeping the new courier_booked/delivery_failed transition rules.

CREATE OR REPLACE FUNCTION api.transition_order(
  p_order_id         uuid,
  p_to_status        text,
  p_actor            uuid,
  p_reason           text    DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_restock          boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_from  text;
  v_allowed text[];
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles
     WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  v_from := v_order.status;

  IF v_from = p_to_status THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', v_order.status, 'version', v_order.version, 'noop', true);
  END IF;

  v_allowed := CASE v_from
    WHEN 'pending_payment'      THEN ARRAY['payment_submitted','cancelled','expired']
    WHEN 'payment_submitted'    THEN ARRAY['confirmed','payment_rejected','cancelled','expired']
    WHEN 'payment_rejected'     THEN ARRAY['payment_submitted','cancelled','expired']
    WHEN 'pending_confirmation' THEN ARRAY['confirmed','cancelled','expired']
    WHEN 'confirmed'            THEN ARRAY['processing','cancelled']
    WHEN 'processing'           THEN ARRAY['ready_to_ship','cancelled']
    WHEN 'ready_to_ship'        THEN ARRAY['courier_booked','shipped','cancelled']
    WHEN 'courier_booked'       THEN ARRAY['shipped','cancelled']
    WHEN 'shipped'              THEN ARRAY['delivered','delivery_failed']
    WHEN 'delivered'            THEN ARRAY['completed','returned']
    WHEN 'completed'            THEN ARRAY['returned']
    WHEN 'delivery_failed'      THEN ARRAY['shipped','returned']
    WHEN 'returned'             THEN ARRAY['refund_pending']
    WHEN 'refund_pending'       THEN ARRAY['refund_done']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_transition'
      USING DETAIL = v_from || ' -> ' || p_to_status;
  END IF;

  IF p_expected_version IS NOT NULL AND v_order.version <> p_expected_version THEN
    RAISE EXCEPTION 'version_conflict'
      USING DETAIL = 'expected=' || p_expected_version || ' actual=' || v_order.version;
  END IF;

  IF p_to_status = 'confirmed' THEN
    PERFORM private.consume_reservations(p_order_id, p_actor);
    UPDATE public.orders SET confirmed_at = now() WHERE id = p_order_id;
  END IF;

  IF p_to_status IN ('cancelled', 'expired') THEN
    PERFORM private.release_reservations(p_order_id);
  END IF;

  -- Rejected payment is retryable: keep the hold but refresh its window so the
  -- customer can resubmit and the reserved stock isn't lazily freed mid-retry.
  IF p_to_status = 'payment_rejected' THEN
    DECLARE v_new_expiry timestamptz;
    BEGIN
      SELECT now() + make_interval(hours => COALESCE(order_hold_hours, 24))
        INTO v_new_expiry FROM public.site_settings WHERE id = 1;
      UPDATE public.orders SET reservation_expires_at = v_new_expiry WHERE id = p_order_id;
      UPDATE public.inventory_reservations SET expires_at = v_new_expiry
        WHERE order_id = p_order_id AND status = 'active';
    END;
  END IF;

  IF p_to_status = 'returned' AND p_restock THEN
    DECLARE r record; v_code text; v_current integer;
    BEGIN
      FOR r IN
        SELECT oi.product_id, oi.variant_size, oi.qty
          FROM public.order_items oi WHERE oi.order_id = p_order_id
      LOOP
        -- Made-to-order ('Custom') lines never consumed ready stock → never restock.
        CONTINUE WHEN r.variant_size = 'Custom';
        SELECT code INTO v_code FROM public.products WHERE id = r.product_id;
        IF r.variant_size IS NOT NULL THEN
          SELECT quantity INTO v_current FROM public.product_size_stock
           WHERE product_id = r.product_id AND size = r.variant_size;
        ELSE
          SELECT stock INTO v_current FROM public.products WHERE id = r.product_id;
        END IF;
        v_current := COALESCE(v_current, 0);
        PERFORM api.set_inventory(
          p_code     := v_code,
          p_size     := r.variant_size,
          p_quantity := v_current + r.qty,
          p_reason   := 'return',
          p_actor_id := p_actor
        );
      END LOOP;
    END;
  END IF;

  UPDATE public.orders
     SET status     = p_to_status,
         version    = version + 1,
         updated_at = now()
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
  VALUES (p_order_id, v_from, p_to_status, p_actor, p_reason);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'order.transition', 'order', p_order_id::text,
    jsonb_build_object('from', v_from, 'to', p_to_status,
      'order_no', v_order.order_no, 'restock', p_restock));

  RETURN jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'status', p_to_status, 'version', v_order.version + 1, 'noop', false);
END;
$$;

-- Grants unchanged (already service_role only).
