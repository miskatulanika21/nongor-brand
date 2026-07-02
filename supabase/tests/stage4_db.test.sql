-- Stage 4 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty).
--
-- §1–§6 (P1) cover the customer-account SCHEMA invariants:
--   * RPC-only posture: RLS enabled, anon/authenticated hold no direct grants
--   * CHECK bounds: name/phone/birthday/address fields, measurement ranges,
--     fit_preference enum
--   * at-most-one default address per user (partial unique index) — per user,
--     not global
--   * case-insensitive measurement-name dedupe per user
--   * updated_at touch trigger overrides an explicit stale value
--   * auth.users delete cascades through all three tables
--
-- §7–§12 (P2) cover the account RPC behavior:
--   * save_profile: lazy create (name required), CASE-presence patch, clears,
--     stable invalid_profile / invalid_phone / invalid_birthday codes
--   * upsert/delete/set_default address: first-is-default, atomic default
--     re-point, un-default → oldest promoted, delete-default → promotion,
--     owner scoping (address_not_found), cap 10 (too_many_addresses)
--   * upsert/delete measurement: strict numerics, patch + clear, dup name
--     (duplicate_measurement_name), cap 12 (too_many_measurements)
--   * get_my_account composite shape; null/unknown user → actor_not_authorized
--   * import_account_data: one-shot (already_imported), row-by-row salvage
--     (bad row skipped, bad phone/numeric coerced NULL), single default,
--     caps, account.imported audit row in-transaction
--   * grant posture: all 8 api.* account RPCs are service-role-only
--
-- Conventions (same as pass2/pass3/pass4): expected-SUCCESS runs plainly;
-- expected-FAILURE wraps in a sub-block and RAISE 'FAIL:' if it did NOT raise;
-- value checks RAISE 'FAIL:' on a violated invariant.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000c1'),  -- customer 1
  ('00000000-0000-0000-0000-0000000000c2');  -- customer 2

-- ============================================================
-- §1 — RPC-only posture: RLS on, no direct anon/authenticated grants
-- ============================================================
DO $$
DECLARE t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_profiles','saved_addresses','saved_measurements'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'FAIL: RLS disabled on %', t; END IF;
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('anon', 'public.' || t, p) THEN
        RAISE EXCEPTION 'FAIL: anon holds % on %', p, t; END IF;
      IF has_table_privilege('authenticated', 'public.' || t, p) THEN
        RAISE EXCEPTION 'FAIL: authenticated holds % on %', p, t; END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL: service_role lacks SELECT on %', t; END IF;
  END LOOP;
END $$;

-- ============================================================
-- §2 — customer_profiles: CHECK bounds + one row per user
-- ============================================================
DO $$
BEGIN
  -- happy path
  INSERT INTO public.customer_profiles (user_id, full_name, phone, birthday)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'Customer One', '01712345678', DATE '1990-05-01');

  -- empty name
  BEGIN
    INSERT INTO public.customer_profiles (user_id, full_name)
      VALUES ('00000000-0000-0000-0000-0000000000c2', '');
    RAISE EXCEPTION 'FAIL: s2 empty full_name accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- malformed phone (not normalized BD mobile)
  BEGIN
    INSERT INTO public.customer_profiles (user_id, full_name, phone)
      VALUES ('00000000-0000-0000-0000-0000000000c2', 'X', '01112345678');
    RAISE EXCEPTION 'FAIL: s2 bad phone accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- birthday out of range (too old / in the future)
  BEGIN
    INSERT INTO public.customer_profiles (user_id, full_name, birthday)
      VALUES ('00000000-0000-0000-0000-0000000000c2', 'X', DATE '1850-01-01');
    RAISE EXCEPTION 'FAIL: s2 1850 birthday accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.customer_profiles (user_id, full_name, birthday)
      VALUES ('00000000-0000-0000-0000-0000000000c2', 'X', CURRENT_DATE + 1);
    RAISE EXCEPTION 'FAIL: s2 future birthday accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- one row per user (PK)
  BEGIN
    INSERT INTO public.customer_profiles (user_id, full_name)
      VALUES ('00000000-0000-0000-0000-0000000000c1', 'Duplicate');
    RAISE EXCEPTION 'FAIL: s2 duplicate profile accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- ============================================================
