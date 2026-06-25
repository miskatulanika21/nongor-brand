/**
 * Catalog facets — isomorphic types + pure normalisation for the storefront
 * filter sidebar (category counts, colours, fabrics, occasions).
 *
 * The shape mirrors the jsonb returned by `api.catalog_facets()` (Stage 2 Pass
 * 3c). `normalizeFacets` defensively coerces an untrusted jsonb payload into the
 * typed shape so a malformed/empty response can never crash the shop loader — it
 * degrades to an empty facet set instead.
 *
 * No server imports: safe to use in route components and unit tests.
 */

/** A single facet value with how many visible products carry it. */
export type FacetValue = { value: string; count: number };

/** A category facet (one row per *physical* DB category, not the UI rollup). */
export type CategoryFacet = { slug: string; name: string; count: number };

export type CatalogFacets = {
  categories: CategoryFacet[];
  colors: FacetValue[];
  fabrics: FacetValue[];
  occasions: FacetValue[];
};

export const EMPTY_FACETS: CatalogFacets = {
  categories: [],
  colors: [],
  fabrics: [],
  occasions: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toCount(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function normalizeFacetValues(raw: unknown): FacetValue[] {
  if (!Array.isArray(raw)) return [];
  const out: FacetValue[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const value = typeof item.value === "string" ? item.value.trim() : "";
    const count = toCount(item.count);
    if (value && count > 0) out.push({ value, count });
  }
  return out;
}

function normalizeCategories(raw: unknown): CategoryFacet[] {
  if (!Array.isArray(raw)) return [];
  const out: CategoryFacet[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const count = toCount(item.count);
    if (slug && count > 0) out.push({ slug, name: name || slug, count });
  }
  return out;
}

/** Coerce the raw `api.catalog_facets()` payload into the typed, safe shape. */
export function normalizeFacets(raw: unknown): CatalogFacets {
  if (!isRecord(raw)) return EMPTY_FACETS;
  return {
    categories: normalizeCategories(raw.categories),
    colors: normalizeFacetValues(raw.colors),
    fabrics: normalizeFacetValues(raw.fabrics),
    occasions: normalizeFacetValues(raw.occasions),
  };
}

/** The display values of a facet list, in the order the DB returned them. */
export function facetValues(list: FacetValue[]): string[] {
  return list.map((f) => f.value);
}
