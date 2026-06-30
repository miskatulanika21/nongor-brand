CREATE OR REPLACE FUNCTION api.list_orders(p_actor uuid, p_status text DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'orders', COALESCE(jsonb_agg(row_to_json(o.*) ORDER BY o.placed_at DESC), '[]'::jsonb),
    'total', (SELECT count(*) FROM public.orders WHERE (p_status IS NULL OR status = p_status) AND (p_search IS NULL OR order_no ILIKE '%' || p_search || '%' OR customer_name ILIKE '%' || p_search || '%' OR customer_phone ILIKE '%' || p_search || '%'))
  ) INTO v_result
  FROM (
    SELECT o.id, o.order_no, o.customer_name, o.customer_phone, o.ship_district, o.ship_zone,
           o.subtotal, o.discount, o.shipping_fee, o.total, o.payment_method, o.status,
           o.placed_at, o.confirmed_at, o.version,
           (SELECT jsonb_agg(jsonb_build_object('name', oi.name, 'image', oi.image, 'qty', oi.qty, 'unit_price', oi.unit_price, 'line_total', oi.line_total, 'variant_size', oi.variant_size)) FROM public.order_items oi WHERE oi.order_id = o.id) AS items,
           (SELECT jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount, 'trx_id', p.trx_id, 'sender_number', p.sender_number, 'status', p.status, 'verified_at', p.verified_at, 'reject_reason', p.reject_reason) FROM public.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS payment
      FROM public.orders o
     WHERE (p_status IS NULL OR o.status = p_status)
       AND (p_search IS NULL OR o.order_no ILIKE '%' || p_search || '%' OR o.customer_name ILIKE '%' || p_search || '%' OR o.customer_phone ILIKE '%' || p_search || '%')
     ORDER BY o.placed_at DESC LIMIT p_limit OFFSET p_offset
  ) o;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.list_orders(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_orders(uuid, text, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION api.get_order_detail(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'order', row_to_json(o.*),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'product_id', oi.product_id, 'variant_size', oi.variant_size, 'name', oi.name, 'image', oi.image, 'unit_price', oi.unit_price, 'qty', oi.qty, 'line_total', oi.line_total) ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'payment', (SELECT row_to_json(p.*) FROM public.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1),
    'screenshots', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ps.id, 'storage_path', ps.storage_path, 'created_at', ps.created_at)), '[]'::jsonb) FROM public.payment_screenshots ps JOIN public.payments pay ON pay.id = ps.payment_id WHERE pay.order_id = o.id),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'actor_id', h.actor_id, 'reason', h.reason, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb) FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o WHERE o.id = p_order_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.get_order_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_order_detail(uuid, uuid) TO service_role;