-- §3 — saved_addresses: bounds + at-most-one default PER USER
-- ============================================================
DO $$
BEGIN
  -- happy path: c1 gets a default and a non-default
  INSERT INTO public.saved_addresses (user_id, label, recipient, phone, district, area, address, is_default)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'Home', 'Customer One', '01712345678',
            'Dhaka', 'Dhanmondi', 'House 1, Road 2', true);
  INSERT INTO public.saved_addresses (user_id, recipient, district, area, address)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'Customer One', 'Dhaka', 'Gulshan', 'House 9');

  -- a SECOND default for the same user violates the partial unique index
  BEGIN
    INSERT INTO public.saved_addresses (user_id, recipient, district, area, address, is_default)
      VALUES ('00000000-0000-0000-0000-0000000000c1', 'Dup Default', 'Dhaka', 'Uttara', 'House 3', true);
    RAISE EXCEPTION 'FAIL: s3 second default accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- …but a different user's default is fine (invariant is per user)
  INSERT INTO public.saved_addresses (user_id, recipient, district, area, address, is_default)
    VALUES ('00000000-0000-0000-0000-0000000000c2', 'Customer Two', 'Chattogram', 'Agrabad', 'Flat 2B', true);

  -- bounds
  BEGIN
    INSERT INTO public.saved_addresses (user_id, recipient, district, area, address)
      VALUES ('00000000-0000-0000-0000-0000000000c2', '', 'Dhaka', 'X', 'Y');
    RAISE EXCEPTION 'FAIL: s3 empty recipient accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.saved_addresses (user_id, recipient, district, area, address)
      VALUES ('00000000-0000-0000-0000-0000000000c2', 'R', 'Dhaka', 'X', repeat('a', 501));
    RAISE EXCEPTION 'FAIL: s3 501-char address accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.saved_addresses (user_id, recipient, phone, district, area, address)
      VALUES ('00000000-0000-0000-0000-0000000000c2', 'R', '12345', 'Dhaka', 'X', 'Y');
    RAISE EXCEPTION 'FAIL: s3 bad phone accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.saved_addresses (user_id, label, recipient, district, area, address)
      VALUES ('00000000-0000-0000-0000-0000000000c2', repeat('l', 41), 'R', 'Dhaka', 'X', 'Y');
    RAISE EXCEPTION 'FAIL: s3 41-char label accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ============================================================
-- §4 — saved_measurements: bounds + case-insensitive name dedupe
-- ============================================================
DO $$
BEGIN
  -- happy path (partial fields are fine)
  INSERT INTO public.saved_measurements (user_id, name, bust, waist, fit_preference)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'Everyday', 36.5, 30, 'Fitted');

  -- duplicate name, different case, same user → rejected
  BEGIN
    INSERT INTO public.saved_measurements (user_id, name)
      VALUES ('00000000-0000-0000-0000-0000000000c1', 'EVERYDAY');
    RAISE EXCEPTION 'FAIL: s4 case-dup name accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- same name for a DIFFERENT user is fine
  INSERT INTO public.saved_measurements (user_id, name)
    VALUES ('00000000-0000-0000-0000-0000000000c2', 'Everyday');

  -- bounds
  BEGIN
    INSERT INTO public.saved_measurements (user_id, name)
      VALUES ('00000000-0000-0000-0000-0000000000c1', '');
    RAISE EXCEPTION 'FAIL: s4 empty name accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.saved_measurements (user_id, name, bust)
      VALUES ('00000000-0000-0000-0000-0000000000c1', 'Zero', 0);
    RAISE EXCEPTION 'FAIL: s4 zero bust accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.saved_measurements (user_id, name, dress_length)
      VALUES ('00000000-0000-0000-0000-0000000000c1', 'Huge', 250);
    RAISE EXCEPTION 'FAIL: s4 250in dress_length accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.saved_measurements (user_id, name, fit_preference)
      VALUES ('00000000-0000-0000-0000-0000000000c1', 'BadFit', 'Baggy');
    RAISE EXCEPTION 'FAIL: s4 bad fit_preference accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ============================================================
