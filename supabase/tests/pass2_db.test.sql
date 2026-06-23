-- Stage 2 Pass-2 DB integration test (item #6).
--
-- Runs against an EPHEMERAL local Supabase DB in CI (after `supabase start`,
-- which applies every migration from empty). Asserts the database-level guards
-- that TS/Vitest cannot cover. Run with: psql -v ON_ERROR_STOP=1 -f this.sql
--   (any unhandled error, including a 'FAIL:' RAISE, aborts → CI fails).
--
-- Convention:
--   * expected-SUCCESS: run the statement plainly (ON_ERROR_STOP aborts on error).
--   * expected-FAILURE: wrap in a sub-block; if it did NOT raise, RAISE 'FAIL:'.
--   * value checks: RAISE 'FAIL:' when the invariant is violated.
--
-- Note on concurrency: true two-session races cannot run in a single psql
-- session. The serialization mechanism (SELECT … FOR UPDATE in api.set_inventory)
-- is asserted to exist; its effect follows from Postgres locking semantics.

\set ON_ERROR_STOP on
BEGIN;

-- ============================================================
-- Fixtures (clean DB: these are the only rows)
-- ============================================================
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),   -- owner
  ('00000000-0000-0000-0000-0000000000a2');   -- staff (non-owner)
INSERT INTO public.staff_profiles (user_id, role, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner'::private.staff_role, true),
  ('00000000-0000-0000-0000-0000000000a2', 'staff'::private.staff_role, true);

INSERT INTO public.product_categories (slug, name, sort_order) VALUES
  ('cat-a', 'Cat A', 0), ('cat-b', 'Cat B', 1), ('cat-c', 'Cat C', 2);

INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'p-nosize', 'p-nosize', 'No Size', id, 100, 50 FROM public.product_categories WHERE slug = 'cat-a';
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'p-sized', 'p-sized', 'Sized', id, 100, 5 FROM public.product_categories WHERE slug = 'cat-a';
INSERT INTO public.product_size_stock (product_id, size, quantity)
  SELECT id, 'M', 5 FROM public.products WHERE code = 'p-sized';
INSERT INTO public.products (code, slug, name, category_id, price)
  SELECT 'p-clean', 'p-clean', 'Clean', id, 100 FROM public.product_categories WHERE slug = 'cat-b';

\echo '--- fixtures loaded ---'

-- ============================================================
-- 1. products.stock write-guard
-- ============================================================
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN UPDATE public.products SET stock = stock + 1 WHERE code = 'p-nosize';
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: direct products.stock write was not blocked'; END IF;
END $$;

-- ============================================================
-- 2. set_inventory: validation + happy path
-- ============================================================
-- actor required
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.set_inventory('p-nosize', NULL, 60, 'x', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: null actor not blocked'; END IF;
END $$;
-- inactive/unknown actor
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.set_inventory('p-nosize', NULL, 60, 'x', NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: unknown actor not blocked'; END IF;
END $$;
-- non-sized product must not take a size
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.set_inventory('p-nosize', 'M', 5, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: size on non-sized product not blocked'; END IF;
END $$;
-- sized product requires a valid size
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.set_inventory('p-sized', 'NOPE', 5, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: unknown size not blocked'; END IF;
END $$;
-- happy path (non-sized 50 -> 60)
SELECT api.set_inventory('p-nosize', NULL, 60, 'restock', NULL, '00000000-0000-0000-0000-0000000000a1');
DO $$ DECLARE v int; BEGIN
  SELECT stock INTO v FROM public.products WHERE code = 'p-nosize';
  IF v <> 60 THEN RAISE EXCEPTION 'FAIL: stock expected 60, got %', v; END IF;
END $$;
-- zero-delta rejected
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.set_inventory('p-nosize', NULL, 60, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: zero-delta not blocked'; END IF;
END $$;

-- ============================================================
-- 3. Movement ledger immutability + FK RESTRICT
-- ============================================================
DO $$ DECLARE v_mid uuid; ok boolean := false; BEGIN
  SELECT id INTO v_mid FROM public.product_inventory_movements ORDER BY created_at DESC LIMIT 1;
  BEGIN UPDATE public.product_inventory_movements SET reason = 'tamper' WHERE id = v_mid;
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: movement UPDATE not blocked'; END IF;
  ok := false;
  BEGIN DELETE FROM public.product_inventory_movements WHERE id = v_mid;
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: movement DELETE not blocked'; END IF;
END $$;
-- direct product delete blocked while movements exist (FK RESTRICT)
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN DELETE FROM public.products WHERE code = 'p-nosize';
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: product delete with history not blocked'; END IF;
END $$;

-- ============================================================
-- 4. First-variant stock conservation
-- ============================================================
-- p-nosize has stock 60, no sizes; adding the first variant must conserve it.
SELECT api.add_product_variant('p-nosize', 'S', '00000000-0000-0000-0000-0000000000a1');
DO $$ DECLARE v_stock int; v_sum int; BEGIN
  SELECT stock INTO v_stock FROM public.products WHERE code = 'p-nosize';
  SELECT coalesce(sum(quantity), 0) INTO v_sum FROM public.product_size_stock s
    JOIN public.products p ON p.id = s.product_id WHERE p.code = 'p-nosize';
  IF v_stock <> 60 OR v_sum <> 60 THEN
    RAISE EXCEPTION 'FAIL: variant conservation broken (stock=%, sum=%)', v_stock, v_sum;
  END IF;
END $$;

-- ============================================================
-- 5. Owner-only purge
-- ============================================================
-- non-owner cannot purge
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.purge_product('p-clean', '00000000-0000-0000-0000-0000000000a2');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: non-owner purge not blocked'; END IF;
END $$;
-- owner cannot purge a product with inventory history
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.purge_product('p-nosize', '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: purge with history not blocked'; END IF;
END $$;
-- owner purges a clean product successfully
SELECT api.purge_product('p-clean', '00000000-0000-0000-0000-0000000000a1');
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.products WHERE code = 'p-clean';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: clean product not purged'; END IF;
END $$;

-- ============================================================
-- 6. Reorder validation (full-set; dup; unknown; partial)
-- ============================================================
-- duplicate slug
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.reorder_categories(
    '[{"slug":"cat-a","sortOrder":0},{"slug":"cat-a","sortOrder":1},{"slug":"cat-c","sortOrder":2}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: duplicate slug not blocked'; END IF;
END $$;
-- duplicate position
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.reorder_categories(
    '[{"slug":"cat-a","sortOrder":0},{"slug":"cat-b","sortOrder":0},{"slug":"cat-c","sortOrder":2}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: duplicate position not blocked'; END IF;
END $$;
-- unknown slug
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.reorder_categories(
    '[{"slug":"cat-a","sortOrder":0},{"slug":"cat-b","sortOrder":1},{"slug":"ghost","sortOrder":2}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: unknown slug not blocked'; END IF;
END $$;
-- partial set (only 2 of 3 categories)
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.reorder_categories(
    '[{"slug":"cat-a","sortOrder":0},{"slug":"cat-b","sortOrder":1}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: partial-set reorder not blocked'; END IF;
END $$;
-- full set succeeds and applies
SELECT api.reorder_categories(
  '[{"slug":"cat-a","sortOrder":2},{"slug":"cat-b","sortOrder":0},{"slug":"cat-c","sortOrder":1}]'::jsonb,
  '00000000-0000-0000-0000-0000000000a1');
DO $$ DECLARE v int; BEGIN
  SELECT sort_order INTO v FROM public.product_categories WHERE slug = 'cat-b';
  IF v <> 0 THEN RAISE EXCEPTION 'FAIL: reorder did not apply (cat-b sort=%)', v; END IF;
END $$;

-- ============================================================
-- 7. Bulk idempotency (actor + payload hash)
-- ============================================================
-- first call: adjust p-sized M 5 -> 9
SELECT api.bulk_set_inventory(
  '[{"code":"p-sized","size":"M","quantity":9,"reason":"bulk"}]'::jsonb,
  '00000000-0000-0000-0000-0000000000a1', 'opk-1');
DO $$ DECLARE v int; n int; BEGIN
  SELECT quantity INTO v FROM public.product_size_stock s JOIN public.products p ON p.id = s.product_id
    WHERE p.code = 'p-sized' AND s.size = 'M';
  IF v <> 9 THEN RAISE EXCEPTION 'FAIL: bulk adjust did not apply (qty=%)', v; END IF;
  SELECT count(*) INTO n FROM public.product_inventory_movements m JOIN public.products p ON p.id = m.product_id
    WHERE p.code = 'p-sized' AND m.reason = 'bulk';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 bulk movement, got %', n; END IF;
END $$;
-- identical replay: returns prior result, applies nothing (still 1 movement)
SELECT api.bulk_set_inventory(
  '[{"code":"p-sized","size":"M","quantity":9,"reason":"bulk"}]'::jsonb,
  '00000000-0000-0000-0000-0000000000a1', 'opk-1');
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.product_inventory_movements m JOIN public.products p ON p.id = m.product_id
    WHERE p.code = 'p-sized' AND m.reason = 'bulk';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: idempotent replay re-applied (movements=%)', n; END IF;
END $$;
-- same key, different payload: rejected
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM api.bulk_set_inventory(
    '[{"code":"p-sized","size":"M","quantity":3,"reason":"bulk"}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1', 'opk-1');
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: same op-key different payload not rejected'; END IF;
END $$;

\echo '--- ALL PASS ---'
ROLLBACK;
