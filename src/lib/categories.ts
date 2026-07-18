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

/** Narrow an arbitrary URL segment to a known category slug. */
export function isCategorySlug(v: string): v is CategorySlug {
  return CATEGORY_FILTERS.some((c) => c.slug === v);
}

/**
 * Canonical crawlable path for a category.
 *
 * Categories are reachable two ways on purpose:
 *   - `/shop/kurti`      → the indexable landing page (this path). Stable URL,
 *                          unique title/description/H1, its own schema.
 *   - `/shop?category=…` → the interactive filter view, which is a *state* of
 *                          the shop and canonicalises back to the path above.
 *
 * Search engines only reliably treat distinct paths as pages in their own
 * right, so every nav/footer/homepage category link points here.
 */
export function categoryPath(slug: CategorySlug): string {
  return `/shop/${slug}`;
}

/** Per-category page copy. Unique text per category — duplicated boilerplate
 *  across category pages reads as thin content and suppresses them in search. */
export const CATEGORY_SEO: Record<
  CategorySlug,
  { title: string; description: string; heading: string; intro: string }
> = {
  kurti: {
    title: "Kurti Collection — Handmade & Embroidered Kurtis | Nongorr",
    description:
      "Shop Nongorr's kurti collection — handloom, chikankari and embroidered kurtis for everyday and occasion wear. Stitched and unstitched, delivered across Bangladesh.",
    heading: "Kurti Collection",
    intro:
      "Handloom weaves, chikankari threadwork and everyday cottons — our kurtis are made in small batches, with stitched and unstitched options and custom sizing on request.",
  },
  saree: {
    title: "Saree Collection — Jamdani & Handloom Sarees | Nongorr",
    description:
      "Explore Nongorr's saree collection featuring jamdani, handloom and occasion sarees. Premium Bangladeshi craftsmanship with nationwide cash-on-delivery.",
    heading: "Saree Collection",
    intro:
      "From heritage jamdani to soft everyday handloom, each saree is chosen for its weave, drape and finish — traditional craft cut for how women dress today.",
  },
  "three-piece": {
    title: "Three Piece Collection — Stitched & Unstitched | Nongorr",
    description:
      "Browse Nongorr's three piece sets — stitched and unstitched salwar kameez in premium fabrics, with custom tailoring available across Bangladesh.",
    heading: "Three Piece Collection",
    intro:
      "Complete three piece sets in premium fabric, available stitched to your measurements or unstitched for your own tailor.",
  },
  "girls-dress": {
    title: "Girls Dress Collection — Kids Ethnic & Party Wear | Nongorr",
    description:
      "Shop Nongorr's girls dress collection — festive, party and everyday ethnic wear for children in soft, skin-friendly fabrics.",
    heading: "Girls Dress Collection",
    intro:
      "Festive and everyday dresses for girls, cut in soft skin-friendly fabrics with the same finish standards as our adult collection.",
  },
  cosmetics: {
    title: "Beauty & Cosmetics — Makeup, Serum & Skincare | Nongorr",
    description:
      "Discover Nongorr's beauty edit — makeup, vitamin C serums and skincare selected for Bangladeshi skin and climate.",
    heading: "Beauty & Cosmetics",
    intro:
      "A tight, considered beauty edit — makeup, serums and skincare picked to suit Bangladeshi skin tones and climate rather than to fill a catalogue.",
  },
};

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
