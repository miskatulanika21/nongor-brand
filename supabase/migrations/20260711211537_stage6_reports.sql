-- Stage 6 P6 — business reports (read-only aggregates).
--
-- The admin Reports screen was a hidden "Coming soon" placeholder (its old
-- charts were demo numbers). This adds five read-only aggregate RPCs over the
-- REAL order/payment/coupon/shipment data. No new tables, no writes, no audit
-- rows (reads are not mutations).
--
-- Definitions (single source of truth, mirrored in the report UI):
--   * "confirmed" orders = status IN ('confirmed','processing','ready_to_ship',
--     'courier_booked','shipped','delivered','completed') — money the business
--     has verified/accepted (post payment-verification), regardless of whether
--     it is delivered yet. Cancelled/expired/returned/refunds/failed are OUT.
--   * "delivered" revenue = status IN ('delivered','completed') — realized.
--   * Order-based reports range on placed_at; courier/COD reports range on the
--     shipment's booked_at. Ranges are [p_from, p_to).
--
-- Posture: STABLE SECURITY DEFINER, search_path='', SQL-side active-staff
-- re-check, EXECUTE granted to service_role only (the app additionally gates
-- `reports.view`, which only admin/owner hold).

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. report_sales_summary — totals + per-day series + per-status breakdown
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.report_sales_summary(
  p_actor uuid,
  p_from  timestamptz,
  p_to    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_confirmed text[] := ARRAY['confirmed','processing','ready_to_ship',
                              'courier_booked','shipped','delivered','completed'];
  v_totals jsonb;
  v_by_day jsonb;
  v_by_status jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT jsonb_build_object(
    'orders_count',      count(*),
    'confirmed_count',   count(*) FILTER (WHERE o.status = ANY(v_confirmed)),
    'delivered_count',   count(*) FILTER (WHERE o.status IN ('delivered','completed')),
    'cancelled_count',   count(*) FILTER (WHERE o.status IN ('cancelled','expired')),
    'confirmed_revenue', COALESCE(sum(o.total)    FILTER (WHERE o.status = ANY(v_confirmed)), 0),
    'delivered_revenue', COALESCE(sum(o.total)    FILTER (WHERE o.status IN ('delivered','completed')), 0),
    'discount_total',    COALESCE(sum(o.discount) FILTER (WHERE o.status = ANY(v_confirmed)), 0),
    'shipping_total',    COALESCE(sum(o.shipping_fee) FILTER (WHERE o.status = ANY(v_confirmed)), 0),
    'aov', CASE WHEN count(*) FILTER (WHERE o.status = ANY(v_confirmed)) > 0
           THEN round(COALESCE(sum(o.total) FILTER (WHERE o.status = ANY(v_confirmed)), 0)::numeric
                / (count(*) FILTER (WHERE o.status = ANY(v_confirmed))))
           ELSE 0 END
  ) INTO v_totals
  FROM public.orders o
  WHERE o.placed_at >= p_from AND o.placed_at < p_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'day', d.day, 'orders', d.orders,
    'confirmed_revenue', d.confirmed_revenue,
    'delivered_revenue', d.delivered_revenue
  ) ORDER BY d.day), '[]'::jsonb) INTO v_by_day
  FROM (
    SELECT date_trunc('day', o.placed_at)::date AS day,
           count(*) AS orders,
           COALESCE(sum(o.total) FILTER (WHERE o.status = ANY(v_confirmed)), 0) AS confirmed_revenue,
           COALESCE(sum(o.total) FILTER (WHERE o.status IN ('delivered','completed')), 0) AS delivered_revenue
    FROM public.orders o
    WHERE o.placed_at >= p_from AND o.placed_at < p_to
    GROUP BY 1
  ) d;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'status', s.status, 'count', s.count, 'total', s.total
  ) ORDER BY s.count DESC), '[]'::jsonb) INTO v_by_status
  FROM (
    SELECT o.status, count(*) AS count, COALESCE(sum(o.total), 0) AS total
    FROM public.orders o
    WHERE o.placed_at >= p_from AND o.placed_at < p_to
    GROUP BY o.status
  ) s;

  RETURN jsonb_build_object('totals', v_totals, 'by_day', v_by_day, 'by_status', v_by_status);
END;
$$;