-- §5 — updated_at touch trigger (overrides an explicit stale value)
-- ============================================================
-- now() is transaction-frozen, so "did it advance" cannot be observed here;
-- instead assert the trigger OVERRIDES an explicitly-set stale updated_at.
DO $$
DECLARE ts timestamptz;
BEGIN
  UPDATE public.customer_profiles
     SET full_name = 'Customer One R', updated_at = TIMESTAMPTZ '2000-01-01'
   WHERE user_id = '00000000-0000-0000-0000-0000000000c1';
  SELECT updated_at INTO ts FROM public.customer_profiles
   WHERE user_id = '00000000-0000-0000-0000-0000000000c1';
  IF ts = TIMESTAMPTZ '2000-01-01' THEN
    RAISE EXCEPTION 'FAIL: s5 profiles touch trigger inert'; END IF;

  UPDATE public.saved_addresses
     SET area = 'Banani', updated_at = TIMESTAMPTZ '2000-01-01'
   WHERE user_id = '00000000-0000-0000-0000-0000000000c1' AND is_default;
  IF EXISTS (SELECT 1 FROM public.saved_addresses
              WHERE user_id = '00000000-0000-0000-0000-0000000000c1'
                AND updated_at = TIMESTAMPTZ '2000-01-01') THEN
    RAISE EXCEPTION 'FAIL: s5 addresses touch trigger inert'; END IF;

  UPDATE public.saved_measurements
     SET waist = 31, updated_at = TIMESTAMPTZ '2000-01-01'
   WHERE user_id = '00000000-0000-0000-0000-0000000000c1' AND name = 'Everyday';
  IF EXISTS (SELECT 1 FROM public.saved_measurements
              WHERE user_id = '00000000-0000-0000-0000-0000000000c1'
                AND updated_at = TIMESTAMPTZ '2000-01-01') THEN
    RAISE EXCEPTION 'FAIL: s5 measurements touch trigger inert'; END IF;
END $$;

