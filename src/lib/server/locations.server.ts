/**
 * Bangladesh location lookups — server-side repository.
 *
 * Reference data, never mutated at runtime: 8 divisions, 64 districts, and the
 * merged rural + metropolitan thana/area sets underneath them.
 *
 * Loaded LAZILY, one level at a time. The full tree is ~5k rural rows plus
 * ~22k Pathao areas; bundling that into the client would add hundreds of KB to
 * the storefront and undo the LCP work. Checkout only ever needs the children
 * of whatever the customer just picked.
 *
 * The .server.ts suffix keeps this off the client.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import type {
  AreaOption,
  DistrictOption,
  LocationOption,
  ThanaOption,
} from "@/lib/locations-shared";

/**
 * In-process cache. This data changes only when the Pathao sync runs, so a
 * per-instance memo avoids a database round trip on every checkout keystroke.
 * Deliberately unbounded-but-tiny: at most 64 district keys and ~600 thana
 * keys, each a short array.
 */
const cache = new Map<string, unknown>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const value = await load();
  cache.set(key, value);
  return value;
}

/** Sort by English name, but keep it stable and locale-independent. */
const byName = <T extends { name: string }>(rows: T[]) =>
  rows.sort((a, b) => a.name.localeCompare(b.name, "en"));

export async function listDivisions(): Promise<LocationOption[]> {
  return cached("divisions", async () => {
    const db = createAdminSupabaseClient();
    const { data, error } = await db.from("bd_divisions").select("id, name, bn_name");
    if (error) throw new Error(`listDivisions: ${error.message}`);
    return byName((data ?? []).map((r) => ({ id: r.id, name: r.name, bnName: r.bn_name })));
  });
}

export async function listDistricts(divisionId: number): Promise<DistrictOption[]> {
  return cached(`districts:${divisionId}`, async () => {
    const db = createAdminSupabaseClient();
    const { data, error } = await db
      .from("bd_districts")
      .select("id, division_id, name, bn_name")
      .eq("division_id", divisionId);
    if (error) throw new Error(`listDistricts: ${error.message}`);
    return byName(
      (data ?? []).map((r) => ({
        id: r.id,
        divisionId: r.division_id,
        name: r.name,
        bnName: r.bn_name,
      })),
    );
  });
}

/**
 * Level 3 for a district: rural upazilas AND metropolitan thanas, merged.
 *
 * A Dhaka customer needs Dhanmondi (a Pathao zone); a Savar customer needs
 * Savar (a BBS upazila). Both are children of district 47, and the customer
 * should not have to know which system their address belongs to — so one list.
 */
export async function listThanas(districtId: number): Promise<ThanaOption[]> {
  return cached(`thanas:${districtId}`, async () => {
    const db = createAdminSupabaseClient();
    const { data, error } = await db
      .from("bd_upazilas")
      .select("id, district_id, name, bn_name, source")
      .eq("district_id", districtId);
    if (error) throw new Error(`listThanas: ${error.message}`);
    return byName(
      (data ?? []).map((r) => ({
        id: r.id,
        districtId: r.district_id,
        name: r.name,
        bnName: r.bn_name,
        source: r.source as "bbs" | "pathao",
      })),
    );
  });
}

/**
 * Resolve a saved address back to cascade ids.
 *
 * A saved address stores only names (ship_district / area text), but the picker
 * drives off ids — so without this a returning customer would see empty
 * dropdowns sitting on top of populated state, and could submit a stale
 * address they never confirmed.
 *
 * Best-effort by design: an unresolvable name returns nulls and the customer
 * simply re-picks, which is safe. Matching is case-insensitive on the exact
 * name — deliberately NOT fuzzy, because silently resolving to the wrong
 * district would ship a parcel to the wrong place.
 */
export async function resolveLocation(
  districtName: string,
  thanaName?: string,
): Promise<{ divisionId: number | null; districtId: number | null; thanaId: number | null }> {
  const db = createAdminSupabaseClient();
  const { data: d } = await db
    .from("bd_districts")
    .select("id, division_id")
    .ilike("name", districtName.trim())
    .limit(1)
    .maybeSingle();

  if (!d) return { divisionId: null, districtId: null, thanaId: null };

  let thanaId: number | null = null;
  if (thanaName?.trim()) {
    const { data: t } = await db
      .from("bd_upazilas")
      .select("id")
      .eq("district_id", d.id)
      .ilike("name", thanaName.trim())
      .limit(1)
      .maybeSingle();
    thanaId = t?.id ?? null;
  }

  return { divisionId: d.division_id, districtId: d.id, thanaId };
}

/** Level 4 for a thana/upazila: rural unions or metropolitan areas. */
export async function listAreas(thanaId: number): Promise<AreaOption[]> {
  return cached(`areas:${thanaId}`, async () => {
    const db = createAdminSupabaseClient();
    const { data, error } = await db
      .from("bd_unions")
      .select("id, upazila_id, name, bn_name, source")
      .eq("upazila_id", thanaId);
    if (error) throw new Error(`listAreas: ${error.message}`);
    return byName(
      (data ?? []).map((r) => ({
        id: r.id,
        thanaId: r.upazila_id,
        name: r.name,
        bnName: r.bn_name,
        source: r.source as "bbs" | "pathao",
      })),
    );
  });
}
