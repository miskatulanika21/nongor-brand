import kurtiImg from "@/assets/products/kurti.webp";
import sareeImg from "@/assets/products/saree.webp";
import threePieceImg from "@/assets/products/three-piece.webp";
import girlsImg from "@/assets/products/girls-dress.webp";
import cosmeticsImg from "@/assets/products/cosmetics.webp";
import serumImg from "@/assets/products/serum.webp";

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

const sampleReviews: Review[] = [
  {
    id: "r1",
    name: "Tahmina A.",
    rating: 5,
    date: "2026-05-12",
    text: "The fabric quality is stunning and the custom-size fit was absolutely perfect. Will order again!",
  },
  {
    id: "r2",
    name: "Rumana K.",
    rating: 5,
    date: "2026-04-28",
    text: "Delivery was quick and the packaging felt premium. The handwork is gorgeous.",
  },
  {
    id: "r3",
    name: "Nusrat J.",
    rating: 4,
    date: "2026-04-02",
    text: "Beautiful colour, true to the photos. Sleeve was a touch long but overall lovely.",
  },
];

export const PRODUCTS: Product[] = [
  {
    id: "p1",
    slug: "maroon-handloom-kurti",
    name: "Maroon Handloom Embroidered Kurti",
    type: "kurti",
    category: "Kurti",
    price: 2890,
    salePrice: 2390,
    image: kurtiImg,
    gallery: [kurtiImg, kurtiImg, kurtiImg],
    hasVideo: true,
    rating: 4.8,
    reviewCount: 42,
    stock: 18,
    isNew: true,
    isHandmade: true,
    isBestSeller: true,
    color: "Maroon",
    colors: ["Maroon", "Ivory", "Emerald"],
    fabric: "Handloom Cotton",
    occasion: "Festive",
    customSize: true,
    customSizeCharge: 300,
    description:
      "A signature Nongorr kurti in deep maroon handloom cotton, finished with delicate antique-gold neckline embroidery. Breathable, elegant and made for all-day comfort.",
    care: "Hand wash cold separately. Do not bleach. Iron on medium. Dry in shade.",
    sizeStock: { XS: 3, S: 6, M: 5, L: 2, XL: 2, XXL: 0 },
    reviews: sampleReviews,
  },
  {
    id: "p2",
    slug: "ivory-chikankari-kurti",
    name: "Ivory Chikankari Festive Kurti",
    type: "kurti",
    category: "Kurti",
    price: 3450,
    salePrice: null,
    image: kurtiImg,
    gallery: [kurtiImg, kurtiImg],
    rating: 4.9,
    reviewCount: 31,
    stock: 10,
    isNew: true,
    isHandmade: true,
    color: "Ivory",
    colors: ["Ivory", "Blush"],
    fabric: "Cotton Lawn",
    occasion: "Eid",
    customSize: true,
    customSizeCharge: 350,
    description:
      "Hand-embroidered chikankari kurti in soft ivory lawn — timeless craftsmanship for festive days.",
    care: "Gentle hand wash. Iron inside-out on low heat.",
    sizeStock: { XS: 2, S: 3, M: 3, L: 2, XL: 0, XXL: 0 },
    reviews: sampleReviews,
  },
  {
    id: "p3",
    slug: "emerald-everyday-kurti",
    name: "Emerald Everyday Cotton Kurti",
    type: "kurti",
    category: "Kurti",
    price: 1990,
    salePrice: 1690,
    image: kurtiImg,
    gallery: [kurtiImg],
    rating: 4.6,
    reviewCount: 58,
    stock: 25,
    isBestSeller: true,
    color: "Emerald",
    fabric: "Cotton",
    occasion: "Casual",
    customSize: true,
    customSizeCharge: 250,
    description: "An easy everyday kurti in calming emerald, light enough for Dhaka summers.",
    care: "Machine wash gentle. Tumble dry low.",
    sizeStock: { XS: 5, S: 6, M: 6, L: 5, XL: 3, XXL: 0 },
    reviews: sampleReviews,
  },
  {
    id: "p4",
    slug: "royal-jamdani-saree",
    name: "Royal Maroon Jamdani Saree",
    type: "saree",
    category: "Saree",
    price: 7800,
    salePrice: 6900,
    image: sareeImg,
    gallery: [sareeImg, sareeImg],
    hasVideo: true,
    rating: 4.9,
    reviewCount: 19,
    stock: 6,
    isNew: true,
    isHandmade: true,
    isBestSeller: true,
    color: "Maroon",
    fabric: "Handwoven Jamdani",
    occasion: "Wedding",
    blousePiece: true,
    length: "12 hands (5.5m + 0.8m blouse)",
    workType: "Traditional handloom motif",
    description:
      "A heritage handwoven jamdani saree in royal maroon with antique-gold motifs. Includes a matching blouse piece.",
    care: "Dry clean only. Store wrapped in muslin.",
    reviews: sampleReviews,
  },
  {
    id: "p5",
    slug: "sage-unstitched-three-piece",
    name: "Sage Embroidered Unstitched Three Piece",
    type: "three-piece",
    category: "Three Piece",
    price: 4200,
    salePrice: 3650,
    image: threePieceImg,
    gallery: [threePieceImg, threePieceImg],
    rating: 4.7,
    reviewCount: 23,
    stock: 14,
    isNew: true,
    color: "Sage",
    fabric: "Lawn Cotton",
    occasion: "Festive",
    stitched: false,
    piecesIncluded: "Shirt, Dupatta, Bottom (3 pcs)",
    description:
      "Unstitched three-piece set in soft sage with delicate threadwork — ready for your tailor's magic.",
    care: "Wash before stitching. Hand wash recommended.",
    reviews: sampleReviews,
  },
  {
    id: "p6",
    slug: "rose-stitched-three-piece",
    name: "Rose Stitched Three Piece Set",
    type: "three-piece",
    category: "Three Piece",
    price: 5200,
    salePrice: null,
    image: threePieceImg,
    gallery: [threePieceImg],
    rating: 4.8,
    reviewCount: 12,
    stock: 9,
    isBestSeller: true,
    color: "Rose",
    fabric: "Viscose",
    occasion: "Party",
    stitched: true,
    piecesIncluded: "Kameez, Dupatta, Salwar",
    description: "Ready-to-wear rose three-piece, tailored for an effortless festive look.",
    care: "Dry clean preferred.",
    sizeStock: { XS: 2, S: 2, M: 3, L: 2, XL: 0, XXL: 0 },
    reviews: sampleReviews,
  },
  {
    id: "p7",
    slug: "little-blossom-girls-dress",
    name: "Little Blossom Girls Frock",
    type: "girls-dress",
    category: "Girls Dress",
    price: 1650,
    salePrice: 1390,
    image: girlsImg,
    gallery: [girlsImg, girlsImg],
    rating: 4.9,
    reviewCount: 27,
    stock: 20,
    isNew: true,
    color: "Blush",
    fabric: "Cotton Frill",
    occasion: "Party",
    description: "An adorable twirl-worthy frock for your little one, in soft blush cotton.",
    care: "Machine wash gentle, low heat iron.",
    sizeStock: {
      "1–2 yrs": 4,
      "3–4 yrs": 5,
      "5–6 yrs": 4,
      "7–8 yrs": 3,
      "9–10 yrs": 2,
      "11–12 yrs": 2,
    },
    reviews: sampleReviews,
  },
  {
    id: "p8",
    slug: "velvet-matte-lipstick",
    name: "Velvet Matte Lipstick — Maroon Muse",
    type: "makeup",
    category: "Makeup",
    price: 890,
    salePrice: 750,
    image: cosmeticsImg,
    gallery: [cosmeticsImg, cosmeticsImg],
    rating: 4.7,
    reviewCount: 64,
    stock: 40,
    isBestSeller: true,
    color: "Maroon",
    shade: "Maroon Muse",
    volume: "3.5 g",
    skinType: "All skin types",
    expiry: "2028-03",
    batch: "NGM-2403",
    ingredients: "Shea butter, Vitamin E, natural waxes, pigment.",
    howToUse: "Apply directly from bullet, build to desired intensity.",
    safety: "For external use only. Discontinue if irritation occurs.",
    description:
      "A weightless velvet-matte lipstick in our signature maroon, all-day comfort wear.",
    reviews: sampleReviews,
  },
  {
    id: "p9",
    slug: "glow-vitamin-c-serum",
    name: "Glow Vitamin C Brightening Serum",
    type: "serum",
    category: "Serum",
    price: 1450,
    salePrice: 1190,
    image: serumImg,
    gallery: [serumImg, serumImg],
    rating: 4.8,
    reviewCount: 88,
    stock: 33,
    isNew: true,
    isBestSeller: true,
    color: "Clear",
    volume: "30 ml",
    skinType: "Normal to combination",
    expiry: "2027-11",
    batch: "NGS-2411",
    ingredients: "10% Vitamin C, Hyaluronic acid, Ferulic acid, Aloe.",
    howToUse: "Apply 3–4 drops on cleansed skin morning & night before moisturiser.",
    safety: "Patch test before first use. Use SPF during the day.",
    description: "A brightening Vitamin C serum for a radiant, even-toned glow.",
    reviews: sampleReviews,
  },
  {
    id: "p10",
    slug: "nude-glow-foundation",
    name: "Nude Glow Liquid Foundation",
    type: "cosmetics",
    category: "Cosmetics",
    price: 1280,
    salePrice: null,
    image: cosmeticsImg,
    gallery: [cosmeticsImg],
    rating: 4.5,
    reviewCount: 41,
    stock: 22,
    color: "Beige",
    shade: "Natural Beige",
    volume: "30 ml",
    skinType: "Normal to dry",
    expiry: "2027-08",
    batch: "NGC-2408",
    ingredients: "Hydrating complex, SPF 15, light-diffusing pigments.",
    howToUse: "Dot on face and blend with sponge or brush.",
    safety: "Avoid contact with eyes.",
    description: "A breathable medium-coverage foundation with a natural glow finish.",
    reviews: sampleReviews,
  },
];

