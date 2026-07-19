/**
 * Bangladesh location hierarchy — isomorphic types and labels.
 *
 * NO server-only imports — safe for the browser bundle.
 *
 * The hierarchy branches by settlement type, which is why level 3 and level 4
 * each carry two names:
 *
 *   rural : Division → District → Upazila → Union
 *   urban : Division → District → Thana   → Area    (city corporation)
 *
 * Both branches live in the same tables, distinguished by `source`:
 *   'bbs'    — the official union-parishad hierarchy (rural)
 *   'pathao' — metropolitan thanas/areas, synced from Pathao's zone/area lists,
 *              which is the only source that covers the city corporations
 *
 * A customer should never have to know which branch they are in, so the UI
 * labels both together ("Thana / Upazila", "Area / Union") and the two sets are
 * merged into one list per parent.
 */

export interface LocationOption {
  id: number;
  name: string;
  /** Bengali name, when the source provides one. */
  bnName: string | null;
}

export interface DistrictOption extends LocationOption {
  divisionId: number;
}

/** Level-3 option: a rural upazila or a metropolitan thana. */
export interface ThanaOption extends LocationOption {
  districtId: number;
  source: "bbs" | "pathao";
}

/** Level-4 option: a rural union or a metropolitan area. */
export interface AreaOption extends LocationOption {
  thanaId: number;
  source: "bbs" | "pathao";
}

// ── Labels ───────────────────────────────────────────────────────────────────
//
// Deliberately dual-named rather than picking one. "Upazila" is meaningless to
// a Dhanmondi customer and "Thana" is wrong for a rural one; showing both is
// the only phrasing that is correct for every customer in the country.

export const LOCATION_LABELS = {
  division: "Division",
  district: "District",
  thana: "Thana / Upazila",
  area: "Area / Union",
} as const;

export const LOCATION_PLACEHOLDERS = {
  division: "Select division",
  district: "Select district",
  thana: "Select thana / upazila",
  area: "Select area / union",
} as const;

/**
 * Display a location option, preferring the English name but showing the
 * Bengali one alongside when it differs meaningfully.
 */
export function locationLabel(o: Pick<LocationOption, "name" | "bnName">): string {
  return o.bnName && o.bnName.trim() && o.bnName !== o.name ? `${o.name} (${o.bnName})` : o.name;
}
