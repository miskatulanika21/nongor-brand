CREATE OR REPLACE FUNCTION api.verify_payment(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_pay record;
BEGIN
  SELECT * INTO v_pay FROM public.payments
   WHERE order_id = p_order_id AND method <> 'cod'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_pay.status = 'verified' THEN
    RETURN (SELECT jsonb_build_object('order_id', o.id, 'order_no', o.order_no,
      'status', o.status, 'version', o.version, 'noop', true)
      FROM public.orders o WHERE o.id = p_order_id);
  END IF;
  UPDATE public.payments SET status = 'verified', verified_by = p_actor, verified_at = now(), updated_at = now() WHERE id = v_pay.id;
  v_result := api.transition_order(p_order_id, 'confirmed', p_actor, 'payment verified');
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.verify_payment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.verify_payment(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION api.reject_payment(p_order_id uuid, p_reason text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  UPDATE public.payments SET status = 'rejected', reject_reason = p_reason, updated_at = now()
   WHERE order_id = p_order_id AND status IN ('pending','submitted') AND method <> 'cod';
  v_result := api.transition_order(p_order_id, 'payment_rejected', p_actor, p_reason);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.reject_payment(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.reject_payment(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION api.confirm_cod(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RETURN api.transition_order(p_order_id, 'confirmed', p_actor, 'COD confirmed'); END; $$;
REVOKE ALL ON FUNCTION api.confirm_cod(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.confirm_cod(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION api.cancel_order(p_order_id uuid, p_actor uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RETURN api.transition_order(p_order_id, 'cancelled', p_actor, p_reason); END; $$;
REVOKE ALL ON FUNCTION api.cancel_order(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.cancel_order(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION api.return_order(p_order_id uuid, p_actor uuid, p_restock boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RETURN api.transition_order(p_order_id, 'returned', p_actor, p_reason, NULL, p_restock); END; $$;
REVOKE ALL ON FUNCTION api.return_order(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.return_order(uuid, uuid, boolean, text) TO service_role;
