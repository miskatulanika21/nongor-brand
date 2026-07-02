-- Stage 4 P1 — customer account schema (structure + invariants only, NO behavior).
--
-- Foundation for server-backed customer accounts, replacing the localStorage-only
-- state in src/lib/account-ui.tsx. Same posture as the order/coupon schemas:
-- every table is RPC-only — RLS is enabled with NO policies (deny-all) and direct
-- grants are revoked from anon/authenticated, so the only access path is the
-- SECURITY DEFINER api.* RPCs added in P2 (get_my_account / save_profile /
-- address + measurement CRUD / import_account_data). Those RPCs receive the
-- VERIFIED session user id from the server fn — the client never picks the scope.
--
-- Design: docs/stage-4-customer-accounts-plan.md §3. Deliberate choices:
--   * email is NOT stored here — auth.users.email stays the single source
--     (P2's get_my_account joins it server-side; change-email stays an auth flow).
--   * at-most-one default address per user is a DB invariant (partial unique
--     index), not client bookkeeping — the client's normalizeDefaults becomes
--     a UI nicety, never the guarantee.
--   * measurement names are unique per user case-insensitively; the client's
--     "(Copy n)" naming helper works within that.
--   * per-user caps (10 addresses / 12 measurement profiles) are enforced in the
--     P2 RPCs (count under the write path), not by triggers — structure only here.
--   * phone columns store the normalized BD mobile form (app normalizes via
--     normalizeBDPhone; the DB re-asserts). NULLable: legacy local data may lack
--     a phone, and checkout re-validates before use.

-- ── customer_profiles (one row per user, lazily created on first write) ───────
CREATE TABLE IF NOT EXISTS public.customer_profiles (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text        NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 120),
  phone      text        CHECK (phone IS NULL OR phone ~ '^01[3-9][0-9]{8}$'),
  birthday   date        CHECK (birthday IS NULL OR
                                (birthday >= DATE '1900-01-01' AND birthday <= CURRENT_DATE)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.customer_profiles IS
  'Stage 4 customer profile (one row per auth user, lazily created). RPC-only (deny-all RLS). Email lives in auth.users, never here.';

DROP TRIGGER IF EXISTS trg_customer_profiles_updated_at ON public.customer_profiles;
CREATE TRIGGER trg_customer_profiles_updated_at
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── saved_addresses (cap 10/user, enforced in the P2 RPCs) ────────────────────
CREATE TABLE IF NOT EXISTS public.saved_addresses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label      text        CHECK (label IS NULL OR char_length(label) <= 40),
  recipient  text        NOT NULL CHECK (char_length(recipient) BETWEEN 1 AND 120),
  phone      text        CHECK (phone IS NULL OR phone ~ '^01[3-9][0-9]{8}$'),
  district   text        NOT NULL CHECK (char_length(district) BETWEEN 1 AND 80),
  area       text        NOT NULL CHECK (char_length(area) BETWEEN 1 AND 120),
  address    text        NOT NULL CHECK (char_length(address) BETWEEN 1 AND 500),
  is_default boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.saved_addresses IS
  'Stage 4 saved delivery addresses. RPC-only (deny-all RLS). At most one default per user is a DB invariant (partial unique index). Cap 10/user enforced in the P2 RPCs.';

-- The invariant: a user can have at most one default address.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_addresses_one_default
  ON public.saved_addresses (user_id) WHERE is_default;
-- Listing path (the partial index above only covers defaults).
CREATE INDEX IF NOT EXISTS idx_saved_addresses_user
  ON public.saved_addresses (user_id, created_at);

DROP TRIGGER IF EXISTS trg_saved_addresses_updated_at ON public.saved_addresses;
CREATE TRIGGER trg_saved_addresses_updated_at
  BEFORE UPDATE ON public.saved_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── saved_measurements (cap 12/user, enforced in the P2 RPCs) ─────────────────
-- Measurements are inches, matching the PDP custom-size bounds; each field is
-- optional but must be a sane positive value when present.
CREATE TABLE IF NOT EXISTS public.saved_measurements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  bust           numeric(5,1) CHECK (bust         IS NULL OR (bust         > 0 AND bust         < 200)),
  waist          numeric(5,1) CHECK (waist        IS NULL OR (waist        > 0 AND waist        < 200)),
  hip            numeric(5,1) CHECK (hip          IS NULL OR (hip          > 0 AND hip          < 200)),
  shoulder       numeric(5,1) CHECK (shoulder     IS NULL OR (shoulder     > 0 AND shoulder     < 200)),
  sleeve         numeric(5,1) CHECK (sleeve       IS NULL OR (sleeve       > 0 AND sleeve       < 200)),
  dress_length   numeric(5,1) CHECK (dress_length IS NULL OR (dress_length > 0 AND dress_length < 200)),
  fit_preference text        NOT NULL DEFAULT 'Regular'
                             CHECK (fit_preference IN ('Fitted','Regular','Relaxed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.saved_measurements IS
  'Stage 4 saved measurement profiles (inches). RPC-only (deny-all RLS). Names unique per user case-insensitively. Cap 12/user enforced in the P2 RPCs.';

-- Name dedupe (case-insensitive) — also serves the per-user listing path.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_measurements_user_name
  ON public.saved_measurements (user_id, lower(name));

DROP TRIGGER IF EXISTS trg_saved_measurements_updated_at ON public.saved_measurements;
CREATE TRIGGER trg_saved_measurements_updated_at
  BEFORE UPDATE ON public.saved_measurements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RPC-only posture: deny-all RLS + revoke direct grants ─────────────────────
-- RLS with no policies denies anon/authenticated; the REVOKE is defence in depth.
-- SECURITY DEFINER api.* RPCs (P2) run as owner and are unaffected; service_role
-- retains access.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_profiles','saved_addresses','saved_measurements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
