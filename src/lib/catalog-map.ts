/**
 * Catalog mapping — PURE functions (no I/O), unit-tested.
 *
 * Maps Supabase catalog rows into the existing `Product` shape the storefront
 * UI already consumes, so the approved components render unchanged.
 *
 * Invariants:
 *   - `Product.id` is the stable legacy `code` ("p1".."p10") — keeps cart and
 *     wishlist localStorage keys valid.
 *   - `type` comes from the joined category slug; `category` (label) from its
 *     name — `products.category_id` is the single source of truth.
 *   - Missing media never throws: image falls back to the first media row, then
 *     to a placeholder; gallery always has at least the resolved image.
 *   - `stock` is canonical from size rows when present, else `products.stock`.
 */
import type { Product, ProductType, Review } from "@/lib/products";
import { DEFAULT_FOCAL, toFocal, type ImageFocal } from "@/lib/image-focal";

/** Public fallback used only when a product somehow has no media rows. */
export const PLACEHOLDER_IMAGE = "/og-image.jpg";

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface MediaRow {
  url: string;
  alt: string | null;
  is_primary: boolean;
  sort_order: number;
  focal_x?: number | string | null;
  focal_y?: number | string | null;
  zoom?: number | string | null;
}

export interface SizeRow {
  size: string;
  quantity: number;
  sort_order: number;
}

export interface ReviewRow {
  id: string;
  author_name: string;
  rating: number;
  body: string;
  created_at: string;
}

/** Columns needed to render a product card / power filters (lean projection). */
export interface ProductCardRow {
  code: string;
  slug: string;
  name: string;
  price: number;
  sale_price: number | null;
  stock: number;
  rating: number;
  review_count: number;
  is_new: boolean;
  is_handmade: boolean;
  is_best_seller: boolean;
  has_video: boolean;
  custom_size: boolean;
  custom_size_charge: number | null;
  color: string | null;
  colors: string[] | null;
  fabric: string | null;
  occasion: string | null;
  // Cosmetic facet fields — small, needed for shop filters on cards.
  shade: string | null;
  volume: string | null;
  skin_type: string | null;
  category: CategoryRef | CategoryRef[];
  media: MediaRow[];
  sizes: SizeRow[];
}

/** Full detail row (card columns + descriptive fields + reviews). */
export interface ProductDetailRow extends ProductCardRow {
  description: string;
  care: string | null;
  blouse_piece: boolean | null;
  length: string | null;
  work_type: string | null;
  stitched: boolean | null;
  pieces_included: string | null;
  expiry: string | null;
  batch: string | null;
  ingredients: string | null;
  how_to_use: string | null;
  safety: string | null;
  reviews: ReviewRow[];
}

function firstOf<T>(v: T | T[]): T {
  return Array.isArray(v) ? v[0] : v;
}

function resolveImages(media: MediaRow[]): {
  image: string;
  gallery: string[];
  imageFocal: ImageFocal;
} {
  const sorted = [...(media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const primary = sorted.find((m) => m.is_primary) ?? sorted[0];
  const image = primary?.url || PLACEHOLDER_IMAGE;
  const urls = sorted.map((m) => m.url).filter(Boolean);
  // Focal of the PRIMARY image — it is the thumbnail shown object-cover across
  // shop cards, wishlist, search, etc. Defaults to centre when absent.
  const imageFocal = primary
    ? toFocal(primary.focal_x, primary.focal_y, primary.zoom)
    : DEFAULT_FOCAL;
  return { image, gallery: urls.length ? urls : [image], imageFocal };
}

function toSizeStock(sizes: SizeRow[]): Record<string, number> | undefined {
  if (!sizes?.length) return undefined;
  const sorted = [...sizes].sort((a, b) => a.sort_order - b.sort_order);
  const out: Record<string, number> = {};
  for (const s of sorted) out[s.size] = s.quantity;
  return out;
}

function computeStock(rowStock: number, sizes: SizeRow[]): number {
  if (sizes?.length) return sizes.reduce((sum, s) => sum + s.quantity, 0);
  return rowStock;
}

function toReviews(reviews: ReviewRow[]): Review[] | undefined {
  if (!reviews?.length) return undefined;
  return [...reviews]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({
      id: r.id,
      name: r.author_name,
      rating: r.rating,
      date: r.created_at.slice(0, 10),
      text: r.body,
    }));
}

/** Map a lean card row to a `Product` (description/gallery minimal). */
export function toCard(row: ProductCardRow): Product {
  const cat = firstOf(row.category);
  const { image, gallery, imageFocal } = resolveImages(row.media);
  return {
    id: row.code,
    slug: row.slug,
    name: row.name,
    type: cat.slug as ProductType,
    category: cat.name,
    price: row.price,
    salePrice: row.sale_price,
    image,
    imageFocal,
    gallery,
    hasVideo: row.has_video,
    rating: row.rating,
    reviewCount: row.review_count,
    stock: computeStock(row.stock, row.sizes),
    isNew: row.is_new,
    isHandmade: row.is_handmade,
    isBestSeller: row.is_best_seller,
    color: row.color ?? "",
    colors: row.colors ?? undefined,
    fabric: row.fabric ?? undefined,
    occasion: row.occasion ?? undefined,
    customSize: row.custom_size,
    customSizeCharge: row.custom_size_charge ?? undefined,
    description: "",
    shade: row.shade ?? undefined,
    volume: row.volume ?? undefined,
    skinType: row.skin_type ?? undefined,
    sizeStock: toSizeStock(row.sizes),
  };
}

/** Map a full detail row to a `Product` (gallery, reviews, type-specific). */
export function toProduct(row: ProductDetailRow): Product {
  const cat = firstOf(row.category);
  const { image, gallery, imageFocal } = resolveImages(row.media);
  return {
    id: row.code,
    slug: row.slug,
    name: row.name,
    type: cat.slug as ProductType,
    category: cat.name,
    price: row.price,
    salePrice: row.sale_price,
    image,
    imageFocal,
    gallery,
    hasVideo: row.has_video,
    rating: row.rating,
    reviewCount: row.review_count,
    stock: computeStock(row.stock, row.sizes),
    isNew: row.is_new,
    isHandmade: row.is_handmade,
    isBestSeller: row.is_best_seller,
    color: row.color ?? "",
    colors: row.colors ?? undefined,
    fabric: row.fabric ?? undefined,
    occasion: row.occasion ?? undefined,
    customSize: row.custom_size,
    customSizeCharge: row.custom_size_charge ?? undefined,
    description: row.description,
    care: row.care ?? undefined,
    sizeStock: toSizeStock(row.sizes),
    blousePiece: row.blouse_piece ?? undefined,
    length: row.length ?? undefined,
    workType: row.work_type ?? undefined,
    stitched: row.stitched ?? undefined,
    piecesIncluded: row.pieces_included ?? undefined,
    shade: row.shade ?? undefined,
    volume: row.volume ?? undefined,
    skinType: row.skin_type ?? undefined,
    expiry: row.expiry ?? undefined,
    batch: row.batch ?? undefined,
    ingredients: row.ingredients ?? undefined,
    howToUse: row.how_to_use ?? undefined,
    safety: row.safety ?? undefined,
    reviews: toReviews(row.reviews),
  };
}
