-- Stage 4 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty). P1 covers the customer-account SCHEMA
-- invariants (no behavior yet — the api.* account RPCs arrive in P2 and their
-- sections will be appended here):
--   * RPC-only posture: RLS enabled, anon/authenticated hold no direct grants
--   * CHECK bounds: name/phone/birthday/address fields, measurement ranges,
--     fit_preference enum
--   * at-most-one default address per user (partial unique index) — per user,
--     not global
--   * case-insensitive measurement-name dedupe per user
--   * updated_at touch trigger overrides an explicit stale value
--   * auth.users delete cascades through all three tables
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

ROLLBACK;
