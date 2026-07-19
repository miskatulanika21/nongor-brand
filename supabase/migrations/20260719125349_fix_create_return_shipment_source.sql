-- ══════════════════════════════════════════════════════════════════════════════
-- Fix api.create_return_shipment — invalid event source, and manual shipments
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Two bugs in 20260719120058, both caught by courier_rpc_smoke.test.sql the
-- first time CI ran it:
--
-- (1) It inserted shipment_events.source = 'admin', which the CHECK constraint
--     rejects:
--
--       new row for relation "shipment_events" violates check constraint
--       "shipment_events_source_check"
--
--     Allowed values are webhook | poll | manual | booking. 'manual' is the
--     correct one here — it means "a human did this", as opposed to a webhook,
--     a status poll, or the booking flow itself. The RPC could never have
--     succeeded once, in CI or in production.
--
-- (2) It required consignment_id IS NOT NULL, which excludes the `manual`
--     provider entirely — manual shipments carry an admin-typed tracking code
--     and no consignment. An admin using a manual courier still needs to record
--     a return leg, so the guard now accepts a NULL consignment. The orchestrator
--     already handles providers with no return API (it records the leg and
--     reports manual: true), so nothing downstream depends on the id existing.
--
-- Everything else is unchanged from 20260719120058.

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

  SELECT * INTO v_parent FROM public.shipments WHERE id = p_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  -- A return is a leg of a successfully booked FORWARD parcel. Returning a
  -- return is not a thing. consignment_id is NOT required: manual shipments
  -- legitimately have none.
  IF v_parent.shipment_kind <> 'forward' OR v_parent.booking_status <> 'success' THEN
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
    'prepaid', 0,
    p_parent_id, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_actor
  )
  RETURNING id INTO v_id;

  INSERT INTO public.shipment_events (shipment_id, status, source, raw_payload)
  VALUES (v_id, 'return_requested', 'manual',
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