REVOKE ALL ON FUNCTION api.report_sales_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.report_sales_summary(uuid, timestamptz, timestamptz) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. report_top_products — units + revenue over confirmed orders
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.report_top_products(
  p_actor uuid,
  p_from  timestamptz,
  p_to    timestamptz,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', t.product_id, 'name', t.name,
    'units', t.units, 'revenue', t.revenue, 'orders', t.orders
  ) ORDER BY t.revenue DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT oi.product_id, min(oi.name) AS name,
           sum(oi.qty) AS units,
           sum(oi.line_total) AS revenue,
           count(DISTINCT oi.order_id) AS orders
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.placed_at >= p_from AND o.placed_at < p_to
      AND o.status IN ('confirmed','processing','ready_to_ship',
                       'courier_booked','shipped','delivered','completed')
    GROUP BY oi.product_id
    ORDER BY sum(oi.line_total) DESC
    LIMIT v_limit
  ) t;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.report_top_products(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.report_top_products(uuid, timestamptz, timestamptz, integer) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. report_coupon_usage — redemptions from the ledger (all redemptions in range)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.report_coupon_usage(
  p_actor uuid,
  p_from  timestamptz,
  p_to    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'coupon_code', c.coupon_code, 'uses', c.uses,
    'discount_total', c.discount_total, 'order_revenue', c.order_revenue,
    'live_uses', c.live_uses
  ) ORDER BY c.uses DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT cu.coupon_code,
           count(*) AS uses,
           COALESCE(sum(cu.amount), 0) AS discount_total,
           COALESCE(sum(o.total), 0) AS order_revenue,
           -- redemptions whose order is still in the confirmed set
           count(*) FILTER (WHERE o.status IN ('confirmed','processing','ready_to_ship',
             'courier_booked','shipped','delivered','completed')) AS live_uses
    FROM public.coupon_usages cu
    JOIN public.orders o ON o.id = cu.order_id
    WHERE o.placed_at >= p_from AND o.placed_at < p_to
    GROUP BY cu.coupon_code
  ) c;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.report_coupon_usage(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.report_coupon_usage(uuid, timestamptz, timestamptz) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. report_courier_performance — per-provider outcomes + avg time-to-deliver
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.report_courier_performance(
  p_actor uuid,
  p_from  timestamptz,
  p_to    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'provider', s.provider,
    'booked', s.booked, 'delivered', s.delivered,
    'failed', s.failed, 'returned', s.returned, 'cancelled', s.cancelled,
    'avg_hours_to_deliver', s.avg_hours_to_deliver
  ) ORDER BY s.booked DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT sh.provider,
           count(*) AS booked,
           count(*) FILTER (WHERE o.status IN ('delivered','completed')) AS delivered,
           count(*) FILTER (WHERE o.status = 'delivery_failed') AS failed,
           count(*) FILTER (WHERE o.status IN ('returned','refund_pending','refund_done')) AS returned,
           count(*) FILTER (WHERE sh.cancelled_at IS NOT NULL) AS cancelled,
           round(avg(EXTRACT(EPOCH FROM (h.delivered_at - sh.booked_at)) / 3600.0)
                 FILTER (WHERE h.delivered_at IS NOT NULL))::int AS avg_hours_to_deliver
    FROM public.shipments sh
    JOIN public.orders o ON o.id = sh.order_id
    LEFT JOIN LATERAL (
      SELECT min(created_at) AS delivered_at
      FROM public.order_status_history
      WHERE order_id = sh.order_id AND to_status = 'delivered'
        AND created_at >= sh.booked_at
    ) h ON true
    WHERE sh.booking_status = 'success' AND sh.shipment_kind = 'forward'
      AND sh.booked_at >= p_from AND sh.booked_at < p_to
    GROUP BY sh.provider
  ) s;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.report_courier_performance(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.report_courier_performance(uuid, timestamptz, timestamptz) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. report_cod_reconciliation — expected vs collected vs settled (+ fees)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.report_cod_reconciliation(
  p_actor uuid,
  p_from  timestamptz,
  p_to    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_totals jsonb;
  v_by_provider jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT jsonb_build_object(
    'cod_shipments',  count(*),
    'cod_expected',   COALESCE(sum(sh.cod_amount), 0),
    'cod_collected',  COALESCE(sum(sh.cod_amount) FILTER (WHERE sh.cod_collected_at IS NOT NULL), 0),
    'cod_settled',    COALESCE(sum(sh.cod_amount) FILTER (WHERE sh.cod_settled_at IS NOT NULL), 0),
    'cod_outstanding',COALESCE(sum(sh.cod_amount) FILTER (WHERE sh.cod_settled_at IS NULL), 0),
    'courier_fees',   COALESCE(sum(sh.courier_fee), 0),
    'return_fees',    COALESCE(sum(sh.return_fee), 0),
    'net_receivable', COALESCE(sum(sh.net_receivable), 0)
  ) INTO v_totals
  FROM public.shipments sh
  WHERE sh.booking_status = 'success' AND sh.shipment_kind = 'forward'
    AND sh.payment_collection_mode IN ('cod','partial_cod')
    AND sh.booked_at >= p_from AND sh.booked_at < p_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'provider', p.provider, 'cod_shipments', p.cod_shipments,
    'cod_expected', p.cod_expected, 'cod_collected', p.cod_collected,
    'cod_settled', p.cod_settled, 'cod_outstanding', p.cod_outstanding
  ) ORDER BY p.cod_expected DESC), '[]'::jsonb) INTO v_by_provider
  FROM (
    SELECT sh.provider,
           count(*) AS cod_shipments,
           COALESCE(sum(sh.cod_amount), 0) AS cod_expected,
           COALESCE(sum(sh.cod_amount) FILTER (WHERE sh.cod_collected_at IS NOT NULL), 0) AS cod_collected,
           COALESCE(sum(sh.cod_amount) FILTER (WHERE sh.cod_settled_at IS NOT NULL), 0) AS cod_settled,
           COALESCE(sum(sh.cod_amount) FILTER (WHERE sh.cod_settled_at IS NULL), 0) AS cod_outstanding
    FROM public.shipments sh
    WHERE sh.booking_status = 'success' AND sh.shipment_kind = 'forward'
      AND sh.payment_collection_mode IN ('cod','partial_cod')
      AND sh.booked_at >= p_from AND sh.booked_at < p_to
    GROUP BY sh.provider
  ) p;

  RETURN jsonb_build_object('totals', v_totals, 'by_provider', v_by_provider);
END;
$$;

REVOKE ALL ON FUNCTION api.report_cod_reconciliation(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.report_cod_reconciliation(uuid, timestamptz, timestamptz) TO service_role;
