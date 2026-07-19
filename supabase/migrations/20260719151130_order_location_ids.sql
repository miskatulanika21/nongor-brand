-- ══════════════════════════════════════════════════════════════════════════════
-- Persist the thana and the resolved location ids on orders
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Checkout now asks for Division → District → Thana/Upazila → Area/Union, but
-- `orders` only had ship_district / ship_zone / ship_area — no level-3 column.
-- So the thana was DISCARDED at submission: an order placed for
-- "Dhaka › Dhanmondi › Dhanmondi 27" stored only "Dhanmondi 27".
--
-- That defeats the point of syncing Pathao's tree. A Pathao booking needs
-- recipient_city and recipient_zone ids, and the zone is exactly what was being
-- thrown away — so bookings still fell back to Pathao parsing the free-text
-- address, which is what this work set out to stop.
--
-- WHY A SEPARATE RPC RATHER THAN EDITING place_order
-- --------------------------------------------------
-- api.place_order is ~8.7KB of pricing, stock-reservation, coupon and
-- idempotency logic. Rewriting it wholesale to thread four more fields through
-- risks a transcription error in the most safety-critical function in the
-- application, for a feature whose absence degrades gracefully. Instead the
-- fields are written immediately after placement by set_order_location.
--
-- The write is deliberately best-effort at the call site: if it fails, the
-- order still exists and courier booking simply falls back to auto-address —
-- precisely today's behaviour. Nothing regresses.
--
-- Ids are stored WITHOUT foreign keys to bd_*. Those tables are refreshed from
-- Pathao and rows can legitimately disappear between environments or syncs; an
-- FK would let a location refresh block order history. The ids are a resolution
-- hint, not a referential guarantee.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ship_thana        text
    CHECK (ship_thana IS NULL OR char_length(ship_thana) <= 200),
  ADD COLUMN IF NOT EXISTS ship_district_id  integer,
  ADD COLUMN IF NOT EXISTS ship_thana_id     integer,
  ADD COLUMN IF NOT EXISTS ship_area_id      integer;

COMMENT ON COLUMN public.orders.ship_thana IS
  'Thana (metropolitan) or upazila (rural) chosen at checkout — level 3 of the address hierarchy.';
COMMENT ON COLUMN public.orders.ship_thana_id IS
  'bd_upazilas.id for the chosen thana. Resolves to pathao_zone_id for courier booking; NULL falls back to auto-address.';

-- ── RPC: attach resolved location to an order ────────────────────────────────
CREATE OR REPLACE FUNCTION api.set_order_location(
  p_order_id     uuid,
  p_thana        text    DEFAULT NULL,
  p_district_id  integer DEFAULT NULL,
  p_thana_id     integer DEFAULT NULL,
  p_area_id      integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- Only ever set this on a freshly placed order. Allowing it later would let a
  -- caller silently rewrite the delivery target of an order already handed to a
  -- courier.
  IF v_status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;

  UPDATE public.orders
  SET ship_thana       = NULLIF(btrim(COALESCE(p_thana, '')), ''),
      ship_district_id = p_district_id,
      ship_thana_id    = p_thana_id,
      ship_area_id     = p_area_id,
      updated_at       = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION api.set_order_location(uuid, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_order_location(uuid, text, integer, integer, integer)
  TO service_role;
