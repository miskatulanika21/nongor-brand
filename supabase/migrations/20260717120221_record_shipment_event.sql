-- ══════════════════════════════════════════════════════════════════════════════
-- Append-only shipment event recorder.
--
-- api.update_shipment_status always does `UPDATE shipments SET courier_status =
-- p_status`, which is right for a real status change but wrong for informational
-- events that carry no status of their own. SteadFast's tracking_update webhook
-- is exactly that: { notification_type: "tracking_update", consignment_id,
-- invoice, tracking_message, updated_at } — a human-readable progress note with
-- no status field. Routing it through update_shipment_status would overwrite a
-- real "delivered" courier_status with "tracking_update"; dropping it (today's
-- behaviour) loses the timeline entirely.
--
-- This function is the third option: append the event, leave the status alone.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.record_shipment_event(
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
  v_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.shipments WHERE id = p_shipment_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, p_status, p_raw_payload, p_source);

  -- Deliberately NO update to shipments.courier_status and NO order transition:
  -- an informational event must never move the order or clobber a real status.
  UPDATE public.shipments SET updated_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object('shipment_id', p_shipment_id, 'recorded', true);
END;
$$;

REVOKE ALL ON FUNCTION api.record_shipment_event(uuid, text, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.record_shipment_event(uuid, text, jsonb, text) TO service_role;

COMMENT ON FUNCTION api.record_shipment_event(uuid, text, jsonb, text) IS
  'Append an informational shipment_event without changing courier_status or the order. Used for SteadFast tracking_update webhooks.';
