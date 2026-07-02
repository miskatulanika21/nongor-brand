-- Stage 4 P2 — customer account RPCs (behavior over the P1 schema).
--
-- All api.* functions are SECURITY DEFINER, search_path='', service-role-only
-- EXECUTE — the server fn (P3) verifies the session and passes the user id;
-- the client NEVER picks the scope. Every write takes a per-user advisory
-- transaction lock, so one user's account writes serialize (cap counts and
-- default flips are race-free) with zero cross-user contention.
--
--   api.get_my_account(user)                     → {email, profile|null, addresses[], measurements[]}
--   api.save_profile(user, patch)                → CASE-presence patch, lazy row create
--   api.upsert_address(user, id?, address)       → insert (cap 10) or owner-scoped patch
--   api.delete_address(user, id)                 → delete + oldest-remaining default promotion
--   api.set_default_address(user, id)            → atomic re-point
--   api.upsert_measurement(user, id?, data)      → insert (cap 12) or owner-scoped patch
--   api.delete_measurement(user, id)
--   api.import_account_data(user, payload)       → ONE-TIME localStorage salvage (P4)
--
-- Stable codes: actor_not_authorized, invalid_profile, invalid_phone,
-- invalid_birthday, invalid_address, address_not_found, too_many_addresses,
-- invalid_measurement, measurement_not_found, too_many_measurements,
-- duplicate_measurement_name, already_imported.
--
-- Invariant kept by every address write: if a user has ANY addresses, exactly
-- one is the default (private.normalize_default_address promotes the oldest;
-- the P1 partial unique index remains the hard backstop).
--
-- Audit: routine self-writes are NOT audited (audit_logs is the staff-canonical
-- trail); the one-time import IS (account.imported) — plan §2/§8.