export const CATEGORIES = [
  { name: "Kurti", slug: "kurti", count: 3 },
  { name: "Saree", slug: "saree", count: 1 },
  { name: "Three Piece", slug: "three-piece", count: 2 },
  { name: "Girls Dress", slug: "girls-dress", count: 1 },
  { name: "Cosmetics", slug: "cosmetics", count: 1 },
  { name: "Makeup", slug: "makeup", count: 1 },
  { name: "Serum", slug: "serum", count: 1 },
];

// NOTE: the shop filter facets (colours / fabrics / occasions / category counts)
// are DB-backed as of Stage 2 Pass 3c — see `api.catalog_facets()` and
// `src/lib/catalog-facets.ts`. The previous hard-coded COLORS/FABRICS/OCCASIONS
// arrays were removed so the sidebar can never drift from the live catalog.

export function getProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

/**
 * Products that need a size or custom measurement choice should NOT be added to
 * the cart directly from a card — they route to quick view / product details.
 */
export function requiresSelection(p: Product): boolean {
  return Boolean(p.customSize) || Boolean(p.sizeStock && Object.keys(p.sizeStock).length > 0);
}

export function relatedProducts(p: Product): Product[] {
  return PRODUCTS.filter((x) => x.type === p.type && x.id !== p.id).slice(0, 4);
}
