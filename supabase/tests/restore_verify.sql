-- Restore-drill verification (Stage 7 / P6) — READ ONLY.
--
-- Run against a database that has just been restored from a logical backup, to
-- prove the restore produced a usable copy: expected schemas, tables, functions
-- and RLS are present, the catalog data came back, and a real read RPC executes
-- against the restored rows. Any failed assertion RAISEs and, under psql
-- `-v ON_ERROR_STOP=1`, aborts the drill with a non-zero exit.
--
-- It performs NO writes — it must be safe to run against any restored copy
-- without changing it. See .github/workflows/restore-drill.yml.

\set ON_ERROR_STOP on

DO $$
DECLARE
  n integer;
  v_products integer;
  v_orders integer;
  v_facets jsonb;
BEGIN
  -- 1. Schemas restored.
  SELECT count(*) INTO n FROM information_schema.schemata
   WHERE schema_name IN ('public', 'api', 'private');
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected schemas public/api/private, found % of 3', n;
  END IF;

  -- 2. Core tables restored.
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('products','orders','order_items','coupons','banners','size_charts','staff_profiles');
  IF n <> 7 THEN
    RAISE EXCEPTION 'FAIL: expected 7 core public tables, found %', n;
  END IF;

  -- 3. Key RPCs restored (the app talks only through these).
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'api'
     AND p.proname IN ('quote_order','place_order','healthz','catalog_facets');
  IF n < 4 THEN
    RAISE EXCEPTION 'FAIL: expected the 4 core api RPCs, found %', n;
  END IF;

  -- 4. RLS is still enabled on a sensitive table (posture survived the restore).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = 'orders' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on public.orders after restore';
  END IF;

  -- 5. Catalog data actually came back (a schema-only "restore" would pass 1-4).
  SELECT count(*) INTO v_products FROM public.products;
  IF v_products < 1 THEN
    RAISE EXCEPTION 'FAIL: no products restored (catalog empty)';
  END IF;

  -- 6. A real read RPC executes against the restored rows and returns catalog
  --    facets (exercises private.* helpers + the api surface end to end).
  SELECT api.catalog_facets() INTO v_facets;
  IF v_facets IS NULL OR jsonb_typeof(v_facets) <> 'object' THEN
    RAISE EXCEPTION 'FAIL: api.catalog_facets() did not return an object post-restore';
  END IF;

  SELECT count(*) INTO v_orders FROM public.orders;

  RAISE NOTICE 'restore_verify OK — % products, % orders, % order_items; schemas+tables+RPCs+RLS intact, catalog_facets() live.',
    v_products, v_orders, (SELECT count(*) FROM public.order_items);
END $$;
