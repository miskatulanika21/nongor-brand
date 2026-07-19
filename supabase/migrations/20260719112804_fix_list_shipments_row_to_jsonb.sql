-- ══════════════════════════════════════════════════════════════════════════════
-- Fix api.list_shipments — row_to_jsonb() does not exist
-- ══════════════════════════════════════════════════════════════════════════════
--
-- api.list_shipments has raised on EVERY call since Stage 5 shipped
-- (20260707150000_stage5_courier_schema.sql:771,788):
--
--   ERROR: 42883: function row_to_jsonb(public.shipment_events) does not exist
--
-- Postgres has row_to_json() (-> json) and to_jsonb() (-> jsonb). There is no
-- row_to_jsonb(). Because jsonb_agg() wants jsonb, the correct call is to_jsonb().
--
-- Impact: the failure was swallowed by the catch in courier.api.ts's
-- listShipmentsFn, which returned { success: false, shipments: [] } with no
-- surfaced error — so /admin/courier rendered every booked order as though it
-- had no shipments at all. Admins/owners/staff could not see the tracking code,
-- courier status, "Refresh status" or "Cancel" for ANY shipment. Verified live
-- 2026-07-19 by booking NGR-2026-000025 (manual provider): the row committed
-- correctly but never appeared in the UI.
--
-- Customers were unaffected — /orders/$id reads api.get_my_order, a separate RPC
-- that never used row_to_jsonb.
--
-- Body is otherwise byte-for-byte the Stage 5 definition; only the two function
-- names change. The signature is unchanged, so existing REVOKE/GRANT carry over
-- (restated below to keep this migration self-contained).

CREATE OR REPLACE FUNCTION api.list_shipments(
  p_actor    uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      sh.id, sh.order_id, sh.provider, sh.shipment_kind,
      sh.booking_status, sh.booking_error, sh.attempt_no,
      sh.pending_expires_at,
      sh.consignment_id, sh.tracking_code, sh.courier_status,
      sh.payment_collection_mode, sh.cod_amount,
      sh.courier_fee, sh.return_fee,
      sh.cod_collected_at, sh.cod_settled_at,
      sh.settlement_reference, sh.net_receivable,
      sh.created_by, sh.created_at, sh.booked_at,
      sh.updated_at, sh.cancelled_at,
      sh.parent_shipment_id, sh.return_reason,
      cp.display_name AS provider_name,
      cp.tracking_url_template,
      (
        SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.received_at), '[]'::jsonb)
        FROM public.shipment_events e WHERE e.shipment_id = sh.id
      ) AS events
    FROM public.shipments sh
    JOIN public.courier_providers cp ON cp.id = sh.provider
    WHERE sh.order_id = p_order_id
  ) s;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION api.list_shipments(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_shipments(uuid, uuid) TO service_role;
