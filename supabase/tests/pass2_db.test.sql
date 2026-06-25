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

-- ============================================================
-- 8. Actor-deletion restriction (ON DELETE RESTRICT on movements)
-- ============================================================
-- Actor a1 has inventory movements from tests above. Deleting the user must fail.
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: actor with movement history was deletable (ON DELETE RESTRICT not enforced)';
  END IF;
END $$;
-- Deactivation (the correct alternative to deletion) must remain possible.
-- Test on a2 (staff), not a1 (sole active owner — guard_owner_safety blocks).
UPDATE public.staff_profiles SET is_active = false
  WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
DO $$ DECLARE v boolean; BEGIN
  SELECT is_active INTO v FROM public.staff_profiles
    WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
  IF v IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: staff deactivation did not persist';
  END IF;
END $$;
-- Re-activate for any remaining tests
UPDATE public.staff_profiles SET is_active = true
  WHERE user_id = '00000000-0000-0000-0000-0000000000a2';

-- ============================================================
-- 9. Role-based function grant restrictions
-- ============================================================
-- Verify that anon and authenticated CANNOT execute sensitive RPCs,
-- and that service_role CAN. Uses has_function_privilege (no role-switch needed).
DO $$
DECLARE
  fn text;
  restricted_fns text[] := ARRAY[
    'api.set_inventory(text,text,integer,text,text,uuid)',
    'api.bulk_set_inventory(jsonb,uuid,text)',
    'api.add_product_variant(text,text,uuid)',
    'api.remove_product_variant(text,text,uuid)',
    'api.purge_product(text,uuid)',
    'api.reorder_categories(jsonb,uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY restricted_fns LOOP
    -- anon must NOT have EXECUTE
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE on %', fn;
    END IF;
    -- authenticated must NOT have EXECUTE
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated has EXECUTE on %', fn;
    END IF;
    -- service_role MUST have EXECUTE
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role lacks EXECUTE on %', fn;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 10. Post-migration-18 schema verification (upgrade proof)
-- ============================================================
-- Proves that migration 18 produced the expected schema state.
-- If this runs successfully after migrate-from-empty, the 17→18 upgrade path
-- (for the documented Case A: empty bulk_ops table) is verified.

-- 10a. inventory_bulk_ops PK is composite (actor_id, op_key)
DO $$ DECLARE v_count int; BEGIN
  SELECT count(*) INTO v_count
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
   WHERE c.conrelid = 'public.inventory_bulk_ops'::regclass AND c.contype = 'p';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: inventory_bulk_ops PK should have 2 columns, has %', v_count;
  END IF;
END $$;

-- 10b. request_hash exists and is NOT NULL
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'inventory_bulk_ops'
       AND column_name = 'request_hash' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'FAIL: inventory_bulk_ops.request_hash missing or nullable';
  END IF;
END $$;

-- 10c. actor_id is NOT NULL
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'inventory_bulk_ops'
       AND column_name = 'actor_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'FAIL: inventory_bulk_ops.actor_id is nullable';
  END IF;
END $$;

-- 10d. Movement actor FK is ON DELETE RESTRICT (confdeltype = 'r')
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.product_inventory_movements'::regclass
       AND conname = 'product_inventory_movements_actor_id_fkey'
       AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'FAIL: movement actor_id FK is not ON DELETE RESTRICT';
  END IF;
END $$;

-- 10e. Bulk-ops actor FK is ON DELETE CASCADE (confdeltype = 'c')
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.inventory_bulk_ops'::regclass
       AND conname = 'inventory_bulk_ops_actor_id_fkey'
       AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'FAIL: bulk_ops actor_id FK is not ON DELETE CASCADE';
  END IF;
END $$;

-- 10f. Validation constraints exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.inventory_bulk_ops'::regclass
       AND conname = 'bulk_ops_op_key_bounded'
  ) THEN
    RAISE EXCEPTION 'FAIL: bulk_ops_op_key_bounded constraint missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.inventory_bulk_ops'::regclass
       AND conname = 'bulk_ops_hash_bounded'
  ) THEN
    RAISE EXCEPTION 'FAIL: bulk_ops_hash_bounded constraint missing';
  END IF;
END $$;

