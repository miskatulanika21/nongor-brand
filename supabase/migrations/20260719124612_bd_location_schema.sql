-- ══════════════════════════════════════════════════════════════════════════════
-- Bangladesh location reference data — schema
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Checkout currently collects: district (64, hardcoded in checkout-ui.ts) plus a
-- free-text area, and `ship_zone` — which is NOT geography at all but a shipping
-- FEE TIER (dhaka / major / outside). That conflation is why the address step
-- reads wrong. This adds the real administrative hierarchy underneath it.
--
-- THE SPLIT THAT DRIVES THIS DESIGN
-- ---------------------------------
-- Bangladesh addresses branch by settlement type:
--
--   rural : Division → District → Upazila → Union
--   urban : Division → District → Thana   → Area     (city corporation)
--
-- The open dataset (nuhil/bangladesh-geocode, verified 2026-07-19: 8 / 64 / 494
-- / 4540 rows, Bengali names included) maps the *union parishad* system — the
-- RURAL branch only. Verified concretely: Dhaka district contains just five
-- upazilas there (Savar, Dhamrai, Keraniganj, Nawabganj, Dohar). Dhaka City
-- Corporation — Dhanmondi, Gulshan, Mirpur, Uttara — is entirely absent,
-- because metropolitan thanas are not union parishads.
--
-- Seeding only this data would therefore leave a Dhanmondi customer with no
-- valid option, i.e. worse than today for the majority of a Dhaka boutique's
-- orders.
--
-- The urban branch comes from Pathao instead (City → Zone → Area), verified in
-- their merchant panel: searching "Dhanmondi" returns both "Dhaka › Dhanmondi"
-- (metro zone) and "Cumilla › Cumilla Sadar › Dhanmondi" (rural area). Pathao
-- covers the cities comprehensively — and those are the exact ids a Pathao
-- booking needs, so the same rows that fix checkout also remove our dependence
-- on their address parser.
--
-- Hence ONE tree with a `source` discriminator, not two parallel schemas.
--
-- These tables are public reference data: readable by anon (checkout is
-- pre-auth) and writable by no one but service_role.

-- ── Divisions (8) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bd_divisions (
  id       integer PRIMARY KEY,
  name     text NOT NULL,
  bn_name  text
);

-- ── Districts (64) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bd_districts (
  id            integer PRIMARY KEY,
  division_id   integer NOT NULL REFERENCES public.bd_divisions(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  bn_name       text,
  -- Pathao's city id for this district, when mapped. NULL means "not mapped yet"
  -- and the booking falls back to auto-address — never a hard failure.
  pathao_city_id integer
);
CREATE INDEX IF NOT EXISTS idx_bd_districts_division ON public.bd_districts(division_id);

-- ── Level 3: upazila (rural) or thana (urban) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bd_upazilas (
  id            integer PRIMARY KEY,
  district_id   integer NOT NULL REFERENCES public.bd_districts(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  bn_name       text,
  -- 'bbs'    → from the official rural hierarchy (an upazila)
  -- 'pathao' → a metropolitan thana, sourced from Pathao's zone list
  source        text NOT NULL DEFAULT 'bbs' CHECK (source IN ('bbs', 'pathao')),
  pathao_zone_id integer
);
CREATE INDEX IF NOT EXISTS idx_bd_upazilas_district ON public.bd_upazilas(district_id);

-- ── Level 4: union (rural) or area (urban) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bd_unions (
  id            integer PRIMARY KEY,
  upazila_id    integer NOT NULL REFERENCES public.bd_upazilas(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  bn_name       text,
  source        text NOT NULL DEFAULT 'bbs' CHECK (source IN ('bbs', 'pathao')),
  pathao_area_id integer
);
CREATE INDEX IF NOT EXISTS idx_bd_unions_upazila ON public.bd_unions(upazila_id);

-- Pathao rows are seeded later by a sync job and must not collide with the BBS
-- integer ids, which occupy 1..4540. The sync allocates from a high offset.
COMMENT ON COLUMN public.bd_upazilas.source IS
  'bbs = official rural upazila; pathao = metropolitan thana from Pathao zone list';
COMMENT ON COLUMN public.bd_unions.source IS
  'bbs = official rural union; pathao = metropolitan area from Pathao area list';

-- ── RLS: public read, no client writes ───────────────────────────────────────
ALTER TABLE public.bd_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bd_districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bd_upazilas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bd_unions    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bd_divisions_read ON public.bd_divisions;
CREATE POLICY bd_divisions_read ON public.bd_divisions FOR SELECT USING (true);
DROP POLICY IF EXISTS bd_districts_read ON public.bd_districts;
CREATE POLICY bd_districts_read ON public.bd_districts FOR SELECT USING (true);
DROP POLICY IF EXISTS bd_upazilas_read ON public.bd_upazilas;
CREATE POLICY bd_upazilas_read ON public.bd_upazilas FOR SELECT USING (true);
DROP POLICY IF EXISTS bd_unions_read ON public.bd_unions;
CREATE POLICY bd_unions_read ON public.bd_unions FOR SELECT USING (true);

GRANT SELECT ON public.bd_divisions, public.bd_districts,
                public.bd_upazilas,  public.bd_unions TO anon, authenticated;
