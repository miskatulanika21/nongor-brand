-- ══════════════════════════════════════════════════════════════════════════════
-- Hide Pathao's operational zones from the customer address picker
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Pathao's zone list is an operational routing table, not purely a list of
-- places. Alongside real thanas it contains internal buckets:
--
--   Bulk Merchant · Central Fulfillment · Document-Central · lost ·
--   On-Demand · On-demand transfer · On-Demand-Chattogram ·
--   Pathao Central FTL · Pathao Central Inbound · Pathao Central LTL
--
-- Found by driving the real checkout page after the Dhaka sync: they were
-- sitting in the Thana/Upazila dropdown among 372 options, where a customer
-- could have selected "lost" as their address.
--
-- They are hidden rather than deleted. The rows stay so their Pathao ids remain
-- resolvable (a parcel could legitimately be routed through one, and we may
-- need to interpret such a value coming back from Pathao), but they never
-- appear in the picker. `selectable` is the single switch the read path honours.
--
-- Matching is a conservative pattern over Pathao's own naming, applied only to
-- source='pathao' rows so the BBS hierarchy can never be affected.

ALTER TABLE public.bd_upazilas
  ADD COLUMN IF NOT EXISTS selectable boolean NOT NULL DEFAULT true;
ALTER TABLE public.bd_unions
  ADD COLUMN IF NOT EXISTS selectable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.bd_upazilas.selectable IS
  'False for Pathao operational zones (fulfillment hubs, on-demand buckets) that are not customer-selectable places.';
COMMENT ON COLUMN public.bd_unions.selectable IS
  'False for Pathao operational areas that are not customer-selectable places.';

UPDATE public.bd_upazilas
SET selectable = false
WHERE source = 'pathao'
  AND (
    name ~* '(pathao|central fulfillment|bulk merchant|on-demand|on demand|document-|inbound|outbound| ftl| ltl)'
    OR lower(btrim(name)) IN ('lost', 'test', 'central fulfillment')
  );

UPDATE public.bd_unions
SET selectable = false
WHERE source = 'pathao'
  AND (
    name ~* '(pathao|central fulfillment|bulk merchant|on-demand|on demand|document-|inbound|outbound| ftl| ltl)'
    OR lower(btrim(name)) IN ('lost', 'test', 'central fulfillment')
  );

-- Partial indexes: the picker only ever reads selectable rows.
CREATE INDEX IF NOT EXISTS idx_bd_upazilas_district_selectable
  ON public.bd_upazilas (district_id) WHERE selectable;
CREATE INDEX IF NOT EXISTS idx_bd_unions_upazila_selectable
  ON public.bd_unions (upazila_id) WHERE selectable;
