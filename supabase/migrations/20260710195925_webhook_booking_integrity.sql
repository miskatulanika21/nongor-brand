-- Stage 5 fix — booking & webhook integrity (#8 + #9).
--
--  #8: mark_shipment_booking_success accepted an EMPTY consignment id + tracking
--      code as a successful booking (a carrier can return HTTP 200 / type=success
--      with no consignment object). The order flipped to courier_booked with
--      nothing to track or poll. Automated providers (steadfast/pathao) must now
--      carry a non-empty reference; 'manual' supplies its own tracking code.
--  #9: webhook_events.processed / error were written once (processed=false) and
--      never updated, so there was no visibility into which webhooks succeeded or
--      failed. Add api.set_webhook_event_processed for the handler to finalize.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. mark_shipment_booking_success — reject an empty courier reference
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.mark_shipment_booking_success(
  p_shipment_id    uuid,
  p_consignment_id text,
  p_tracking_code  text,
  p_raw_response   jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship   record;
  v_order  record;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;
  IF v_ship.booking_status != 'pending' THEN
    RAISE EXCEPTION 'invalid_booking_state'
      USING DETAIL = 'Expected pending, got ' || v_ship.booking_status;
  END IF;

  -- An automated courier MUST return a usable reference. Without it the parcel
  -- cannot be tracked/polled, so treat an empty reference as a booking failure
  -- rather than silently flipping the order to courier_booked. 'manual' provides
  -- its own tracking code (validated app-side), so it is exempt.
  IF v_ship.provider <> 'manual'
     AND COALESCE(NULLIF(btrim(p_consignment_id), ''), NULLIF(btrim(p_tracking_code), '')) IS NULL THEN
    RAISE EXCEPTION 'empty_courier_reference';
  END IF;

  UPDATE public.shipments SET
    booking_status   = 'success',
    consignment_id   = p_consignment_id,
    tracking_code    = p_tracking_code,
    courier_status   = 'booked',
    booked_at        = now(),
    updated_at       = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, 'booked', p_raw_response, 'booking');

  SELECT * INTO v_order FROM public.orders WHERE id = v_ship.order_id FOR UPDATE;
  IF v_order.status IN ('ready_to_ship', 'delivery_failed') THEN
    UPDATE public.orders SET
      status     = 'courier_booked',
      version    = version + 1,
      updated_at = now()
    WHERE id = v_ship.order_id;

    INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    VALUES (v_ship.order_id, v_order.status, 'courier_booked', v_ship.created_by,
      'Courier booked via ' || v_ship.provider);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (v_ship.created_by, 'shipment.booked', 'shipment', p_shipment_id::text,
    jsonb_build_object(
      'order_id', v_ship.order_id,
      'provider', v_ship.provider,
      'consignment_id', p_consignment_id,
      'tracking_code', p_tracking_code,
      'cod_amount', v_ship.cod_amount));

  INSERT INTO public.notification_events (order_id, event_type, metadata)
  VALUES (v_ship.order_id, 'shipment_booked', jsonb_build_object(
    'provider', v_ship.provider,
    'tracking_code', p_tracking_code,
    'consignment_id', p_consignment_id));
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. set_webhook_event_processed — finalize a recorded webhook event (#9)
-- ══════════════════════════════════════════════════════════════════════════════
-- Called by the webhook handler after processing. p_error NULL = success
-- (processed=true, error cleared); a non-null p_error records the failure and
-- leaves processed=false so the event can be surfaced / retried.

CREATE OR REPLACE FUNCTION api.set_webhook_event_processed(
  p_provider text,
  p_event_id text,
  p_error    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.webhook_events
     SET processed = (p_error IS NULL),
         error     = p_error
   WHERE provider = p_provider AND event_id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION api.set_webhook_event_processed(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_webhook_event_processed(text, text, text) TO service_role;