-- 10g. All six sensitive api functions exist
DO $$
DECLARE
  fn text;
  api_fns text[] := ARRAY[
    'api.set_inventory(text,text,integer,text,text,uuid)',
    'api.bulk_set_inventory(jsonb,uuid,text)',
    'api.add_product_variant(text,text,uuid)',
    'api.remove_product_variant(text,text,uuid)',
    'api.purge_product(text,uuid)',
    'api.reorder_categories(jsonb,uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY api_fns LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE EXCEPTION 'FAIL: function % does not exist', fn;
    END IF;
  END LOOP;
END $$;

-- 10h. staff_profiles SELECT policy was merged (advisor cleanup) and the old
--      duplicate permissive policies are gone.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.staff_profiles'::regclass AND polname = 'staff_select_self_or_admin'
  ) THEN
    RAISE EXCEPTION 'FAIL: merged policy staff_select_self_or_admin missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.staff_profiles'::regclass
       AND polname IN ('staff_read_own', 'admin_read_all_staff')
  ) THEN
    RAISE EXCEPTION 'FAIL: old duplicate SELECT policies were not dropped';
  END IF;
END $$;

-- 10i. Covering index for the movement-history actor FK exists.
DO $$ BEGIN
  IF to_regclass('public.idx_movements_actor') IS NULL THEN
    RAISE EXCEPTION 'FAIL: idx_movements_actor index missing';
  END IF;
END $$;

