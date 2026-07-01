-- Stage 3 Pass 5a — Coupon schema (structure + invariants only, NO behavior).
--
-- Foundation for real, race-safe coupons that replace the display-only
-- MOCK_COUPONS in checkout-ui.ts. Same posture as the Pass-1 order schema:
-- every table is RPC-only — RLS is enabled with NO policies (deny-all) and
-- direct grants are revoked from anon/authenticated, so the only access path is
-- the SECURITY DEFINER api.* RPCs added in P5b (pricing) and P5d (admin CRUD).
-- This pass creates structure only; no pricing RPC references these tables yet.
--
-- Design: docs/stage-3-design.md (v2) §3 + §4.5. Money is integer BDT; codes are
-- stored canonical (UPPERCASE). Two deliberate, documented upgrades over the
-- baseline design, for the premium admin/customer flexibility this stage targets:
--
--   1. type gains 'free_shipping' (waive the shipping fee) alongside
--      'percent'/'fixed' — a first-class discount shape rather than a bolt-on.
--   2. per_user_limit MAY exceed 1. The baseline design leaned on a UNIQUE
--      (coupon_code, scope) index to cap redemptions at one-per-scope. That
--      cannot express "3 uses per customer", so instead BOTH the per-user count
--      and the global usage_limit are enforced by counting under the coupon row
--      lock (SELECT ... FOR UPDATE) that place_order already takes in §4.5 — all
--      redemptions of a given coupon serialize on that row, so the counts are
--      race-safe without a blocking unique index. A maintained usage_count column
--      makes the global-limit check O(1); a (coupon_code, scope) index makes the
--      per-user count fast. (P5b wires this; the row lock is the correctness point.)
--
-- Deferred by design (Stage 6 "full coupon admin"): product/category eligibility
-- scoping. Not stubbed here — an unenforced column would be a phantom feature.

-- ── coupons ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupons (
  code             text        PRIMARY KEY
                     CHECK (char_length(code) BETWEEN 3 AND 40)
                     -- Canonical form: UPPERCASE, alphanumeric + dash/underscore.
                     -- Stored normalized so lookups never need lower()/upper().
                     CHECK (code = upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_-]*$'),

  description      text        CHECK (description IS NULL OR char_length(description) <= 200),

  -- Discount shape. 'percent' → value is 1..100; 'fixed' → value is BDT off the
  -- subtotal; 'free_shipping' → value unused (0), waives the shipping fee.
  type             text        NOT NULL CHECK (type IN ('percent','fixed','free_shipping')),
  value            integer     NOT NULL DEFAULT 0 CHECK (value >= 0),
  CONSTRAINT coupons_value_by_type CHECK (
    (type = 'percent'       AND value BETWEEN 1 AND 100) OR
    (type = 'fixed'         AND value >= 1)              OR
    (type = 'free_shipping' AND value = 0)
  ),

  -- Eligibility + caps. NULL cap columns mean "no cap".
  min_subtotal     integer     NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_discount     integer     CHECK (max_discount IS NULL OR max_discount >= 1),
  usage_limit      integer     CHECK (usage_limit IS NULL OR usage_limit >= 1),
  per_user_limit   integer     CHECK (per_user_limit IS NULL OR per_user_limit >= 1),
  first_order_only boolean     NOT NULL DEFAULT false,

  -- Maintained global redemption counter (incremented under the coupon row lock
  -- in place_order); lets the usage_limit check stay O(1) instead of COUNT(*).
  usage_count      integer     NOT NULL DEFAULT 0 CHECK (usage_count >= 0),

  -- Validity window (either bound may be open).
  starts_at        timestamptz,
  ends_at          timestamptz,
  CONSTRAINT coupons_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),

  active           boolean     NOT NULL DEFAULT true,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.coupons IS
  'Stage 3 real coupons (replaces MOCK_COUPONS). RPC-only (deny-all RLS). Codes stored canonical UPPERCASE; percent/fixed/free_shipping; caps enforced under the coupon row lock in place_order. usage_count is a maintained global counter.';

-- Fast lookup of currently-live coupons for the (future) admin list.
CREATE INDEX IF NOT EXISTS idx_coupons_active ON public.coupons (active) WHERE active;

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON public.coupons;
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── coupon_usages (one row per successful redemption) ────────────────────────
-- Append-oriented ledger. `scope` is the redeemer identity: a user_id (uuid) for
-- signed-in customers or the guest_token_hash (64-hex) for guests — the same
-- identity model orders uses. Per-user limits count rows here for (coupon_code,
-- scope) under the coupon row lock; the global limit uses coupons.usage_count.
CREATE TABLE IF NOT EXISTS public.coupon_usages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code text        NOT NULL REFERENCES public.coupons(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  order_id    uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  scope       text        NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 200),
  amount      integer     NOT NULL CHECK (amount >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- One redemption row per order (a coupon is applied at most once to an order).
  CONSTRAINT coupon_usages_one_per_order UNIQUE (order_id)
);
COMMENT ON TABLE public.coupon_usages IS
  'One row per coupon redemption. scope = user_id or guest_token_hash. Per-user limit = COUNT(*) for (coupon_code, scope) under the coupon row lock; ON DELETE RESTRICT preserves history so a used coupon cannot be hard-deleted (admin deactivates instead).';

-- Drives the per-user redemption count (cheap COUNT under the coupon row lock).
CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon_scope
  ON public.coupon_usages (coupon_code, scope);

-- ── RPC-only posture: deny-all RLS + revoke direct grants ────────────────────
-- RLS with no policies denies anon/authenticated; the REVOKE is defence in depth.
-- SECURITY DEFINER api.* RPCs (P5b/P5d) run as owner and are unaffected;
-- service_role retains access.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coupons','coupon_usages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
