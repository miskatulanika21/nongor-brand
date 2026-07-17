/**
 * Isomorphic product MODEL — types, size constants, and pure helpers only.
 *
 * The mock `PRODUCTS` seed (and `CATEGORIES`/`getProduct`/`relatedProducts`,
 * which read it) was deleted in the Stage-5 polish pass: the whole storefront
 * reads the live catalog via `catalog.api.ts` → `catalog.server.ts`, and
 * `catalog-map.ts` maps DB rows into this `Product` shape.
 */
import type { ImageFocal } from "@/lib/image-focal";

export type ProductType =
  | "kurti"
  | "saree"
  | "three-piece"
  | "girls-dress"
  | "cosmetics"
  | "makeup"
  | "serum";

export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  kurti: "Kurti",
  saree: "Saree",
  "three-piece": "Three Piece",
  "girls-dress": "Girls Dress",
  cosmetics: "Cosmetics",
  makeup: "Makeup",
  serum: "Serum",
};

export const READY_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export const GIRLS_SIZES = [
  "1–2 yrs",
  "3–4 yrs",
  "5–6 yrs",
  "7–8 yrs",
  "9–10 yrs",
  "11–12 yrs",
] as const;

export interface Review {
  id: string;
  name: string;
  rating: number;
  date: string;
  text: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  type: ProductType;
  category: string;
  price: number;
  salePrice?: number | null;
  image: string;
  /** Focal point + zoom for the primary {@link image} when shown object-cover. */
  imageFocal?: ImageFocal;
  gallery: string[];
  hasVideo?: boolean;
  rating: number;
  reviewCount: number;
  stock: number;
  isNew?: boolean;
  isHandmade?: boolean;
  isBestSeller?: boolean;
  color: string;
  colors?: string[];
  fabric?: string;
  occasion?: string;
  customSize?: boolean;
  customSizeCharge?: number;
  description: string;
  care?: string;
  // type-specific
  sizeStock?: Record<string, number>;
  blousePiece?: boolean;
  length?: string;
  workType?: string;
  stitched?: boolean;
  piecesIncluded?: string;
  shade?: string;
  volume?: string;
  skinType?: string;
  expiry?: string;
  batch?: string;
  ingredients?: string;
  howToUse?: string;
  safety?: string;
  reviews?: Review[];
}

// NOTE: the shop filter facets (colours / fabrics / occasions / category counts)
// are DB-backed as of Stage 2 Pass 3c — see `api.catalog_facets()` and
// `src/lib/catalog-facets.ts`. The previous hard-coded COLORS/FABRICS/OCCASIONS
// arrays were removed so the sidebar can never drift from the live catalog.

/**
 * Products that need a size or custom measurement choice should NOT be added to
 * the cart directly from a card — they route to quick view / product details.
 */
export function requiresSelection(p: Product): boolean {
  return Boolean(p.customSize) || Boolean(p.sizeStock && Object.keys(p.sizeStock).length > 0);
}
