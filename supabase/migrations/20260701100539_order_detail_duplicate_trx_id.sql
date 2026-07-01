-- Stage 3 Pass 4d — surface the reused-TrxID signal to the admin reviewer.
--
-- submit_payment_evidence already computes a duplicate flag at submit time
-- (returned as duplicate_trx_id_warning + logged), but the admin verifying the
-- payment never saw it. get_order_detail now projects a computed
-- `payment.trx_id_duplicate`: true when this payment's TrxID (same method) is
-- already recorded on a DIFFERENT order's VERIFIED payment. Read-time computed,
-- no schema change. Recreated from 20260701094647 (custom_measurements); the
-- ONLY change is the payment projection.
CREATE OR REPLACE FUNCTION api.get_order_detail(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'order', row_to_json(o.*),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'product_id', oi.product_id, 'variant_size', oi.variant_size, 'name', oi.name, 'image', oi.image, 'unit_price', oi.unit_price, 'qty', oi.qty, 'line_total', oi.line_total, 'custom_measurements', oi.custom_measurements) ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'payment', (SELECT to_jsonb(p.*) || jsonb_build_object('trx_id_duplicate',
        EXISTS (SELECT 1 FROM public.payments p2
                WHERE p2.method = p.method AND p2.trx_id IS NOT NULL
                  AND lower(p2.trx_id) = lower(p.trx_id)
                  AND p2.status = 'verified' AND p2.id <> p.id))
      FROM public.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1),
    'screenshots', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ps.id, 'storage_path', ps.storage_path, 'created_at', ps.created_at)), '[]'::jsonb) FROM public.payment_screenshots ps JOIN public.payments pay ON pay.id = ps.payment_id WHERE pay.order_id = o.id),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'actor_id', h.actor_id, 'reason', h.reason, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb) FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o WHERE o.id = p_order_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.get_order_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_order_detail(uuid, uuid) TO service_role;
