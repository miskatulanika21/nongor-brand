import type { Product, ProductType } from "@/lib/products";
import type { CatalogFacets } from "@/lib/catalog-facets";

/**
 * Single UI mapping layer for customer-facing categories.
 * NOTE: product data (product.type) is the source of truth and is never mutated
 * here — this only maps display categories/filters onto it. Category counts come
 * from the database via `api.catalog_facets()` (see `rollupCategoryCounts`), not
 * from any in-memory product array.
 */

export type CategorySlug = "kurti" | "saree" | "three-piece" | "girls-dress" | "cosmetics";

export type FilterSlug = "new-arrivals" | "best-sellers";

/** Product types that roll up under the single "Cosmetics" category. */
export const COSMETIC_TYPES: ProductType[] = ["cosmetics", "makeup", "serum"];

/** Cosmetics sub-filter chips (UI grouping only). */
export const COSMETIC_SUBTYPES: { label: string; type: ProductType }[] = [
  { label: "Makeup", type: "makeup" },
  { label: "Serum", type: "serum" },
  { label: "Skincare", type: "cosmetics" },
];

export type NavCategory = {
  label: string;
  /** category search param, when this entry filters by category */
  category?: CategorySlug;
  /** filter search param, when this entry filters by a tag */
  filter?: FilterSlug;
};

/** Ordered primary categories used across header, mobile menu, footer, etc. */
export const PRIMARY_CATEGORIES: NavCategory[] = [
  { label: "Kurti", category: "kurti" },
  { label: "Saree", category: "saree" },
  { label: "Three Piece", category: "three-piece" },
  { label: "Girls Dress", category: "girls-dress" },
  { label: "Cosmetics", category: "cosmetics" },
  { label: "New Arrivals", filter: "new-arrivals" },
];

/**
 * Discovery links — NOT physical product categories. These are tag/filter or
 * route shortcuts (New Arrivals, Best Sellers, Custom Fit).
 */
export type DiscoveryLink =
  | { label: string; filter: FilterSlug; to?: undefined }
  | { label: string; to: string; filter?: undefined };

export const DISCOVERY_LINKS: DiscoveryLink[] = [
  { label: "New Arrivals", filter: "new-arrivals" },
  { label: "Best Sellers", filter: "best-sellers" },
  { label: "Custom Fit", to: "/custom-size-policy" },
];

export function matchesCategory(p: Product, category: string): boolean {
  if (!category) return true;
  if (category === "cosmetics") return COSMETIC_TYPES.includes(p.type);
  return p.type === category;
}

export function matchesFilter(p: Product, filter: string): boolean {
  if (!filter) return true;
  if (filter === "new-arrivals") return Boolean(p.isNew);
  if (filter === "best-sellers") return Boolean(p.isBestSeller);
  return true;
}

/** Customer-facing primary categories (slug + label) for filter sidebars. */
export const CATEGORY_FILTERS: { name: string; slug: CategorySlug }[] = [
  { name: "Kurti", slug: "kurti" },
  { name: "Saree", slug: "saree" },
  { name: "Three Piece", slug: "three-piece" },
  { name: "Girls Dress", slug: "girls-dress" },
  { name: "Cosmetics", slug: "cosmetics" },
];

/**
 * Roll the physical DB category counts from `api.catalog_facets()` up onto the
 * five customer-facing categories. The three cosmetics product types
 * (cosmetics / makeup / serum) collapse into the single "Cosmetics" facet, so
 * their counts are summed. Categories with no visible products report 0.
 */
export function rollupCategoryCounts(facets: CatalogFacets): Record<CategorySlug, number> {
  const counts: Record<CategorySlug, number> = {
    kurti: 0,
    saree: 0,
    "three-piece": 0,
    "girls-dress": 0,
    cosmetics: 0,
  };
  for (const c of facets.categories) {
    const slug = COSMETIC_TYPES.includes(c.slug as ProductType) ? "cosmetics" : c.slug;
    if (slug in counts) counts[slug as CategorySlug] += c.count;
  }
  return counts;
}

/**
 * Physical product categories only (no discovery filters). Derived from the
 * shared CATEGORY_FILTERS so Footer / SearchDialog never maintain their own
 * category arrays. Safe to consume anywhere a category link list is needed.
 */
export const PRODUCT_CATEGORIES: { label: string; category: CategorySlug }[] = CATEGORY_FILTERS.map(
  (c) => ({ label: c.name, category: c.slug }),
);

/** Display label for a category slug (handles the cosmetics rollup). */
export function categoryLabel(slug: string): string {
  const found = CATEGORY_FILTERS.find((c) => c.slug === slug);
  if (found) return found.name;
  return slug;
}

export function filterLabel(slug: string): string {
  if (slug === "new-arrivals") return "New Arrivals";
  if (slug === "best-sellers") return "Best Sellers";
  return slug;
}
