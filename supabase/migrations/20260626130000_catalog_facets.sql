-- Stage 2 Pass 3c — DB-backed catalog facets & counts.
--
-- The storefront shop sidebar (category counts, colours, fabrics, occasions) was
-- derived from the legacy mock PRODUCTS array, so it drifted from reality the
-- moment an admin added or archived a product. This function makes the facet set
-- a database read computed over the *publicly visible* catalog.
--
-- Visibility predicate is encoded EXPLICITLY (status = 'active' AND the category
-- is active) so the result is identical whether the caller is the anon role
-- (public RLS already restricts to the same set) or a superuser/service_role
-- that bypasses RLS (e.g. the psql CI integration test). SECURITY DEFINER +
-- empty search_path follows the convention of every other api.* function here;
-- the function takes no arguments and runs no dynamic SQL, so there is no
-- injection surface. It is a pure read — granted to anon/authenticated.

CREATE OR REPLACE FUNCTION api.catalog_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH visible AS (
    SELECT p.category_id, p.color, p.fabric, p.occasion
    FROM public.products p
    WHERE p.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.product_categories c
        WHERE c.id = p.category_id AND c.is_active
      )
  )
  SELECT jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('slug', c.slug, 'name', c.name, 'count', cnt.n)
               ORDER BY c.sort_order, c.name)
      FROM public.product_categories c
      JOIN LATERAL (
        SELECT count(*)::int AS n FROM visible v WHERE v.category_id = c.id
      ) cnt ON true
      WHERE c.is_active AND cnt.n > 0
    ), '[]'::jsonb),
    'colors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', t.value, 'count', t.n)
                       ORDER BY t.n DESC, t.value)
      FROM (
        SELECT color AS value, count(*)::int AS n
        FROM visible WHERE color IS NOT NULL AND color <> '' GROUP BY color
      ) t
    ), '[]'::jsonb),
    'fabrics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', t.value, 'count', t.n)
                       ORDER BY t.n DESC, t.value)
      FROM (
        SELECT fabric AS value, count(*)::int AS n
        FROM visible WHERE fabric IS NOT NULL AND fabric <> '' GROUP BY fabric
      ) t
    ), '[]'::jsonb),
    'occasions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', t.value, 'count', t.n)
                       ORDER BY t.n DESC, t.value)
      FROM (
        SELECT occasion AS value, count(*)::int AS n
        FROM visible WHERE occasion IS NOT NULL AND occasion <> '' GROUP BY occasion
      ) t
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION api.catalog_facets() FROM public;
GRANT EXECUTE ON FUNCTION api.catalog_facets() TO anon, authenticated, service_role;
