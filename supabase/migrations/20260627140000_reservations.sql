-- Stage 3 Pass 2 — inventory reservations, availability & TTL expiry.
--
-- Reservations are a SOFT HOLD: placing an order reserves units so the same
-- stock can't be sold twice, but real products.stock only moves at confirmation
-- (P4, via api.set_inventory). available = base_stock − Σ(active, unexpired
-- reservations). A pending order whose reservation TTL elapses is auto-released
-- by api.expire_reservations() (scheduled via pg_cron). Correctness does NOT
-- depend on the scheduler: availability counts only unexpired holds, so an
-- expired-but-unswept reservation never blocks a sale (the "lazy backstop").
--
-- Design: docs/stage-3-design.md (v2) §5, §6. No app behavior yet; place_order
-- (P3) is the first caller of available_qty + the reservation insert.

-- ── inventory_reservations (RPC-only: deny-all RLS + revoked grants) ─────────
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_size text        CHECK (variant_size IS NULL OR char_length(variant_size) <= 40),
  qty          integer     NOT NULL CHECK (qty >= 1),
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed')),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_reservations IS
  'Soft stock holds for pending orders. available = base_stock − Σ active-unexpired qty. Released on expiry/cancel; consumed at confirmation (then stock decrements via api.set_inventory).';

-- Availability sum (active, unexpired) per product/size.
CREATE INDEX IF NOT EXISTS idx_reservations_available
  ON public.inventory_reservations (product_id, variant_size)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_reservations_order ON public.inventory_reservations (order_id);
-- Expiry sweep.
CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON public.inventory_reservations (expires_at)
  WHERE status = 'active';

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_reservations FROM anon, authenticated;

-- ── Availability (lazy backstop ignores expired holds) ───────────────────────
-- base_stock: products.stock for non-sized (p_size NULL), else the per-size row.
CREATE OR REPLACE FUNCTION private.available_qty(p_product_id uuid, p_size text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE base integer; reserved integer;
BEGIN
  IF p_size IS NULL THEN
    SELECT stock INTO base FROM public.products WHERE id = p_product_id;
  ELSE
    SELECT quantity INTO base FROM public.product_size_stock
      WHERE product_id = p_product_id AND size = p_size;
  END IF;
  base := COALESCE(base, 0);

  SELECT COALESCE(SUM(qty), 0) INTO reserved
  FROM public.inventory_reservations
  WHERE product_id = p_product_id
    AND variant_size IS NOT DISTINCT FROM p_size
    AND status = 'active'
    AND expires_at > now();

  RETURN base - reserved;
END;
$$;

-- ── TTL expiry sweep ─────────────────────────────────────────────────────────
-- Releases active reservations of still-pending orders past their TTL, flips the
-- order to 'expired', and records system status history. FOR UPDATE SKIP LOCKED
-- so a concurrent payment transition on an order is left alone (handled by that
-- transition, or by the next sweep). Only the initial pending states expire — an
-- order with submitted evidence (awaiting admin) is never auto-cancelled.
CREATE OR REPLACE FUNCTION api.expire_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE rec record; cnt integer := 0;
BEGIN
  FOR rec IN
    SELECT id, status
    FROM public.orders
    WHERE status IN ('pending_payment','pending_confirmation')
      AND reservation_expires_at IS NOT NULL
      AND reservation_expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.orders
      SET status = 'expired', version = version + 1, updated_at = now()
      WHERE id = rec.id;
    UPDATE public.inventory_reservations
      SET status = 'released'
      WHERE order_id = rec.id AND status = 'active';
    INSERT INTO public.order_status_history (order_id, from_status, to_status, reason)
      VALUES (rec.id, rec.status, 'expired', 'reservation_expired');
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

REVOKE ALL ON FUNCTION api.expire_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.expire_reservations() TO service_role;

-- ── Schedule the sweep (best-effort) ─────────────────────────────────────────
-- pg_cron requires shared_preload_libraries; it is preloaded on hosted Supabase
-- but may be absent from a bare local stack. Guarded so a missing extension
-- never fails migrate-from-empty in CI — the lazy backstop keeps correctness
-- regardless; on prod the schedule is created (verified post-apply).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'expire-reservations', '*/5 * * * *',
    'SELECT api.expire_reservations();'
  );
  RAISE NOTICE 'pg_cron: scheduled expire-reservations every 5 minutes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (%) — relying on the lazy availability backstop; schedule expire-reservations manually in prod.', SQLERRM;
END $$;