-- ── private helpers ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.assert_account_user(p_user uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'A signed-in account is required';
  END IF;
END;
$$;

-- Serializes one user's account writes (cap counting + default flips).
CREATE OR REPLACE FUNCTION private.account_write_lock(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stage4-account:' || p_user::text, 0));
END;
$$;

-- If the user has addresses but no default, promote the oldest. Idempotent.
CREATE OR REPLACE FUNCTION private.normalize_default_address(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.saved_addresses WHERE user_id = p_user AND is_default)
     AND EXISTS (SELECT 1 FROM public.saved_addresses WHERE user_id = p_user) THEN
    UPDATE public.saved_addresses SET is_default = true
     WHERE id = (SELECT id FROM public.saved_addresses
                  WHERE user_id = p_user ORDER BY created_at, id LIMIT 1);
  END IF;
END;
$$;

-- ── api.get_my_account ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.get_my_account(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_email text; v_profile jsonb; v_addresses jsonb; v_measurements jsonb;
BEGIN
  PERFORM private.assert_account_user(p_user);
  SELECT email INTO v_email FROM auth.users WHERE id = p_user;

  SELECT to_jsonb(cp) INTO v_profile
    FROM public.customer_profiles cp WHERE cp.user_id = p_user;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id), '[]'::jsonb)
    INTO v_addresses FROM public.saved_addresses a WHERE a.user_id = p_user;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_measurements FROM public.saved_measurements m WHERE m.user_id = p_user;

  RETURN jsonb_build_object(
    'email', v_email,
    'profile', v_profile,          -- JSON null until first save_profile
    'addresses', v_addresses,
    'measurements', v_measurements);
END;
$$;
REVOKE ALL ON FUNCTION api.get_my_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_my_account(uuid) TO service_role;

-- ── api.save_profile ───────────────────────────────────────────────────────────
-- CASE-presence patch: only keys present in p_patch change; a present-but-null
-- (or empty-string) phone/birthday clears the field. Lazily creates the row —
-- full_name is then required.
CREATE OR REPLACE FUNCTION api.save_profile(p_user uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exists boolean; v_name text; v_phone text; v_birthday date; v jsonb;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_profile' USING DETAIL = 'A profile patch object is required';
  END IF;

  IF p_patch ? 'full_name' THEN
    v_name := btrim(COALESCE(p_patch->>'full_name', ''));
    IF char_length(v_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'invalid_profile' USING DETAIL = 'Name must be 1-120 characters';
    END IF;
  END IF;

  IF p_patch ? 'phone' THEN
    v_phone := NULLIF(btrim(COALESCE(p_patch->>'phone', '')), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^01[3-9][0-9]{8}$' THEN
      RAISE EXCEPTION 'invalid_phone' USING DETAIL = 'Use a valid Bangladeshi mobile number';
    END IF;
  END IF;

  IF p_patch ? 'birthday' THEN
    BEGIN
      v_birthday := NULLIF(btrim(COALESCE(p_patch->>'birthday', '')), '')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_birthday' USING DETAIL = 'Use an ISO date (YYYY-MM-DD)';
    END;
    IF v_birthday IS NOT NULL AND
       (v_birthday < DATE '1900-01-01' OR v_birthday > CURRENT_DATE) THEN
      RAISE EXCEPTION 'invalid_birthday' USING DETAIL = 'Birthday out of range';
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.customer_profiles WHERE user_id = p_user) INTO v_exists;

  IF v_exists THEN
    UPDATE public.customer_profiles SET
      full_name = CASE WHEN p_patch ? 'full_name' THEN v_name     ELSE full_name END,
      phone     = CASE WHEN p_patch ? 'phone'     THEN v_phone    ELSE phone     END,
      birthday  = CASE WHEN p_patch ? 'birthday'  THEN v_birthday ELSE birthday  END
    WHERE user_id = p_user;
  ELSE
    IF NOT p_patch ? 'full_name' THEN
      RAISE EXCEPTION 'invalid_profile' USING DETAIL = 'full_name is required on first save';
    END IF;
    INSERT INTO public.customer_profiles (user_id, full_name, phone, birthday)
    VALUES (p_user, v_name, v_phone, v_birthday);
  END IF;

  SELECT to_jsonb(cp) INTO v FROM public.customer_profiles cp WHERE cp.user_id = p_user;
  RETURN v;
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_profile' USING DETAIL = 'Profile fields out of bounds';
END;
$$;
REVOKE ALL ON FUNCTION api.save_profile(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.save_profile(uuid, jsonb) TO service_role;

-- ── api.upsert_address ─────────────────────────────────────────────────────────
-- p_id NULL → create (cap 10; the user's FIRST address becomes the default even
-- if not requested). p_id set → owner-scoped CASE-presence patch. Requesting
-- is_default=true atomically re-points the single default.
CREATE OR REPLACE FUNCTION api.upsert_address(p_user uuid, p_id uuid, p_address jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer; v_phone text; v_default boolean; v_row public.saved_addresses%ROWTYPE;
  v_id uuid; v jsonb;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'invalid_address' USING DETAIL = 'An address object is required';
  END IF;

  IF p_address ? 'phone' THEN
    v_phone := NULLIF(btrim(COALESCE(p_address->>'phone', '')), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^01[3-9][0-9]{8}$' THEN
      RAISE EXCEPTION 'invalid_phone' USING DETAIL = 'Use a valid Bangladeshi mobile number';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    SELECT count(*) INTO v_count FROM public.saved_addresses WHERE user_id = p_user;
    IF v_count >= 10 THEN
      RAISE EXCEPTION 'too_many_addresses' USING DETAIL = 'At most 10 saved addresses';
    END IF;
    v_default := COALESCE((p_address->>'is_default')::boolean, false) OR v_count = 0;
    IF v_default THEN
      UPDATE public.saved_addresses SET is_default = false
       WHERE user_id = p_user AND is_default;
    END IF;
    INSERT INTO public.saved_addresses
      (user_id, label, recipient, phone, district, area, address, is_default)
    VALUES (
      p_user,
      NULLIF(btrim(COALESCE(p_address->>'label', '')), ''),
      btrim(COALESCE(p_address->>'recipient', '')),
      v_phone,
      btrim(COALESCE(p_address->>'district', '')),
      btrim(COALESCE(p_address->>'area', '')),
      btrim(COALESCE(p_address->>'address', '')),
      v_default)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_row FROM public.saved_addresses
     WHERE id = p_id AND user_id = p_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'address_not_found'; END IF;

    v_default := CASE WHEN p_address ? 'is_default'
                      THEN COALESCE((p_address->>'is_default')::boolean, false)
                      ELSE v_row.is_default END;
    IF v_default AND NOT v_row.is_default THEN
      UPDATE public.saved_addresses SET is_default = false
       WHERE user_id = p_user AND is_default;
    END IF;

    UPDATE public.saved_addresses SET
      label      = CASE WHEN p_address ? 'label'     THEN NULLIF(btrim(COALESCE(p_address->>'label', '')), '') ELSE label END,
      recipient  = CASE WHEN p_address ? 'recipient' THEN btrim(COALESCE(p_address->>'recipient', ''))         ELSE recipient END,
      phone      = CASE WHEN p_address ? 'phone'     THEN v_phone                                              ELSE phone END,
      district   = CASE WHEN p_address ? 'district'  THEN btrim(COALESCE(p_address->>'district', ''))          ELSE district END,
      area       = CASE WHEN p_address ? 'area'      THEN btrim(COALESCE(p_address->>'area', ''))              ELSE area END,
      address    = CASE WHEN p_address ? 'address'   THEN btrim(COALESCE(p_address->>'address', ''))           ELSE address END,
      is_default = v_default
    WHERE id = p_id;
    v_id := p_id;
  END IF;

  -- Un-defaulting the default (or a no-default create path) promotes the oldest.
  PERFORM private.normalize_default_address(p_user);

  SELECT to_jsonb(a) INTO v FROM public.saved_addresses a WHERE a.id = v_id;
  RETURN v;
EXCEPTION
  WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_address' USING DETAIL = 'Address fields out of bounds';
END;
$$;
REVOKE ALL ON FUNCTION api.upsert_address(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.upsert_address(uuid, uuid, jsonb) TO service_role;

-- ── api.delete_address ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.delete_address(p_user uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  DELETE FROM public.saved_addresses WHERE id = p_id AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'address_not_found'; END IF;
  PERFORM private.normalize_default_address(p_user);
  RETURN jsonb_build_object('deleted', true, 'id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION api.delete_address(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_address(uuid, uuid) TO service_role;

-- ── api.set_default_address ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.set_default_address(p_user uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  PERFORM 1 FROM public.saved_addresses WHERE id = p_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'address_not_found'; END IF;
  UPDATE public.saved_addresses SET is_default = false
   WHERE user_id = p_user AND is_default AND id <> p_id;
  UPDATE public.saved_addresses SET is_default = true WHERE id = p_id;
  SELECT to_jsonb(a) INTO v FROM public.saved_addresses a WHERE a.id = p_id;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION api.set_default_address(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_default_address(uuid, uuid) TO service_role;

-- ── api.upsert_measurement ─────────────────────────────────────────────────────
-- p_id NULL → create (cap 12, name required); p_id set → owner-scoped
-- CASE-presence patch (a present-but-null/empty field clears). Name uniqueness
-- is case-insensitive per user (P1 index) → duplicate_measurement_name.
CREATE OR REPLACE FUNCTION api.upsert_measurement(p_user uuid, p_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer; v_name text; v_fit text; v_id uuid; v jsonb;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'invalid_measurement' USING DETAIL = 'A measurement object is required';
  END IF;

  IF p_data ? 'name' THEN
    v_name := btrim(COALESCE(p_data->>'name', ''));
    IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_measurement' USING DETAIL = 'Name must be 1-80 characters';
    END IF;
  END IF;
  IF p_data ? 'fit_preference' THEN
    v_fit := btrim(COALESCE(p_data->>'fit_preference', ''));
    IF v_fit NOT IN ('Fitted','Regular','Relaxed') THEN
      RAISE EXCEPTION 'invalid_measurement' USING DETAIL = 'Unknown fit preference';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    SELECT count(*) INTO v_count FROM public.saved_measurements WHERE user_id = p_user;
    IF v_count >= 12 THEN
      RAISE EXCEPTION 'too_many_measurements' USING DETAIL = 'At most 12 measurement profiles';
    END IF;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'invalid_measurement' USING DETAIL = 'A profile name is required';
    END IF;
    INSERT INTO public.saved_measurements
      (user_id, name, bust, waist, hip, shoulder, sleeve, dress_length, fit_preference)
    VALUES (
      p_user, v_name,
      NULLIF(btrim(COALESCE(p_data->>'bust', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_data->>'waist', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_data->>'hip', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_data->>'shoulder', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_data->>'sleeve', '')), '')::numeric,
      NULLIF(btrim(COALESCE(p_data->>'dress_length', '')), '')::numeric,
      COALESCE(v_fit, 'Regular'))
    RETURNING id INTO v_id;
  ELSE
    PERFORM 1 FROM public.saved_measurements
     WHERE id = p_id AND user_id = p_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'measurement_not_found'; END IF;

    UPDATE public.saved_measurements SET
      name           = CASE WHEN p_data ? 'name'           THEN v_name ELSE name END,
      bust           = CASE WHEN p_data ? 'bust'           THEN NULLIF(btrim(COALESCE(p_data->>'bust', '')), '')::numeric         ELSE bust END,
      waist          = CASE WHEN p_data ? 'waist'          THEN NULLIF(btrim(COALESCE(p_data->>'waist', '')), '')::numeric        ELSE waist END,
      hip            = CASE WHEN p_data ? 'hip'            THEN NULLIF(btrim(COALESCE(p_data->>'hip', '')), '')::numeric          ELSE hip END,
      shoulder       = CASE WHEN p_data ? 'shoulder'       THEN NULLIF(btrim(COALESCE(p_data->>'shoulder', '')), '')::numeric     ELSE shoulder END,
      sleeve         = CASE WHEN p_data ? 'sleeve'         THEN NULLIF(btrim(COALESCE(p_data->>'sleeve', '')), '')::numeric       ELSE sleeve END,
      dress_length   = CASE WHEN p_data ? 'dress_length'   THEN NULLIF(btrim(COALESCE(p_data->>'dress_length', '')), '')::numeric ELSE dress_length END,
      fit_preference = CASE WHEN p_data ? 'fit_preference' THEN v_fit ELSE fit_preference END
    WHERE id = p_id;
    v_id := p_id;
  END IF;

  SELECT to_jsonb(m) INTO v FROM public.saved_measurements m WHERE m.id = v_id;
  RETURN v;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_measurement_name' USING DETAIL = 'A profile with this name already exists';
  WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_measurement' USING DETAIL = 'Measurement fields out of bounds';
END;
$$;
REVOKE ALL ON FUNCTION api.upsert_measurement(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.upsert_measurement(uuid, uuid, jsonb) TO service_role;

-- ── api.delete_measurement ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.delete_measurement(p_user uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  DELETE FROM public.saved_measurements WHERE id = p_id AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'measurement_not_found'; END IF;
  RETURN jsonb_build_object('deleted', true, 'id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION api.delete_measurement(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_measurement(uuid, uuid) TO service_role;

-- ── api.import_account_data ────────────────────────────────────────────────────
-- ONE-TIME localStorage → server salvage (P4 calls it on first authenticated
-- account load). Refuses if ANY server rows exist (already_imported) so it can
-- never clobber or double-import. Best-effort row-by-row: an invalid address/
-- measurement row is SKIPPED (counted), an invalid phone or out-of-range numeric
-- inside an otherwise-good row is coerced to NULL — salvage, don't reject the
-- user's data wholesale. Caps applied (first 10 / first 12 in payload order).
-- Writes the canonical account.imported audit row in the same transaction.
CREATE OR REPLACE FUNCTION api.import_account_data(p_user uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile jsonb; r jsonb;
  v_name text; v_phone text; v_birthday date; v_fit text;
  v_profile_ok boolean := false;
  v_addr_n integer := 0; v_addr_skipped integer := 0; v_seen_default boolean := false;
  v_meas_n integer := 0; v_meas_skipped integer := 0;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_profile' USING DETAIL = 'An import payload object is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_profiles  WHERE user_id = p_user)
  OR EXISTS (SELECT 1 FROM public.saved_addresses    WHERE user_id = p_user)
  OR EXISTS (SELECT 1 FROM public.saved_measurements WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'already_imported' USING DETAIL = 'Server account data already exists';
  END IF;

  -- profile (optional; skipped when the name is unusable)
  v_profile := p_payload->'profile';
  IF v_profile IS NOT NULL AND jsonb_typeof(v_profile) = 'object' THEN
    v_name := btrim(COALESCE(v_profile->>'full_name', ''));
    IF char_length(v_name) BETWEEN 1 AND 120 THEN
      v_phone := NULLIF(btrim(COALESCE(v_profile->>'phone', '')), '');
      IF v_phone IS NOT NULL AND v_phone !~ '^01[3-9][0-9]{8}$' THEN v_phone := NULL; END IF;
      BEGIN
        v_birthday := NULLIF(btrim(COALESCE(v_profile->>'birthday', '')), '')::date;
        IF v_birthday < DATE '1900-01-01' OR v_birthday > CURRENT_DATE THEN v_birthday := NULL; END IF;
      EXCEPTION WHEN OTHERS THEN v_birthday := NULL; END;
      INSERT INTO public.customer_profiles (user_id, full_name, phone, birthday)
      VALUES (p_user, v_name, v_phone, v_birthday);
      v_profile_ok := true;
    END IF;
  END IF;

  -- addresses (first 10; at most one default; bad row → skip)
  IF jsonb_typeof(p_payload->'addresses') = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'addresses')
             WITH ORDINALITY AS t(value, ord) ORDER BY t.ord LIMIT 10 LOOP
      BEGIN
        v_phone := NULLIF(btrim(COALESCE(r->>'phone', '')), '');
        IF v_phone IS NOT NULL AND v_phone !~ '^01[3-9][0-9]{8}$' THEN v_phone := NULL; END IF;
        INSERT INTO public.saved_addresses
          (user_id, label, recipient, phone, district, area, address, is_default)
        VALUES (
          p_user,
          NULLIF(btrim(COALESCE(r->>'label', '')), ''),
          btrim(COALESCE(r->>'recipient', '')),
          v_phone,
          btrim(COALESCE(r->>'district', '')),
          btrim(COALESCE(r->>'area', '')),
          btrim(COALESCE(r->>'address', '')),
          (NOT v_seen_default) AND COALESCE((r->>'is_default')::boolean, false));
        IF (NOT v_seen_default) AND COALESCE((r->>'is_default')::boolean, false) THEN
          v_seen_default := true;
        END IF;
        v_addr_n := v_addr_n + 1;
      EXCEPTION WHEN OTHERS THEN
        v_addr_skipped := v_addr_skipped + 1;
      END;
    END LOOP;
  END IF;
  PERFORM private.normalize_default_address(p_user);

  -- measurements (first 12; duplicate/invalid name → skip; bad numeric → NULL)
  IF jsonb_typeof(p_payload->'measurements') = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'measurements')
             WITH ORDINALITY AS t(value, ord) ORDER BY t.ord LIMIT 12 LOOP
      BEGIN
        v_name := btrim(COALESCE(r->>'name', ''));
        IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
          RAISE EXCEPTION 'skip';
        END IF;
        v_fit := btrim(COALESCE(r->>'fit_preference', ''));
        IF v_fit NOT IN ('Fitted','Regular','Relaxed') THEN v_fit := 'Regular'; END IF;
        INSERT INTO public.saved_measurements
          (user_id, name, bust, waist, hip, shoulder, sleeve, dress_length, fit_preference)
        VALUES (
          p_user, v_name,
          private.lenient_measure(r->>'bust'),
          private.lenient_measure(r->>'waist'),
          private.lenient_measure(r->>'hip'),
          private.lenient_measure(r->>'shoulder'),
          private.lenient_measure(r->>'sleeve'),
          private.lenient_measure(r->>'dress_length'),
          v_fit);
        v_meas_n := v_meas_n + 1;
      EXCEPTION WHEN OTHERS THEN
        v_meas_skipped := v_meas_skipped + 1;
      END;
    END LOOP;
  END IF;

  -- Canonical audit row — same transaction (plan §2: imports ARE audited).
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_user, 'account.imported', 'customer_profiles', p_user::text,
          jsonb_build_object(
            'profile', v_profile_ok,
            'addresses', v_addr_n, 'addresses_skipped', v_addr_skipped,
            'measurements', v_meas_n, 'measurements_skipped', v_meas_skipped));

  RETURN jsonb_build_object(
    'profile', v_profile_ok,
    'addresses', v_addr_n, 'addresses_skipped', v_addr_skipped,
    'measurements', v_meas_n, 'measurements_skipped', v_meas_skipped);
END;
$$;
REVOKE ALL ON FUNCTION api.import_account_data(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.import_account_data(uuid, jsonb) TO service_role;

-- Lenient numeric salvage for import ONLY (the strict path is upsert_measurement):
-- garbage / non-positive / out-of-range values become NULL after rounding to the
-- column scale (so 199.99 → 200.0 → NULL, never a CHECK violation).
CREATE OR REPLACE FUNCTION private.lenient_measure(p text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE v numeric;
BEGIN
  v := round(NULLIF(btrim(COALESCE(p, '')), '')::numeric, 1);
  IF v IS NULL OR v <= 0 OR v >= 200 THEN RETURN NULL; END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
