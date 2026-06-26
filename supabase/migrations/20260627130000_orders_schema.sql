-- Stage 3 Pass 1 — Order schema, numbering & idempotency (NO behavior yet).
--
-- Foundation tables for server-authoritative checkout. Every table is RPC-only:
-- RLS is enabled with NO policies (deny-all) and direct grants are revoked from
-- anon/authenticated, so the only access path is the SECURITY DEFINER api.*
-- RPCs added in later passes (P3+). This pass creates structure + invariants
-- only — there are no functions and no rows are produced by the app yet.
--
-- Design: docs/stage-3-design.md (v2). Statuses use text + CHECK (codebase
-- convention). Money is integer BDT. order_status_history is append-only.

-- ── Order number sequence (formatted NGR-YYYY-###### in the P3 RPC) ──────────
CREATE SEQUENCE IF NOT EXISTS public.order_no_seq AS bigint START WITH 1;

-- ── orders ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no               text        NOT NULL UNIQUE CHECK (char_length(order_no) BETWEEN 1 AND 40),

  -- Exactly one owner: a signed-in customer OR a guest (tracked by token hash).
  user_id                uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_token_hash       text        CHECK (guest_token_hash IS NULL OR char_length(guest_token_hash) = 64),
  CONSTRAINT orders_one_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL)),

  -- Customer + shipping snapshot (immutable once placed).
  customer_name          text        NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 200),
  customer_phone         text        NOT NULL CHECK (char_length(customer_phone) BETWEEN 1 AND 40),
  customer_email         text        CHECK (customer_email IS NULL OR char_length(customer_email) <= 200),
  ship_district          text        NOT NULL CHECK (char_length(ship_district) BETWEEN 1 AND 100),
  ship_zone              text        NOT NULL CHECK (ship_zone IN ('dhaka','major','outside')),
  ship_address           text        NOT NULL CHECK (char_length(ship_address) BETWEEN 1 AND 500),
  ship_area              text        CHECK (ship_area IS NULL OR char_length(ship_area) <= 200),

  -- Pricing snapshot (integer BDT). The invariant is enforced at the DB.
  subtotal               integer     NOT NULL CHECK (subtotal >= 0),
  discount               integer     NOT NULL DEFAULT 0 CHECK (discount >= 0),
  shipping_fee           integer     NOT NULL CHECK (shipping_fee >= 0),
  total                  integer     NOT NULL CHECK (total >= 0),
  CONSTRAINT orders_pricing_balanced CHECK (subtotal - discount + shipping_fee = total),

  payment_method         text        NOT NULL CHECK (payment_method IN ('cod','bkash','nagad')),
  status                 text        NOT NULL CHECK (status IN (
                           'pending_payment','payment_submitted','payment_rejected',
                           'pending_confirmation','confirmed','processing','ready_to_ship',
                           'shipped','delivered','completed',
                           'cancelled','expired','returned','refund_pending','refund_done')),
  coupon_code            text        CHECK (coupon_code IS NULL OR char_length(coupon_code) <= 40),

  reservation_expires_at timestamptz,
  idempotency_key        text        NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  version                integer     NOT NULL DEFAULT 0,
  placed_at              timestamptz NOT NULL DEFAULT now(),
  confirmed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.orders IS
  'Stage 3 orders. RPC-only (deny-all RLS). Pricing snapshot is integer BDT with a balanced-total CHECK; either user_id or guest_token_hash identifies the buyer.';

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON public.orders (placed_at DESC);
-- Drives the reservation-expiry sweep (only pending orders can expire).
CREATE INDEX IF NOT EXISTS idx_orders_reservation_expiry ON public.orders (reservation_expires_at)
  WHERE status IN ('pending_payment','payment_submitted','pending_confirmation','payment_rejected');

-- ── order_items (snapshots; history immutable as the catalog changes) ─────────
CREATE TABLE IF NOT EXISTS public.order_items (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid    NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id   uuid    NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_size text    CHECK (variant_size IS NULL OR char_length(variant_size) <= 40),
  name         text    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  image        text    CHECK (image IS NULL OR char_length(image) <= 1000),
  unit_price   integer NOT NULL CHECK (unit_price >= 0),
  qty          integer NOT NULL CHECK (qty BETWEEN 1 AND 50),
  line_total   integer NOT NULL CHECK (line_total >= 0),
  CONSTRAINT order_items_line_total CHECK (line_total = unit_price * qty),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items (product_id);

-- ── order_status_history (append-only domain-event log) ──────────────────────
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status text,
  to_status   text        NOT NULL,
  actor_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reason      text        CHECK (reason IS NULL OR char_length(reason) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON public.order_status_history (order_id, created_at);

CREATE OR REPLACE FUNCTION private.prevent_order_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'order_status_history is append-only (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_history_immutable ON public.order_status_history;
CREATE TRIGGER trg_order_history_immutable
  BEFORE UPDATE OR DELETE ON public.order_status_history
  FOR EACH ROW EXECUTE FUNCTION private.prevent_order_history_mutation();

-- ── payments ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method        text        NOT NULL CHECK (method IN ('cod','bkash','nagad')),
  amount        integer     NOT NULL CHECK (amount >= 0),
  sender_number text        CHECK (sender_number IS NULL OR char_length(sender_number) <= 40),
  trx_id        text        CHECK (trx_id IS NULL OR char_length(trx_id) BETWEEN 1 AND 100),
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at   timestamptz,
  reject_reason text        CHECK (reject_reason IS NULL OR char_length(reject_reason) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
-- Fraud guard: the same wallet TrxID can never be VERIFIED onto two payments.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_verified_trx
  ON public.payments (method, lower(trx_id))
  WHERE status = 'verified' AND trx_id IS NOT NULL;

-- ── payment_screenshots (private Storage paths only) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_screenshots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid        NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  storage_path text        NOT NULL CHECK (char_length(storage_path) BETWEEN 1 AND 400),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_screenshots_payment ON public.payment_screenshots (payment_id);

-- ── idempotency_keys (serialization point for duplicate submissions) ─────────
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key          text        PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 200),
  scope        text        NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 200),
  request_hash text        NOT NULL CHECK (char_length(request_hash) BETWEEN 1 AND 128),
  order_id     uuid        REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── RPC-only posture: deny-all RLS + revoke direct grants ────────────────────
-- RLS with no policies denies anon/authenticated; the REVOKE is defence in depth
-- for these PII/payment tables. SECURITY DEFINER api.* RPCs (P3+) run as the
-- owner and are unaffected; service_role retains access.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders','order_items','order_status_history','payments',
    'payment_screenshots','idempotency_keys'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