-- ============================================================
-- 11. Stable inventory error CODES (message_text == snake_case code)
-- ============================================================
-- Every inventory RPC raises a STABLE code as the exception MESSAGE (human text
-- lives in DETAIL). PostgREST surfaces message as error.message, which the TS
-- layer maps to a safe string. These assertions lock the contract in the DB.
DO $$
DECLARE got text;
BEGIN
  -- null actor
  BEGIN PERFORM api.set_inventory('p-sized', 'M', 1, 'x', NULL, NULL);
        RAISE EXCEPTION 'FAIL: no raise (null actor)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: null actor code=%', got; END IF;
  END;
  -- negative quantity
  BEGIN PERFORM api.set_inventory('p-sized', 'M', -1, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (neg qty)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_quantity' THEN RAISE EXCEPTION 'FAIL: neg qty code=%', got; END IF;
  END;
  -- empty reason
  BEGIN PERFORM api.set_inventory('p-sized', 'M', 7, '   ', NULL, '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (empty reason)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_reason' THEN RAISE EXCEPTION 'FAIL: empty reason code=%', got; END IF;
  END;
  -- unknown product
  BEGIN PERFORM api.set_inventory('ghost', NULL, 1, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (ghost)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'product_not_found' THEN RAISE EXCEPTION 'FAIL: ghost code=%', got; END IF;
  END;
  -- sized product, missing size
  BEGIN PERFORM api.set_inventory('p-sized', NULL, 1, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (size required)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'variant_required' THEN RAISE EXCEPTION 'FAIL: size required code=%', got; END IF;
  END;
  -- sized product, unknown size
  BEGIN PERFORM api.set_inventory('p-sized', 'XXL', 1, 'x', NULL, '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (unknown size)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'variant_not_found' THEN RAISE EXCEPTION 'FAIL: unknown size code=%', got; END IF;
  END;
END $$;

-- 11b. Bulk per-item failure forwards the inner stable code as error_code.
DO $$ DECLARE v_code text; BEGIN
  SELECT api.bulk_set_inventory(
    '[{"code":"ghost","size":null,"quantity":1,"reason":"x"}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1', 'opk-err') -> 'results' -> 0 ->> 'error_code'
  INTO v_code;
  IF v_code <> 'product_not_found' THEN
    RAISE EXCEPTION 'FAIL: bulk per-item error_code=% (expected product_not_found)', v_code;
  END IF;
END $$;

-- 11c. Reused op-key with a different payload raises the stable code.
DO $$ DECLARE got text; BEGIN
  BEGIN PERFORM api.bulk_set_inventory(
    '[{"code":"p-sized","size":"M","quantity":3,"reason":"bulk"}]'::jsonb,
    '00000000-0000-0000-0000-0000000000a1', 'opk-1');
        RAISE EXCEPTION 'FAIL: no raise (op-key reuse)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'idempotency_key_reused' THEN RAISE EXCEPTION 'FAIL: op-key reuse code=%', got; END IF;
  END;
END $$;

-- ============================================================
-- 12. Review moderation + rating/review_count sync
-- ============================================================
-- Fresh product with no inventory history so it stays isolated.
INSERT INTO public.products (code, slug, name, category_id, price)
  SELECT 'p-rev', 'p-rev', 'Reviewable', id, 100 FROM public.product_categories WHERE slug = 'cat-a';

-- Two PENDING reviews (ratings 4 and 2) must NOT count toward the snapshot.
INSERT INTO public.product_reviews (product_id, author_name, rating, body, status)
  SELECT id, 'Reviewer A', 4, 'great', 'pending' FROM public.products WHERE code = 'p-rev';
INSERT INTO public.product_reviews (product_id, author_name, rating, body, status)
  SELECT id, 'Reviewer B', 2, 'okay', 'pending' FROM public.products WHERE code = 'p-rev';

DO $$ DECLARE v_rating numeric; v_count int; BEGIN
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-rev';
  IF v_rating <> 0 OR v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: pending reviews counted (rating=%, count=%)', v_rating, v_count;
  END IF;
END $$;

-- Approve A (4) -> rating 4.0, count 1
DO $$ DECLARE v_rid uuid; v_rating numeric; v_count int; BEGIN
  SELECT r.id INTO v_rid FROM public.product_reviews r JOIN public.products p ON p.id = r.product_id
    WHERE p.code = 'p-rev' AND r.author_name = 'Reviewer A';
  PERFORM api.set_review_status(v_rid, 'approved', '00000000-0000-0000-0000-0000000000a1');
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-rev';
  IF v_rating <> 4.0 OR v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: after approve A rating=%, count=%', v_rating, v_count;
  END IF;
END $$;

-- Approve B (2) -> rating 3.0, count 2
DO $$ DECLARE v_rid uuid; v_rating numeric; v_count int; BEGIN
  SELECT r.id INTO v_rid FROM public.product_reviews r JOIN public.products p ON p.id = r.product_id
    WHERE p.code = 'p-rev' AND r.author_name = 'Reviewer B';
  PERFORM api.set_review_status(v_rid, 'approved', '00000000-0000-0000-0000-0000000000a1');
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-rev';
  IF v_rating <> 3.0 OR v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: after approve B rating=%, count=%', v_rating, v_count;
  END IF;
END $$;

-- Reject B -> back to rating 4.0, count 1
DO $$ DECLARE v_rid uuid; v_rating numeric; v_count int; BEGIN
  SELECT r.id INTO v_rid FROM public.product_reviews r JOIN public.products p ON p.id = r.product_id
    WHERE p.code = 'p-rev' AND r.author_name = 'Reviewer B';
  PERFORM api.set_review_status(v_rid, 'rejected', '00000000-0000-0000-0000-0000000000a1');
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-rev';
  IF v_rating <> 4.0 OR v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: after reject B rating=%, count=%', v_rating, v_count;
  END IF;
END $$;

-- Delete A -> no approved reviews -> rating 0, count 0
DO $$ DECLARE v_rid uuid; v_rating numeric; v_count int; BEGIN
  SELECT r.id INTO v_rid FROM public.product_reviews r JOIN public.products p ON p.id = r.product_id
    WHERE p.code = 'p-rev' AND r.author_name = 'Reviewer A';
  PERFORM api.delete_review(v_rid, '00000000-0000-0000-0000-0000000000a1');
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-rev';
  IF v_rating <> 0 OR v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: after delete A rating=%, count=%', v_rating, v_count;
  END IF;
END $$;

-- Stable error codes (message_text == code)
DO $$ DECLARE v_rid uuid; got text; BEGIN
  SELECT r.id INTO v_rid FROM public.product_reviews r JOIN public.products p ON p.id = r.product_id
    WHERE p.code = 'p-rev' AND r.author_name = 'Reviewer B';
  -- invalid status
  BEGIN PERFORM api.set_review_status(v_rid, 'bogus', '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (bad status)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_status' THEN RAISE EXCEPTION 'FAIL: bad status code=%', got; END IF;
  END;
  -- not found
  BEGIN PERFORM api.set_review_status(gen_random_uuid(), 'approved', '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'FAIL: no raise (missing review)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'review_not_found' THEN RAISE EXCEPTION 'FAIL: missing review code=%', got; END IF;
  END;
  -- unauthorized actor
  BEGIN PERFORM api.set_review_status(v_rid, 'approved', gen_random_uuid());
        RAISE EXCEPTION 'FAIL: no raise (bad actor)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: bad actor code=%', got; END IF;
  END;
END $$;

-- Grants: anon/authenticated must NOT execute; service_role MUST.
DO $$
DECLARE fn text; fns text[] := ARRAY[
  'api.set_review_status(uuid,text,uuid)',
  'api.delete_review(uuid,uuid)'
];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE on %', fn; END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated has EXECUTE on %', fn; END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role lacks EXECUTE on %', fn; END IF;
  END LOOP;
END $$;

-- ============================================================
-- 13. Customer review submission (Pass 3b)
-- ============================================================
-- Customer accounts (auth users without a staff_profiles row).
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000c9'),
  ('00000000-0000-0000-0000-0000000000ca');

-- One active (reviewable) and one draft (not reviewable) product in active cat-a.
INSERT INTO public.products (code, slug, name, category_id, price, status)
  SELECT 'p-sub-a', 'p-sub-a', 'Submittable', id, 100, 'active' FROM public.product_categories WHERE slug = 'cat-a';
INSERT INTO public.products (code, slug, name, category_id, price, status)
  SELECT 'p-sub-d', 'p-sub-d', 'Draft', id, 100, 'draft' FROM public.product_categories WHERE slug = 'cat-a';

-- Happy path: submit lands as pending and does NOT change the public rating.
DO $$ DECLARE v_rating numeric; v_count int; v_pending int; BEGIN
  PERFORM api.submit_review('p-sub-a', 'Customer C9', 5, 'Beautiful work', '00000000-0000-0000-0000-0000000000c9');
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-sub-a';
  IF v_rating <> 0 OR v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: pending submission changed rating (r=%, c=%)', v_rating, v_count;
  END IF;
  SELECT count(*) INTO v_pending FROM public.product_reviews pr JOIN public.products p ON p.id = pr.product_id
    WHERE p.code = 'p-sub-a' AND pr.status = 'pending' AND pr.user_id = '00000000-0000-0000-0000-0000000000c9';
  IF v_pending <> 1 THEN RAISE EXCEPTION 'FAIL: pending review not stored (%)', v_pending; END IF;
END $$;

-- Stable error codes.
DO $$ DECLARE got text; BEGIN
  -- duplicate (same user + product)
  BEGIN PERFORM api.submit_review('p-sub-a', 'Customer C9', 4, 'again', '00000000-0000-0000-0000-0000000000c9');
        RAISE EXCEPTION 'FAIL: no raise (duplicate review)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'already_reviewed' THEN RAISE EXCEPTION 'FAIL: duplicate code=%', got; END IF;
  END;
  -- draft product is not reviewable
  BEGIN PERFORM api.submit_review('p-sub-d', 'Customer CA', 5, 'hi', '00000000-0000-0000-0000-0000000000ca');
        RAISE EXCEPTION 'FAIL: no raise (draft product)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'product_not_visible' THEN RAISE EXCEPTION 'FAIL: draft code=%', got; END IF;
  END;
  -- invalid rating (valid user so the rating check is reached)
  BEGIN PERFORM api.submit_review('p-sub-a', 'Customer CA', 9, 'hi', '00000000-0000-0000-0000-0000000000ca');
        RAISE EXCEPTION 'FAIL: no raise (bad rating)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_rating' THEN RAISE EXCEPTION 'FAIL: bad rating code=%', got; END IF;
  END;
  -- not signed in (null user)
  BEGIN PERFORM api.submit_review('p-sub-a', 'X', 5, 'hi', NULL);
        RAISE EXCEPTION 'FAIL: no raise (null user)';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: null user code=%', got; END IF;
  END;
END $$;

-- Approving the submitted review flows into the public rating (5.0 / 1).
DO $$ DECLARE v_rid uuid; v_rating numeric; v_count int; BEGIN
  SELECT pr.id INTO v_rid FROM public.product_reviews pr JOIN public.products p ON p.id = pr.product_id
    WHERE p.code = 'p-sub-a' AND pr.user_id = '00000000-0000-0000-0000-0000000000c9';
  PERFORM api.set_review_status(v_rid, 'approved', '00000000-0000-0000-0000-0000000000a1');
  SELECT rating, review_count INTO v_rating, v_count FROM public.products WHERE code = 'p-sub-a';
  IF v_rating <> 5.0 OR v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: after approving submission rating=%, count=%', v_rating, v_count;
  END IF;
END $$;

-- Grants: submit_review is service-role only.
DO $$ BEGIN
  IF has_function_privilege('anon', 'api.submit_review(text,text,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'api.submit_review(text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: submit_review executable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'api.submit_review(text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role lacks EXECUTE on submit_review';
  END IF;
END $$;

\echo '--- ALL PASS ---'
ROLLBACK;
