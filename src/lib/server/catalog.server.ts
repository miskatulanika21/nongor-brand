/**
 * Catalog repository — SERVER ONLY (`.server.ts` keeps it out of the client
 * bundle). Reads the public catalog through a per-request ANON Supabase client,
 * so every query is constrained by RLS (only active products / active
 * categories / approved reviews are ever returned).
 *
 * No fallback to the legacy mock array: failures surface as typed errors so the
 * route can render the approved error UI rather than silently serving stale or
 * fake data.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { cachedPublic } from "./public-cache.server";
import { toCard, toProduct, type ProductCardRow, type ProductDetailRow } from "@/lib/catalog-map";
import { normalizeFacets, type CatalogFacets } from "@/lib/catalog-facets";
import type { Product } from "@/lib/products";

export class CatalogQueryError extends Error {
  constructor(
    message: string,
    public readonly cause?: string,
  ) {
    super(message);
    this.name = "CatalogQueryError";
  }
}

const CARD_SELECT = `
  code, slug, name, price, sale_price, stock, rating, review_count,
  is_new, is_handmade, is_best_seller, has_video, custom_size, custom_size_charge,
  color, colors, fabric, occasion, shade, volume, skin_type,
  category:product_categories!inner ( slug, name ),
  media:product_media ( url, alt, is_primary, sort_order, focal_x, focal_y, zoom ),
  sizes:product_size_stock ( size, quantity, sort_order )
`;

const DETAIL_SELECT = `
  code, slug, name, price, sale_price, stock, rating, review_count,
  is_new, is_handmade, is_best_seller, has_video, custom_size, custom_size_charge,
  color, colors, fabric, occasion,
  description, care, blouse_piece, length, work_type, stitched, pieces_included,
  shade, volume, skin_type, expiry, batch, ingredients, how_to_use, safety,
  category:product_categories!inner ( slug, name ),
  media:product_media ( url, alt, is_primary, sort_order, focal_x, focal_y, zoom ),
  sizes:product_size_stock ( size, quantity, sort_order ),
  reviews:product_reviews ( id, author_name, rating, body, created_at )
`;

/** Bounded card projection for grids / filters / search, ordered for display. */
async function loadProductCards(): Promise<Product[]> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb
    .from("products")
    .select(CARD_SELECT)
    .order("sort_order", { ascending: true });
  if (error) throw new CatalogQueryError("Failed to load products", error.message);
  return ((data ?? []) as unknown as ProductCardRow[]).map(toCard);
}

/**
 * Cached wrapper — the public card grid is the same for every visitor and is
 * hit on the home page, shop, PDP related products and wishlist resolution, so
 * a warm instance serves it from memory (new/edited products appear within the
 * TTL). Same signature as before for all callers.
 */
export const fetchProductCards = cachedPublic("product-cards", 60_000, loadProductCards);

/** The homepage rails, selected on the server so the page ships ~22 cards
 *  instead of serialising the entire catalog into the HTML. */
export interface FeaturedReview {
  id: string;
  author: string;
  rating: number;
  body: string;
  productName: string;
  productSlug: string;
}

export interface HomeCollections {
  reviews: FeaturedReview[];
  newArrivals: Product[];
  bestSellers: Product[];
  customFit: Product[];
  beauty: Product[];
  social: Product[];
}

const BEAUTY_TYPES = new Set(["cosmetics", "makeup", "serum"]);

export function selectHomeCollections(
  cards: Product[],
  reviews: FeaturedReview[] = [],
): HomeCollections {
  return {
    reviews,
    newArrivals: cards.filter((p) => p.isNew).slice(0, 4),
    bestSellers: cards.filter((p) => p.isBestSeller).slice(0, 4),
    customFit: cards.filter((p) => p.type === "kurti" && p.isHandmade).slice(0, 4),
    beauty: cards.filter((p) => BEAUTY_TYPES.has(p.type)).slice(0, 4),
    social: cards.slice(0, 6),
  };
}

type FeaturedReviewRow = {
  id: string;
  author_name: string;
  rating: number;
  body: string | null;
  product: { name: string; slug: string } | null;
};

/**
 * Real, moderated customer reviews for the homepage — newest 4★+ approved
 * reviews with a written body. Replaces hard-coded testimonials: showing
 * invented quotes as customer reviews is deceptive (and, e.g., unlawful under
 * the FTC's 2024 fake-review rule), and shoppers can tell.
 */
async function loadFeaturedReviews(): Promise<FeaturedReview[]> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb
    .from("product_reviews")
    .select("id, author_name, rating, body, product:products!inner ( name, slug )")
    .eq("status", "approved")
    .gte("rating", 4)
    .not("body", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new CatalogQueryError("Failed to load featured reviews", error.message);
  return ((data ?? []) as unknown as FeaturedReviewRow[])
    .filter((r) => r.product && (r.body ?? "").trim().length >= 20)
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      author: r.author_name,
      rating: r.rating,
      body: (r.body ?? "").trim(),
      productName: r.product!.name,
      productSlug: r.product!.slug,
    }));
}

export const fetchFeaturedReviews = cachedPublic(
  "featured-reviews",
  5 * 60_000,
  loadFeaturedReviews,
);

export async function fetchHomeCollections(): Promise<HomeCollections> {
  const [cards, reviews] = await Promise.all([
    fetchProductCards(),
    // Reviews are an enhancement: a failure hides the section, never the page.
    fetchFeaturedReviews().catch(() => [] as FeaturedReview[]),
  ]);
  return selectHomeCollections(cards, reviews);
}

/** Same-type products for the PDP "You may also like" rail. */
export function selectRelated(cards: Product[], product: Product, limit = 4): Product[] {
  return cards.filter((p) => p.type === product.type && p.id !== product.id).slice(0, limit);
}

/** PDP payload: the full product plus only the related cards it renders. */
export async function fetchProductPage(
  slug: string,
): Promise<{ product: Product; related: Product[] } | null> {
  const [product, cards] = await Promise.all([fetchProductDetail(slug), fetchProductCards()]);
  if (!product) return null;
  return { product, related: selectRelated(cards, product) };
}

/** Cards for a specific set of legacy codes (wishlist resolution). */
export async function fetchProductCardsByCodes(codes: string[]): Promise<Product[]> {
  if (!codes.length) return [];
  const sb = createServerSupabaseClient();
  const { data, error } = await sb
    .from("products")
    .select(CARD_SELECT)
    .in("code", codes)
    .order("sort_order", { ascending: true });
  if (error) throw new CatalogQueryError("Failed to load wishlist products", error.message);
  return ((data ?? []) as unknown as ProductCardRow[]).map(toCard);
}

/**
 * Catalog filter facets (category counts + distinct colours/fabrics/occasions),
 * computed in the database over the publicly-visible catalog via
 * `api.catalog_facets()`. The anon client respects RLS; the function's own
 * predicate guarantees the same visible set regardless.
 */
async function loadCatalogFacets(): Promise<CatalogFacets> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("catalog_facets");
  if (error) throw new CatalogQueryError("Failed to load catalog facets", error.message);
  return normalizeFacets(data);
}

/** Cached wrapper — facet counts track the public catalog; refresh within TTL. */
export const fetchCatalogFacets = cachedPublic("catalog-facets", 60_000, loadCatalogFacets);

/** Full product detail by slug. Returns null when not found / not public. */
export async function fetchProductDetail(slug: string): Promise<Product | null> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb
    .from("products")
    .select(DETAIL_SELECT)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new CatalogQueryError("Failed to load product", error.message);
  if (!data) return null;
  return toProduct(data as unknown as ProductDetailRow);
}
