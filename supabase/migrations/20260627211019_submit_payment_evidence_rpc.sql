CREATE OR REPLACE FUNCTION api.submit_payment_evidence(
  p_order_id      uuid,
  p_trx_id        text,
  p_sender_number text,
  p_scope         text,
  p_screenshot_path text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order record; v_pay record; v_dup boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.user_id IS NOT NULL THEN
    IF p_scope <> v_order.user_id::text THEN RAISE EXCEPTION 'order_not_owned'; END IF;
  ELSE
    IF p_scope IS NULL OR NOT p_scope LIKE 'guest:%' OR substr(p_scope, 7) <> v_order.guest_token_hash THEN
      RAISE EXCEPTION 'order_not_owned';
    END IF;
  END IF;
  IF v_order.status NOT IN ('pending_payment', 'payment_rejected') THEN
    RAISE EXCEPTION 'evidence_already_submitted' USING DETAIL = 'current status: ' || v_order.status;
  END IF;
  IF COALESCE(p_trx_id, '') = '' THEN RAISE EXCEPTION 'invalid_trx_id'; END IF;
  SELECT * INTO v_pay FROM public.payments WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.payments WHERE method = v_pay.method AND lower(trx_id) = lower(p_trx_id) AND status = 'verified' AND id <> v_pay.id) INTO v_dup;
  UPDATE public.payments SET trx_id = p_trx_id, sender_number = p_sender_number, status = 'submitted', updated_at = now() WHERE id = v_pay.id;
  IF p_screenshot_path IS NOT NULL AND char_length(p_screenshot_path) > 0 THEN
    INSERT INTO public.payment_screenshots (payment_id, storage_path) VALUES (v_pay.id, p_screenshot_path);
  END IF;
  UPDATE public.orders SET status = 'payment_submitted', version = version + 1, updated_at = now() WHERE id = p_order_id;
  INSERT INTO public.order_status_history (order_id, from_status, to_status, reason) VALUES (p_order_id, v_order.status, 'payment_submitted', 'customer submitted evidence');
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (v_order.user_id, 'payment.evidence_submitted', 'order', p_order_id::text,
    jsonb_build_object('trx_id_provided', true, 'screenshot', p_screenshot_path IS NOT NULL, 'duplicate_flag', v_dup, 'order_no', v_order.order_no));
  RETURN jsonb_build_object('order_id', v_order.id, 'order_no', v_order.order_no, 'status', 'payment_submitted', 'duplicate_trx_id_warning', v_dup);
END; $$;

REVOKE ALL ON FUNCTION api.submit_payment_evidence(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.submit_payment_evidence(uuid, text, text, text, text) TO service_role;
