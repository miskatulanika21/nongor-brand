/**
 * Sync Pathao's City → Zone → Area tree into the bd_* location tables.
 *
 * WHY THIS EXISTS
 * ---------------
 * nuhil/bangladesh-geocode maps the union-parishad (RURAL) hierarchy only.
 * Dhaka district has just five upazilas there — Savar, Dhamrai, Keraniganj,
 * Nawabganj, Dohar — and Dhaka City Corporation (Dhanmondi, Gulshan, Mirpur,
 * Uttara) is entirely absent, because metropolitan thanas are not union
 * parishads. Checkout built on that data alone would have no valid option for a
 * city customer.
 *
 * Pathao covers the cities properly, and its ids are what a Pathao booking
 * actually needs, so the same rows fix checkout AND remove our dependence on
 * their address parser.
 *
 * Endpoints (transcribed from the merchant panel's Developer API page,
 * 2026-07-19 — do not guess these):
 *   GET /aladdin/api/v1/city-list
 *   GET /aladdin/api/v1/cities/{city_id}/zone-list
 *   GET /aladdin/api/v1/zones/{zone_id}/area-list
 *
 * SANDBOX vs PRODUCTION
 * ---------------------
 * Pathao ids are issued PER ENVIRONMENT — production store 410847 does not
 * exist in sandbox, and the same is true of city/zone/area ids. Writing sandbox
 * ids into the database would point production bookings at rows that do not
 * exist there: precisely the trap that separate PATHAO_SANDBOX_STORE_ID exists
 * to prevent.
 *
 * So sandbox runs are ALWAYS read-only. --write is refused unless the run is
 * against production credentials. Test in sandbox, then sync production.
 *
 * Usage:
 *   node scripts/sync-pathao-locations.mjs --env sandbox            # dry run
 *   node scripts/sync-pathao-locations.mjs --env production         # dry run
 *   node scripts/sync-pathao-locations.mjs --env production --write # persist
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : argv[i + 1];
};
const ENV = arg("--env", "sandbox");
const WRITE = argv.includes("--write");
const ENV_FILE = arg("--env-file", ".env");
const LIMIT_CITIES = Number(arg("--limit-cities", "0")) || 0;
// Comma-separated city names to sync, e.g. --only-cities "B. Baria,Jhenidah".
// Pathao rate-limits hard enough that a full sync takes about an hour, so a
// follow-up pass (after adding a district alias, say) should not have to redo
// the 56 cities that already succeeded. Matching is on the same normalised
// form used for district lookup, so romanisation differences do not matter.
const ONLY_CITIES = (arg("--only-cities", "") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!["sandbox", "production"].includes(ENV)) {
  throw new Error(`--env must be sandbox|production, got "${ENV}"`);
}
if (WRITE && ENV !== "production") {
  // The whole point of the guard: sandbox ids are meaningless in production.
  throw new Error(
    "Refusing --write against sandbox: Pathao ids are per-environment, and " +
      "sandbox ids would point production bookings at rows that do not exist. " +
      "Run sandbox read-only to validate, then re-run with --env production --write.",
  );
}

// ── env ──────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const sandbox = ENV === "sandbox";
const cfg = {
  baseUrl: (
    sandbox
      ? env.PATHAO_SANDBOX_BASE_URL || "https://courier-api-sandbox.pathao.com"
      : env.PATHAO_BASE_URL || "https://api-hermes.pathao.com"
  ).replace(/\/+$/, ""),
  clientId: sandbox ? env.PATHAO_SANDBOX_CLIENT_ID : env.PATHAO_CLIENT_ID,
  clientSecret: sandbox ? env.PATHAO_SANDBOX_CLIENT_SECRET : env.PATHAO_CLIENT_SECRET,
  username: sandbox ? env.PATHAO_SANDBOX_USERNAME : env.PATHAO_USERNAME,
  password: sandbox ? env.PATHAO_SANDBOX_PASSWORD : env.PATHAO_PASSWORD,
};
for (const [k, v] of Object.entries(cfg)) {
  if (!v) throw new Error(`missing Pathao config for ${ENV}: ${k}`);
}

// ── Pathao client ────────────────────────────────────────────────────────────
let token = null;
async function auth() {
  if (token) return token;
  // Password grant only — the docs are explicit: "Must use grant type password
  // for issue token api." There is no client_credentials grant.
  const r = await fetch(`${cfg.baseUrl}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "password",
      username: cfg.username,
      password: cfg.password,
    }),
  });
  if (!r.ok) throw new Error(`issue-token failed: HTTP ${r.status} — ${await r.text()}`);
  const j = await r.json();
  token = j.access_token || j.token;
  if (!token) throw new Error("issue-token response had no access_token");
  return token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pathao rate-limits these endpoints, and a full sync is ~700 requests (1
// city-list + 66 zone-lists + one area-list per zone). The sandbox run hit
// HTTP 429 within the first two cities, so pace every call and back off on 429
// rather than hammering and failing halfway through a production sync.
const THROTTLE_MS = Number(arg("--throttle", "350"));
const MAX_RETRIES = 5;

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const t = await auth();
    const r = await fetch(`${cfg.baseUrl}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${t}` },
    });
    const text = await r.text();

    if (r.status === 429) {
      if (attempt >= MAX_RETRIES) throw new Error(`${path}: still 429 after ${MAX_RETRIES} retries`);
      // Honour Retry-After when present; otherwise exponential backoff.
      const ra = Number(r.headers.get("retry-after"));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** attempt;
      console.log(`    rate-limited, waiting ${Math.round(waitMs / 1000)}s…`);
      await sleep(waitMs);
      continue;
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${path}: non-JSON reply (HTTP ${r.status}) — ${text.slice(0, 200)}`);
    }
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status} — ${text.slice(0, 200)}`);

    await sleep(THROTTLE_MS);
    // Pathao wraps list payloads as { data: { data: [...] } } on these endpoints.
    return body?.data?.data ?? body?.data ?? body;
  }
}

// ── district matching ────────────────────────────────────────────────────────
// Pathao city names and BBS district names disagree on romanisation:
// Comilla/Cumilla, Chattogram/Chattagram, Jashore/Jessore, Bogura/Bogra.
// Normalise aggressively, then fall back to an explicit alias table. Anything
// still unmatched is REPORTED, never guessed — an incorrectly mapped district
// silently routes parcels to the wrong city.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

// Variant → the BBS spelling used in bd_districts. STRICTLY one direction:
// an earlier draft had both barisal→barishal and barishal→barisal, a cycle in
// which the two spellings could never resolve to each other.
//
// The eight at the bottom are the exact misses from the first production run
// (56/64 matched). Each was verified against the district list by eye before
// being added — a wrong alias silently routes parcels to the wrong city, which
// is worse than leaving a district unmapped and falling back to auto-address.
const ALIASES = {
  cumilla: "comilla",
  chattagram: "chattogram",
  chittagong: "chattogram",
  jessore: "jashore",
  bogra: "bogura",
  barishal: "barisal",
  maulvibazar: "moulvibazar",
  // from the 2026-07-19 production run
  bbaria: "brahmanbaria",
  gopalgonj: "gopalganj",
  jhalokathi: "jhalakathi",
  jhenidah: "jhenaidah",
  khagrachari: "khagrachhari",
  munsiganj: "munshiganj",
  narshingdi: "narsingdi",
  netrakona: "netrokona",
};
const canon = (s) => {
  const n = norm(s);
  return ALIASES[n] ?? n;
};

// ── main ─────────────────────────────────────────────────────────────────────
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("missing SUPABASE url / service role key");
const db = createClient(url, key, { auth: { persistSession: false } });

// Pathao rows must not collide with the BBS integer ids (upazilas 1..494,
// unions 1..4540). Offsets are large and fixed so a re-sync is stable.
const ZONE_OFFSET = 1_000_000;
const AREA_OFFSET = 10_000_000;

console.log(`\n=== Pathao location sync — env=${ENV} write=${WRITE} ===`);
console.log(`base: ${cfg.baseUrl}\n`);

const { data: districts, error: dErr } = await db.from("bd_districts").select("id, name");
if (dErr) throw new Error(`could not read bd_districts: ${dErr.message}`);
const byName = new Map(districts.map((d) => [canon(d.name), d]));

let cities = await get("/aladdin/api/v1/city-list");
if (!Array.isArray(cities)) throw new Error("city-list did not return an array");
console.log(`cities: ${cities.length}`);
if (ONLY_CITIES.length) {
  const want = new Set(ONLY_CITIES.map(canon));
  cities = cities.filter((c) => want.has(canon(c.city_name)));
  console.log(`--only-cities: ${cities.length} of ${ONLY_CITIES.length} requested matched`);
  if (cities.length !== ONLY_CITIES.length) {
    const got = new Set(cities.map((c) => canon(c.city_name)));
    for (const n of ONLY_CITIES) if (!got.has(canon(n))) console.log(`  no such city: ${n}`);
  }
}
if (LIMIT_CITIES) cities = cities.slice(0, LIMIT_CITIES);

const matched = [];
const unmatched = [];
for (const c of cities) {
  const d = byName.get(canon(c.city_name));
  (d ? matched : unmatched).push({ city: c, district: d });
}
console.log(`matched to a district: ${matched.length}`);
if (unmatched.length) {
  console.log(`UNMATCHED (${unmatched.length}) — not written, needs an alias:`);
  for (const u of unmatched) console.log(`  - ${u.city.city_name} (city_id ${u.city.city_id})`);
}

const zoneRows = [];
const areaRows = [];
const cityUpdates = [];

for (const { city, district } of matched) {
  cityUpdates.push({ id: district.id, pathao_city_id: city.city_id });
  const zones = await get(`/aladdin/api/v1/cities/${city.city_id}/zone-list`);
  if (!Array.isArray(zones)) continue;
  for (const z of zones) {
    zoneRows.push({
      id: ZONE_OFFSET + z.zone_id,
      district_id: district.id,
      name: z.zone_name,
      source: "pathao",
      pathao_zone_id: z.zone_id,
    });
    const areas = await get(`/aladdin/api/v1/zones/${z.zone_id}/area-list`);
    if (!Array.isArray(areas)) continue;
    for (const a of areas) {
      areaRows.push({
        id: AREA_OFFSET + a.area_id,
        upazila_id: ZONE_OFFSET + z.zone_id,
        name: a.area_name,
        source: "pathao",
        pathao_area_id: a.area_id,
      });
    }
  }
  console.log(`  ${city.city_name}: ${zones.length} zones`);
}

console.log(`\ntotals: ${cityUpdates.length} cities, ${zoneRows.length} zones, ${areaRows.length} areas`);

if (!WRITE) {
  console.log("\nDRY RUN — nothing written. Sample:");
  console.log(zoneRows.slice(0, 3));
  console.log(areaRows.slice(0, 3));
  console.log("\nRe-run with --env production --write to persist.");
  process.exit(0);
}

async function upsert(table, rows, onConflict = "id") {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table} @${i}: ${error.message}`);
  }
  console.log(`${table}: ${rows.length} rows`);
}

// Zones before areas — areas FK to zones.
await upsert("bd_upazilas", zoneRows);
await upsert("bd_unions", areaRows);
for (const u of cityUpdates) {
  const { error } = await db
    .from("bd_districts")
    .update({ pathao_city_id: u.pathao_city_id })
    .eq("id", u.id);
  if (error) throw new Error(`bd_districts ${u.id}: ${error.message}`);
}
console.log(`bd_districts: ${cityUpdates.length} pathao_city_id set`);
console.log("\nsync complete");
