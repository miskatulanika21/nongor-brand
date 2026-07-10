-- Stage 5 fix — courier lifecycle progression (#1 + A1).
--
-- Problem: SteadFast (the primary BD courier) never emits a "picked up / shipped"
-- signal, and `courier_booked -> delivered` was NOT an allowed order transition,
-- so a "delivered" webhook was silently rejected and the order stuck at
-- courier_booked forever. Also update_shipment_status ignored in_transit /
-- out_for_delivery (which the app's status map produces), so even couriers that
-- DO report transit never moved the order to shipped.
--
-- Fix:
--   * transition_order: courier_booked may now go directly to delivered /
--     delivery_failed (a courier that skips the pickup signal can still complete;
--     an admin can manually complete a manual-courier order too). Chosen design:
--     jump straight to delivered — no fabricated "shipped" timestamp.
--   * update_shipment_status: map in_transit / out_for_delivery -> shipped, and
--     allow courier_booked -> {shipped, delivered, delivery_failed, cancelled}.
--
-- Only the courier_booked arm / the status CASE change; the rest of each function
-- is reproduced verbatim from 20260707162039 / 20260707150000.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. transition_order — courier_booked may go directly to delivered/delivery_failed
-- ══════════════════════════════════════════════════════════════════════════════

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
    WHEN 'courier_booked'       THEN ARRAY['shipped','delivered','delivery_failed','cancelled']
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
        -- Made-to-order ('Custom') lines never consumed ready stock -> never restock.
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

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. update_shipment_status — map transit statuses to shipped; allow direct
--    courier_booked -> delivered/delivery_failed
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.update_shipment_status(
  p_shipment_id uuid,
  p_status      text,
  p_raw_payload jsonb DEFAULT NULL,
  p_source      text  DEFAULT 'webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship       record;
  v_order      record;
  v_new_order_status text := NULL;
  v_notif_type text := NULL;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  -- Append event (always, even if order doesn't transition)
  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, p_status, p_raw_payload, p_source);

  -- Update shipment courier_status
  UPDATE public.shipments SET
    courier_status = p_status,
    updated_at     = now()
  WHERE id = p_shipment_id;

  -- Map significant courier statuses to order transitions. picked_up / in_transit
  -- / out_for_delivery all imply the parcel has left our hands -> shipped.
  v_new_order_status := CASE p_status
    WHEN 'picked_up'            THEN 'shipped'
    WHEN 'in_transit'           THEN 'shipped'
    WHEN 'out_for_delivery'     THEN 'shipped'
    WHEN 'delivered'            THEN 'delivered'
    WHEN 'failed'               THEN 'delivery_failed'
    WHEN 'returned_to_merchant' THEN NULL  -- admin decides (return + restock)
    ELSE NULL
  END;

  v_notif_type := CASE p_status
    WHEN 'picked_up'            THEN 'shipment_picked_up'
    WHEN 'in_transit'           THEN 'shipment_in_transit'
    WHEN 'out_for_delivery'     THEN 'shipment_in_transit'
    WHEN 'delivered'            THEN 'shipment_delivered'
    WHEN 'failed'               THEN 'shipment_failed'
    WHEN 'returned_to_merchant' THEN 'shipment_returned'
    ELSE NULL
  END;

  -- Conditionally transition the order
  IF v_new_order_status IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_ship.order_id FOR UPDATE;
    -- Use FOUND, not `v_order IS NOT NULL`: for a RECORD, `IS NOT NULL` is only
    -- true when EVERY column is non-null, which never holds for a real order
    -- (guest orders have null user_id, most have null coupon/area/confirmed_at).
    -- The original code used `v_order IS NOT NULL` here, so this branch was always
    -- skipped and NO courier webhook ever transitioned an order — the root cause
    -- of orders sticking at courier_booked, compounding the missing-transition bug.
    IF FOUND THEN
      -- Only transition if the order is in a state that allows it. A courier that
      -- skips the pickup signal (e.g. SteadFast) may report 'delivered' straight
      -- from courier_booked, so courier_booked permits delivered/delivery_failed.
      DECLARE v_allowed text[];
      BEGIN
        v_allowed := CASE v_order.status
          WHEN 'courier_booked'  THEN ARRAY['shipped','delivered','delivery_failed','cancelled']
          WHEN 'shipped'         THEN ARRAY['delivered','delivery_failed']
          ELSE ARRAY[]::text[]
        END;
        IF v_new_order_status = ANY(v_allowed) THEN
          UPDATE public.orders SET
            status     = v_new_order_status,
            version    = version + 1,
            updated_at = now()
          WHERE id = v_ship.order_id;

          INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
          VALUES (v_ship.order_id, v_order.status, v_new_order_status, NULL,
            'Courier status: ' || p_status || ' (via ' || p_source || ')');
        ELSE
          v_new_order_status := NULL;  -- not applied; report honestly
        END IF;
      END;
    ELSE
      v_new_order_status := NULL;  -- order not found (shouldn't happen); report honestly
    END IF;
  END IF;

  -- Notification outbox
  IF v_notif_type IS NOT NULL THEN
    INSERT INTO public.notification_events (order_id, event_type, metadata)
    VALUES (v_ship.order_id, v_notif_type, jsonb_build_object(
      'provider', v_ship.provider,
      'courier_status', p_status,
      'tracking_code', v_ship.tracking_code));
  END IF;

  RETURN jsonb_build_object(
    'shipment_id', p_shipment_id,
    'courier_status', p_status,
    'order_transitioned', v_new_order_status IS NOT NULL);
END;
$$;