-- ============================================================
-- §6 — auth.users delete cascades through all three tables
-- ============================================================
DO $$
BEGIN
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF EXISTS (SELECT 1 FROM public.customer_profiles
              WHERE user_id = '00000000-0000-0000-0000-0000000000c1')
     OR EXISTS (SELECT 1 FROM public.saved_addresses
                 WHERE user_id = '00000000-0000-0000-0000-0000000000c1')
     OR EXISTS (SELECT 1 FROM public.saved_measurements
                 WHERE user_id = '00000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'FAIL: s6 cascade left rows behind';
  END IF;
  -- c2's rows are untouched
  IF (SELECT count(*) FROM public.saved_addresses
       WHERE user_id = '00000000-0000-0000-0000-0000000000c2') <> 1 THEN
    RAISE EXCEPTION 'FAIL: s6 cascade crossed users';
  END IF;
END $$;

-- ── P2 fixtures (fresh users; c1 was cascaded away in §6) ────────────────────
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000c3'),  -- RPC behavior user
  ('00000000-0000-0000-0000-0000000000c4');  -- import user

-- ============================================================
-- §7 — save_profile: lazy create, patch, clears, stable codes
-- ============================================================
DO $$
DECLARE r jsonb; got text;
BEGIN
  -- creating without a name is rejected
  BEGIN
    r := api.save_profile('00000000-0000-0000-0000-0000000000c3', '{"phone":"01712345678"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s7 create without name allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_profile' THEN RAISE EXCEPTION 'FAIL: s7 code=%', got; END IF; END;

  r := api.save_profile('00000000-0000-0000-0000-0000000000c3',
    '{"full_name":" Rina Akter ","phone":"01712345678","birthday":"1992-03-04"}'::jsonb);
  IF r->>'full_name' <> 'Rina Akter' OR r->>'phone' <> '01712345678' THEN
    RAISE EXCEPTION 'FAIL: s7 create %', r; END IF;

  -- patch only the phone → name untouched
  r := api.save_profile('00000000-0000-0000-0000-0000000000c3', '{"phone":"01898765432"}'::jsonb);
  IF r->>'full_name' <> 'Rina Akter' OR r->>'phone' <> '01898765432' THEN
    RAISE EXCEPTION 'FAIL: s7 patch %', r; END IF;

  -- present-but-null clears
  r := api.save_profile('00000000-0000-0000-0000-0000000000c3', '{"birthday":null}'::jsonb);
  IF r->'birthday' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL: s7 clear %', r; END IF;

  BEGIN
    r := api.save_profile('00000000-0000-0000-0000-0000000000c3', '{"phone":"0199"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s7 bad phone allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_phone' THEN RAISE EXCEPTION 'FAIL: s7 phone code=%', got; END IF; END;
  BEGIN
    r := api.save_profile('00000000-0000-0000-0000-0000000000c3', '{"birthday":"not-a-date"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s7 bad birthday allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_birthday' THEN RAISE EXCEPTION 'FAIL: s7 bday code=%', got; END IF; END;
END $$;

-- ============================================================
-- §8 — address RPCs: defaults, promotion, scoping, cap
-- ============================================================
DO $$
DECLARE r jsonb; a1 uuid; a2 uuid; a3 uuid; got text; n integer; i integer;
BEGIN
  -- first address becomes the default even when not requested
  r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
    '{"recipient":"Rina","phone":"01712345678","district":"Dhaka","area":"Dhanmondi","address":"House 1"}'::jsonb);
  a1 := (r->>'id')::uuid;
  IF NOT (r->>'is_default')::boolean THEN RAISE EXCEPTION 'FAIL: s8 first not default'; END IF;

  r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
    '{"recipient":"Rina","district":"Dhaka","area":"Gulshan","address":"House 2"}'::jsonb);
  a2 := (r->>'id')::uuid;
  IF (r->>'is_default')::boolean THEN RAISE EXCEPTION 'FAIL: s8 second default'; END IF;

  -- explicit default on create atomically re-points
  r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
    '{"recipient":"Rina","district":"Dhaka","area":"Banani","address":"House 3","is_default":true}'::jsonb);
  a3 := (r->>'id')::uuid;
  SELECT count(*) INTO n FROM public.saved_addresses
   WHERE user_id = '00000000-0000-0000-0000-0000000000c3' AND is_default;
  IF n <> 1 OR NOT (SELECT is_default FROM public.saved_addresses WHERE id = a3) THEN
    RAISE EXCEPTION 'FAIL: s8 default flip'; END IF;

  -- set_default_address re-points
  r := api.set_default_address('00000000-0000-0000-0000-0000000000c3', a1);
  IF NOT (r->>'is_default')::boolean THEN RAISE EXCEPTION 'FAIL: s8 set_default'; END IF;

  -- un-defaulting the default → the oldest is (re-)promoted; invariant holds
  r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', a1, '{"is_default":false}'::jsonb);
  SELECT count(*) INTO n FROM public.saved_addresses
   WHERE user_id = '00000000-0000-0000-0000-0000000000c3' AND is_default;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: s8 normalize count %', n; END IF;

  -- deleting the default promotes another row
  PERFORM api.delete_address('00000000-0000-0000-0000-0000000000c3',
    (SELECT id FROM public.saved_addresses
      WHERE user_id = '00000000-0000-0000-0000-0000000000c3' AND is_default));
  SELECT count(*) INTO n FROM public.saved_addresses
   WHERE user_id = '00000000-0000-0000-0000-0000000000c3' AND is_default;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: s8 post-delete default %', n; END IF;

  -- owner scoping: another user cannot touch the row
  BEGIN
    r := api.upsert_address('00000000-0000-0000-0000-0000000000c4', a2, '{"area":"Hijack"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s8 cross-user patch allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'address_not_found' THEN RAISE EXCEPTION 'FAIL: s8 scope code=%', got; END IF; END;

  -- bounds + phone codes
  BEGIN
    r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
      '{"recipient":"","district":"Dhaka","area":"X","address":"Y"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s8 empty recipient allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_address' THEN RAISE EXCEPTION 'FAIL: s8 bounds code=%', got; END IF; END;
  BEGIN
    r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
      '{"recipient":"R","phone":"123","district":"Dhaka","area":"X","address":"Y"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s8 bad phone allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_phone' THEN RAISE EXCEPTION 'FAIL: s8 phone code=%', got; END IF; END;

  -- cap 10: fill up, then the 11th is rejected
  SELECT count(*) INTO n FROM public.saved_addresses
   WHERE user_id = '00000000-0000-0000-0000-0000000000c3';
  FOR i IN 1..(10 - n) LOOP
    PERFORM api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
      jsonb_build_object('recipient','R','district','Dhaka','area','A'||i,'address','H'||i));
  END LOOP;
  BEGIN
    r := api.upsert_address('00000000-0000-0000-0000-0000000000c3', NULL,
      '{"recipient":"R","district":"Dhaka","area":"Z","address":"Z"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s8 11th address allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'too_many_addresses' THEN RAISE EXCEPTION 'FAIL: s8 cap code=%', got; END IF; END;
END $$;

-- ============================================================
-- §9 — measurement RPCs: strict numerics, dedupe, cap
-- ============================================================
DO $$
DECLARE r jsonb; m1 uuid; got text; i integer;
BEGIN
  r := api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', NULL,
    '{"name":"Everyday","bust":"36.5","waist":"30","fit_preference":"Fitted"}'::jsonb);
  m1 := (r->>'id')::uuid;
  IF (r->>'bust')::numeric <> 36.5 THEN RAISE EXCEPTION 'FAIL: s9 create %', r; END IF;

  BEGIN
    r := api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', NULL, '{"name":"EVERYDAY"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s9 dup name allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'duplicate_measurement_name' THEN RAISE EXCEPTION 'FAIL: s9 dup code=%', got; END IF; END;

  -- patch one field + clear another with ''
  r := api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', m1, '{"waist":"31","bust":""}'::jsonb);
  IF r->'bust' <> 'null'::jsonb OR (r->>'waist')::numeric <> 31 THEN
    RAISE EXCEPTION 'FAIL: s9 patch/clear %', r; END IF;

  -- strict path: garbage numeric and unknown fit are rejected
  BEGIN
    r := api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', m1, '{"hip":"abc"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s9 garbage numeric allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_measurement' THEN RAISE EXCEPTION 'FAIL: s9 garbage code=%', got; END IF; END;
  BEGIN
    r := api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', m1, '{"fit_preference":"Baggy"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s9 bad fit allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_measurement' THEN RAISE EXCEPTION 'FAIL: s9 fit code=%', got; END IF; END;

  -- cap 12
  FOR i IN 2..12 LOOP
    PERFORM api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', NULL,
      jsonb_build_object('name', 'P'||i));
  END LOOP;
  BEGIN
    r := api.upsert_measurement('00000000-0000-0000-0000-0000000000c3', NULL, '{"name":"P13"}'::jsonb);
    RAISE EXCEPTION 'FAIL: s9 13th allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'too_many_measurements' THEN RAISE EXCEPTION 'FAIL: s9 cap code=%', got; END IF; END;

  -- delete + not-found on repeat
  PERFORM api.delete_measurement('00000000-0000-0000-0000-0000000000c3', m1);
  BEGIN
    PERFORM api.delete_measurement('00000000-0000-0000-0000-0000000000c3', m1);
    RAISE EXCEPTION 'FAIL: s9 double delete allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'measurement_not_found' THEN RAISE EXCEPTION 'FAIL: s9 nf code=%', got; END IF; END;
END $$;

-- ============================================================
-- §10 — get_my_account shape + auth gate
-- ============================================================
DO $$
DECLARE r jsonb; got text;
BEGIN
  r := api.get_my_account('00000000-0000-0000-0000-0000000000c3');
  IF r->'profile'->>'full_name' <> 'Rina Akter'
     OR jsonb_array_length(r->'addresses') <> 10
     OR jsonb_array_length(r->'measurements') <> 11 THEN
    RAISE EXCEPTION 'FAIL: s10 shape (addrs=%, meas=%)',
      jsonb_array_length(r->'addresses'), jsonb_array_length(r->'measurements'); END IF;

  -- a user with no rows gets an empty, well-formed shape
  r := api.get_my_account('00000000-0000-0000-0000-0000000000c4');
  IF r->'profile' <> 'null'::jsonb OR r->'addresses' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s10 empty shape %', r; END IF;

  BEGIN
    r := api.get_my_account(NULL);
    RAISE EXCEPTION 'FAIL: s10 null user allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: s10 gate=%', got; END IF; END;
  BEGIN
    r := api.get_my_account(gen_random_uuid());
    RAISE EXCEPTION 'FAIL: s10 unknown user allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: s10 gate2=%', got; END IF; END;
END $$;

-- ============================================================
-- §11 — import_account_data: salvage, single default, audit, one-shot
-- ============================================================
DO $$
DECLARE r jsonb; got text; n integer;
BEGIN
  r := api.import_account_data('00000000-0000-0000-0000-0000000000c4', jsonb_build_object(
    'profile', jsonb_build_object('full_name','Guest Two','phone','bad-phone','birthday','1889-01-01'),
    'addresses', jsonb_build_array(
      jsonb_build_object('recipient','G2','phone','017-1234-5678','district','Dhaka','area','A','address','H1','is_default',true),
      jsonb_build_object('recipient','G2','district','Dhaka','area','B','address','H2','is_default',true),
      jsonb_build_object('recipient','','district','Dhaka','area','C','address','H3')),
    'measurements', jsonb_build_array(
      jsonb_build_object('name','Everyday','bust','abc','waist','199.99','fit_preference','weird'),
      jsonb_build_object('name','everyday'),
      jsonb_build_object('name',''))));

  -- counts: 2 addresses in / 1 skipped; 1 measurement in / 2 skipped (dup + unnamed)
  IF NOT (r->>'profile')::boolean OR (r->>'addresses')::int <> 2 OR (r->>'addresses_skipped')::int <> 1
     OR (r->>'measurements')::int <> 1 OR (r->>'measurements_skipped')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: s11 counts %', r; END IF;

  -- coercions: invalid phone/birthday/numerics land as NULL, unknown fit → Regular
  IF (SELECT phone FROM public.customer_profiles
       WHERE user_id = '00000000-0000-0000-0000-0000000000c4') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: s11 profile phone not coerced'; END IF;
  IF (SELECT bust FROM public.saved_measurements
       WHERE user_id = '00000000-0000-0000-0000-0000000000c4') IS NOT NULL
     OR (SELECT waist FROM public.saved_measurements
          WHERE user_id = '00000000-0000-0000-0000-0000000000c4') IS NOT NULL
     OR (SELECT fit_preference FROM public.saved_measurements
          WHERE user_id = '00000000-0000-0000-0000-0000000000c4') <> 'Regular' THEN
    RAISE EXCEPTION 'FAIL: s11 measure salvage'; END IF;

  -- exactly one default even though two rows claimed it
  SELECT count(*) INTO n FROM public.saved_addresses
   WHERE user_id = '00000000-0000-0000-0000-0000000000c4' AND is_default;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: s11 default count %', n; END IF;

  -- canonical audit row written in the same transaction
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE actor_id = '00000000-0000-0000-0000-0000000000c4'
                    AND action = 'account.imported') THEN
    RAISE EXCEPTION 'FAIL: s11 audit missing'; END IF;

  -- one-shot: any existing server data refuses a re-import
  BEGIN
    r := api.import_account_data('00000000-0000-0000-0000-0000000000c4', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: s11 re-import allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'already_imported' THEN RAISE EXCEPTION 'FAIL: s11 code=%', got; END IF; END;
END $$;

-- ============================================================
-- §12 — grants: account RPCs are service-role only
-- ============================================================
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'api.get_my_account(uuid)',
    'api.save_profile(uuid,jsonb)',
    'api.upsert_address(uuid,uuid,jsonb)',
    'api.delete_address(uuid,uuid)',
    'api.set_default_address(uuid,uuid)',
    'api.upsert_measurement(uuid,uuid,jsonb)',
    'api.delete_measurement(uuid,uuid)',
    'api.import_account_data(uuid,jsonb)'
  ] LOOP
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role lacks EXECUTE on %', fn; END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon can EXECUTE %', fn; END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated can EXECUTE %', fn; END IF;
  END LOOP;
END $$;

ROLLBACK;
