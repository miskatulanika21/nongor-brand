-- ══════════════════════════════════════════════════════════════════════════════
-- api.create_return_shipment — make the modelled return flow real
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Stage 5 shipped the schema for returns and then never built the path to
-- create one: shipment_kind ('forward'|'return'|'exchange'), parent_shipment_id,
-- return_reason and return_fee have existed (and been surfaced in the admin
-- DTO) since 20260707150000, but no RPC could produce a row with
-- shipment_kind <> 'forward'. The database promised a workflow the application
-- could not perform.
--
-- SteadFast exposes POST /create_return_request (verified against their API doc
-- 2026-07-19), so the forward leg can now be followed by a real return leg.
--
-- Shape mirrors create_shipment_attempt deliberately — same 3-phase booking
-- contract (pending row committed → external call → mark success/failure), so
-- mark_shipment_booking_success / fail_shipment_booking work unchanged on the
-- returned id and no new failure-handling path is introduced.
--
-- Guards:
--   * actor must be active staff                       → actor_not_authorized
--   * parent must exist, be forward, and be booked      → invalid_booking_state
--   * only ONE open return per parent                   → duplicate_return
--
-- Note uq_active_forward_shipment is partial (shipment_kind = 'forward'), so a
-- return row cannot collide with the forward leg's unique index. The
-- duplicate-return guard below is therefore explicit rather than index-backed.

CREATE OR REPLACE FUNCTION api.create_return_shipment(
  p_actor     uuid,
  p_parent_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent  public.shipments%ROWTYPE;
  v_id      uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  -- Lock the parent so two admins cannot open two returns concurrently.
  SELECT * INTO v_parent FROM public.shipments WHERE id = p_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  -- A return is a leg of a delivered/attempted FORWARD parcel. Returning a
  -- return is not a thing, and neither is returning a parcel that was never
  -- successfully booked with the courier.
  IF v_parent.shipment_kind <> 'forward'
     OR v_parent.booking_status <> 'success'
     OR v_parent.consignment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_booking_state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipments
    WHERE parent_shipment_id = p_parent_id
      AND shipment_kind = 'return'
      AND cancelled_at IS NULL
      AND booking_status <> 'failed'
  ) THEN
    RAISE EXCEPTION 'duplicate_return';
  END IF;

  INSERT INTO public.shipments (
    order_id, provider, shipment_kind, booking_status,
    payment_collection_mode, cod_amount,
    parent_shipment_id, return_reason, created_by
  ) VALUES (
    v_parent.order_id, v_parent.provider, 'return', 'pending',
    -- A return collects nothing from the customer: goods travel back to us.
    'prepaid', 0,
    p_parent_id, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_actor
  )
  RETURNING id INTO v_id;

  INSERT INTO public.shipment_events (shipment_id, status, source, raw_payload)
  VALUES (v_id, 'return_requested', 'admin',
          jsonb_build_object('parent_shipment_id', p_parent_id, 'reason', p_reason));

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'shipment.return_requested', 'shipment', v_id::text,
          jsonb_build_object('parent_shipment_id', p_parent_id,
                             'order_id', v_parent.order_id,
                             'provider', v_parent.provider));

  RETURN jsonb_build_object('shipment_id', v_id, 'provider', v_parent.provider,
                            'consignment_id', v_parent.consignment_id);
END;
$$;

REVOKE ALL ON FUNCTION api.create_return_shipment(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.create_return_shipment(uuid, uuid, text) TO service_role;
