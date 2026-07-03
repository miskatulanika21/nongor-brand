-- Stage 4 P8 — admin customers directory (api.admin_list_customers).
--
-- One staff-facing read: every real account (auth.users, excluding active
-- staff and anonymous/deleted users) LEFT JOINed with its lazily-created
-- customer_profile and live order aggregates. Registration alone makes a row
-- appear — a customer who signed up but never saved a profile or ordered is
-- still visible.
--
-- Shape per customer:
--   user_id · name · phone · email · joined_at · orders_count ·
--   lifetime_spent · returns_count · last_order_at · has_custom_size
--
-- Semantics:
--   * name/phone prefer the profile, then fall back to the most recent order
--     snapshot (claimed/checkout orders carry both), then 'Customer'.
--   * orders_count / lifetime_spent exclude cancelled + expired orders;
--     returns_count counts returned/refund_pending/refund_done;
--     last_order_at spans ALL orders (any activity is recency).
--   * has_custom_size = any line item ever carried custom measurements.
--   * search matches the DISPLAYED name/phone plus the account email, so what
--     staff see is what they can find. Sorted by recency of activity.
--   * derived tags (VIP / repeat / high-risk / custom-size) are computed in
--     the app from these aggregates — never stored.
--
-- Posture: SECURITY DEFINER + empty search_path + service-role-only EXECUTE;
-- active-staff assert inside (the app layer additionally requires the
-- customers.view permission). STABLE — pure read.

CREATE OR REPLACE FUNCTION api.admin_list_customers(
  p_actor uuid,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_search text;
  v_limit  integer;
  v_offset integer;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH base AS (
    SELECT u.id AS user_id,
           COALESCE(cp.full_name, agg.last_order_name, 'Customer') AS name,
           COALESCE(cp.phone, agg.last_order_phone)                AS phone,
           u.email::text                                           AS email,
           u.created_at                                            AS joined_at,
           COALESCE(agg.orders_count, 0)                           AS orders_count,
           COALESCE(agg.lifetime_spent, 0)                         AS lifetime_spent,
           COALESCE(agg.returns_count, 0)                          AS returns_count,
           agg.last_order_at,
           EXISTS (
             SELECT 1
               FROM public.order_items oi
               JOIN public.orders oc ON oc.id = oi.order_id
              WHERE oc.user_id = u.id AND oi.custom_measurements IS NOT NULL
           ) AS has_custom_size
      FROM auth.users u
      LEFT JOIN public.customer_profiles cp ON cp.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE o.status NOT IN ('cancelled', 'expired'))
                 AS orders_count,
               COALESCE(sum(o.total) FILTER (WHERE o.status NOT IN ('cancelled', 'expired')), 0)
                 AS lifetime_spent,
               count(*) FILTER (WHERE o.status IN ('returned', 'refund_pending', 'refund_done'))
                 AS returns_count,
               max(o.placed_at) AS last_order_at,
               (array_agg(o.customer_name  ORDER BY o.placed_at DESC))[1] AS last_order_name,
               (array_agg(o.customer_phone ORDER BY o.placed_at DESC))[1] AS last_order_phone
          FROM public.orders o
         WHERE o.user_id = u.id
      ) agg ON true
     WHERE u.deleted_at IS NULL
       AND COALESCE(u.is_anonymous, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.staff_profiles sp
                        WHERE sp.user_id = u.id AND sp.is_active)
  ),
  filtered AS (
    SELECT * FROM base
     WHERE v_search IS NULL
        OR name                ILIKE '%' || v_search || '%'
        OR COALESCE(phone, '') ILIKE '%' || v_search || '%'
        OR COALESCE(email, '') ILIKE '%' || v_search || '%'
  )
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(row_to_json(c.*))
        FROM (SELECT * FROM filtered
               ORDER BY last_order_at DESC NULLS LAST, joined_at DESC, user_id
               LIMIT v_limit OFFSET v_offset) c
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered)
  ) INTO v_result;

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION api.admin_list_customers(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.admin_list_customers(uuid, text, integer, integer)
  TO service_role;
