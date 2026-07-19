-- ══════════════════════════════════════════════════════════════════════════════
-- Fix courier_providers.steadfast.default_service_type — 'normal' is invented
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The Stage 5 seed set steadfast.default_service_type = 'normal'. No such value
-- exists in SteadFast's API. Their /create_order takes:
--
--   delivery_type  numeric  optional  0 = home delivery,
--                                     1 = Point Delivery / Steadfast Hub Pick Up
--
-- (verified 2026-07-19 against the merchant portal's own API documentation).
--
-- 'normal' is from the same batch of invented values as the invented delivery
-- statuses corrected on 2026-07-17 — it was harmless only because nothing ever
-- read the column. The very next commit wires default_service_type into the
-- booking payload, at which point 'normal' would be POSTed into a numeric field
-- and every SteadFast booking would fail (or silently mis-route). Correct the
-- data BEFORE the code starts trusting it.
--
-- 0 (home delivery) is the right default for a D2C storefront: customers expect
-- the parcel at their address, not a hub pickup.
--
-- Pathao's '48' is left alone — it IS their documented delivery_type (48-hour
-- standard; 12 is on-demand), confirmed in the same verification pass.

UPDATE public.courier_providers
SET default_service_type = '0'
WHERE id = 'steadfast'
  AND (default_service_type IS NULL OR default_service_type = 'normal');
