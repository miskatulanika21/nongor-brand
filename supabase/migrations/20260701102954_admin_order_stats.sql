-- Stage 3 Pass 4 — real admin dashboard order stats (retire the mock ORDERS seed).
--
-- The dashboard's order/payment/revenue widgets read the fabricated ORDERS
-- array. This one round-trip aggregate replaces them with live figures:
-- counts by pipeline stage, today's orders (Asia/Dhaka business day), realized
-- revenue (delivered/completed), and made-to-measure orders still in progress
-- (now real thanks to order_items.custom_measurements). Staff-gated like the
-- other admin reads; service-role only (the server fn adds orders.view).
CREATE OR REPLACE FUNCTION api.admin_order_stats(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'total_orders', count(*),
    'today_orders', count(*) FILTER (
      WHERE (placed_at AT TIME ZONE 'Asia/Dhaka')::date
          = (now()      AT TIME ZONE 'Asia/Dhaka')::date),
    'pending_payments', count(*) FILTER (WHERE status = 'payment_submitted'),
    'pending_confirmation', count(*) FILTER (WHERE status = 'pending_confirmation'),
    'courier_pending', count(*) FILTER (WHERE status IN ('confirmed','processing','ready_to_ship')),
    'delivered_revenue', COALESCE(sum(total) FILTER (WHERE status IN ('delivered','completed')), 0),
    'custom_pending', (
      SELECT count(DISTINCT oi.order_id)
        FROM public.order_items oi
        JOIN public.orders o2 ON o2.id = oi.order_id
       WHERE oi.custom_measurements IS NOT NULL
         AND o2.status NOT IN ('delivered','completed','cancelled','expired','returned','refund_pending','refund_done'))
  ) INTO v FROM public.orders;
  RETURN v;
END; $$;
REVOKE ALL ON FUNCTION api.admin_order_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_order_stats(uuid) TO service_role;
