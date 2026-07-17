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
