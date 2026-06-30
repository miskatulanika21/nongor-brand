CREATE OR REPLACE FUNCTION api.list_my_orders(p_actor uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'orders', COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status,
        'total', o.total, 'payment_method', o.payment_method,
        'placed_at', o.placed_at, 'item_count',
        (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
        'first_item', (SELECT jsonb_build_object('name', oi.name, 'image', oi.image)
          FROM public.order_items oi WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1)
      ) ORDER BY o.placed_at DESC), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.orders WHERE user_id = p_actor))
    FROM (SELECT * FROM public.orders WHERE user_id = p_actor ORDER BY placed_at DESC LIMIT p_limit OFFSET p_offset) o
  );
END; $$;
REVOKE ALL ON FUNCTION api.list_my_orders(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_my_orders(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION api.get_my_order(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'subtotal', o.subtotal, 'discount', o.discount, 'shipping_fee', o.shipping_fee,
      'total', o.total, 'payment_method', o.payment_method, 'placed_at', o.placed_at,
      'ship_district', o.ship_district, 'ship_zone', o.ship_zone,
      'ship_address', o.ship_address, 'ship_area', o.ship_area),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', oi.name, 'image', oi.image, 'unit_price', oi.unit_price,
      'qty', oi.qty, 'line_total', oi.line_total, 'variant_size', oi.variant_size)
      ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'payment', (SELECT jsonb_build_object('method', p.method, 'status', p.status, 'trx_id', p.trx_id)
      FROM public.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'to_status', h.to_status, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb)
      FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o WHERE o.id = p_order_id AND o.user_id = p_actor;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.get_my_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_my_order(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION api.track_order(p_order_no text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'order_no', o.order_no, 'status', o.status, 'total', o.total,
      'payment_method', o.payment_method, 'placed_at', o.placed_at),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', oi.name, 'image', oi.image, 'qty', oi.qty,
      'unit_price', oi.unit_price, 'variant_size', oi.variant_size)
      ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'to_status', h.to_status, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb)
      FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o
  WHERE o.order_no = p_order_no AND o.guest_token_hash IS NOT NULL AND o.guest_token_hash = p_token_hash;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.track_order(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.track_order(text, text) TO service_role;
