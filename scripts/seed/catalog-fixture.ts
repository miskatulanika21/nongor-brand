/**
 * Catalog seed fixture — pure, serializable, no Vite/asset imports.
 *
 * This is the single source of truth for the INITIAL catalog seed. It mirrors
 * the legacy `src/lib/products.ts` data but with stable public image paths
 * (`/assets/products/*.jpg`) so a Node seed script can run without bundling
 * Vite-imported JPGs. `code` preserves the legacy product id ("p1".."p10")
 * used by cart/wishlist localStorage.
 *
 * Transitional: once the admin write path reads/writes the DB (next Stage 2
 * pass), the legacy `PRODUCTS` array is removed and this fixture remains the
 * one-time seed artifact.
 */

export interface CategorySeed {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface MediaSeed {
  url: string;
  alt: string;
  kind: "image" | "video";
  sortOrder: number;
  isPrimary: boolean;
}

export interface SizeSeed {
  size: string;
  quantity: number;
  sortOrder: number;
}

export interface ReviewSeed {
  seedKey: string;
  authorName: string;
  rating: number;
  body: string;
  createdAt: string; // ISO
  status: "approved";
}

export interface ProductSeed {
  code: string;
  slug: string;
  name: string;
  categorySlug: string;
  price: number;
  salePrice: number | null;
  stock: number;
  rating: number;
  reviewCount: number;
  status: "active";
  sortOrder: number;
  isNew: boolean;
  isHandmade: boolean;
  isBestSeller: boolean;
  hasVideo: boolean;
  customSize: boolean;
  customSizeCharge: number | null;
  color: string | null;
  colors: string[] | null;
  fabric: string | null;
  occasion: string | null;
  description: string;
  care: string | null;
  blousePiece: boolean | null;
  length: string | null;
  workType: string | null;
  stitched: boolean | null;
  piecesIncluded: string | null;
  shade: string | null;
  volume: string | null;
  skinType: string | null;
  expiry: string | null;
  batch: string | null;
  ingredients: string | null;
  howToUse: string | null;
  safety: string | null;
  media: MediaSeed[];
  sizes: SizeSeed[];
  reviews: ReviewSeed[];
}

const IMG = (file: string) => `/assets/products/${file}`;

export const CATEGORY_SEED: CategorySeed[] = [
  { slug: "kurti", name: "Kurti", sortOrder: 0 },
  { slug: "saree", name: "Saree", sortOrder: 1 },
  { slug: "three-piece", name: "Three Piece", sortOrder: 2 },
  { slug: "girls-dress", name: "Girls Dress", sortOrder: 3 },
  { slug: "cosmetics", name: "Cosmetics", sortOrder: 4 },
  { slug: "makeup", name: "Makeup", sortOrder: 5 },
  { slug: "serum", name: "Serum", sortOrder: 6 },
];

// Shared sample reviews (mirrors legacy sampleReviews). createdAt preserves the
// legacy display date; seedKey is deterministic per product for idempotency.
function reviewsFor(code: string): ReviewSeed[] {
  return [
    {
      seedKey: `${code}:r1`,
      authorName: "Tahmina A.",
      rating: 5,
      body: "The fabric quality is stunning and the custom-size fit was absolutely perfect. Will order again!",
      createdAt: "2026-05-12T00:00:00Z",
      status: "approved",
    },
    {
      seedKey: `${code}:r2`,
      authorName: "Rumana K.",
      rating: 5,
      body: "Delivery was quick and the packaging felt premium. The handwork is gorgeous.",
      createdAt: "2026-04-28T00:00:00Z",
      status: "approved",
    },
    {
      seedKey: `${code}:r3`,
      authorName: "Nusrat J.",
      rating: 4,
      body: "Beautiful colour, true to the photos. Sleeve was a touch long but overall lovely.",
      createdAt: "2026-04-02T00:00:00Z",
      status: "approved",
    },
  ];
}

function media(file: string, alt: string, count: number): MediaSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    url: IMG(file),
    alt,
    kind: "image" as const,
    sortOrder: i,
    isPrimary: i === 0,
  }));
}

function readySizes(stock: Record<string, number>): SizeSeed[] {
  const order = ["XS", "S", "M", "L", "XL", "XXL"];
  return Object.entries(stock).map(([size, quantity]) => ({
    size,
    quantity,
    sortOrder: order.indexOf(size),
  }));
}

function girlsSizes(stock: Record<string, number>): SizeSeed[] {
  const order = ["1–2 yrs", "3–4 yrs", "5–6 yrs", "7–8 yrs", "9–10 yrs", "11–12 yrs"];
  return Object.entries(stock).map(([size, quantity]) => ({
    size,
    quantity,
    sortOrder: order.indexOf(size),
  }));
}

// Blank descriptive fields default to null so DB nullable columns stay clean.
const NULLS = {
  blousePiece: null,
  length: null,
  workType: null,
  stitched: null,
  piecesIncluded: null,
  shade: null,
  volume: null,
  skinType: null,
  expiry: null,
  batch: null,
  ingredients: null,
  howToUse: null,
  safety: null,
} as const;

export const PRODUCT_SEED: ProductSeed[] = [
  {
    code: "p1",
    slug: "maroon-handloom-kurti",
    name: "Maroon Handloom Embroidered Kurti",
    categorySlug: "kurti",
    price: 2890,
    salePrice: 2390,
    stock: 18,
    rating: 4.8,
    reviewCount: 42,
    status: "active",
    sortOrder: 0,
    isNew: true,
    isHandmade: true,
    isBestSeller: true,
    hasVideo: true,
    customSize: true,
    customSizeCharge: 300,
    color: "Maroon",
    colors: ["Maroon", "Ivory", "Emerald"],
    fabric: "Handloom Cotton",
    occasion: "Festive",
    description:
      "A signature Nongorr kurti in deep maroon handloom cotton, finished with delicate antique-gold neckline embroidery. Breathable, elegant and made for all-day comfort.",
    care: "Hand wash cold separately. Do not bleach. Iron on medium. Dry in shade.",
    ...NULLS,
    media: media("kurti.jpg", "Maroon Handloom Embroidered Kurti", 3),
    sizes: readySizes({ XS: 3, S: 6, M: 5, L: 2, XL: 2, XXL: 0 }),
    reviews: reviewsFor("p1"),
  },
  {
    code: "p2",
    slug: "ivory-chikankari-kurti",
    name: "Ivory Chikankari Festive Kurti",
    categorySlug: "kurti",
    price: 3450,
    salePrice: null,
    stock: 10,
    rating: 4.9,
    reviewCount: 31,
    status: "active",
    sortOrder: 1,
    isNew: true,
    isHandmade: true,
    isBestSeller: false,
    hasVideo: false,
    customSize: true,
    customSizeCharge: 350,
    color: "Ivory",
    colors: ["Ivory", "Blush"],
    fabric: "Cotton Lawn",
    occasion: "Eid",
    description:
      "Hand-embroidered chikankari kurti in soft ivory lawn — timeless craftsmanship for festive days.",
    care: "Gentle hand wash. Iron inside-out on low heat.",
    ...NULLS,
    media: media("kurti.jpg", "Ivory Chikankari Festive Kurti", 2),
    sizes: readySizes({ XS: 2, S: 3, M: 3, L: 2, XL: 0, XXL: 0 }),
    reviews: reviewsFor("p2"),
  },
  {
    code: "p3",
    slug: "emerald-everyday-kurti",
    name: "Emerald Everyday Cotton Kurti",
    categorySlug: "kurti",
    price: 1990,
    salePrice: 1690,
    stock: 25,
    rating: 4.6,
    reviewCount: 58,
    status: "active",
    sortOrder: 2,
    isNew: false,
    isHandmade: false,
    isBestSeller: true,
    hasVideo: false,
    customSize: true,
    customSizeCharge: 250,
    color: "Emerald",
    colors: null,
    fabric: "Cotton",
    occasion: "Casual",
    description: "An easy everyday kurti in calming emerald, light enough for Dhaka summers.",
    care: "Machine wash gentle. Tumble dry low.",
    ...NULLS,
    media: media("kurti.jpg", "Emerald Everyday Cotton Kurti", 1),
    sizes: readySizes({ XS: 5, S: 6, M: 6, L: 5, XL: 3, XXL: 0 }),
    reviews: reviewsFor("p3"),
  },
  {
    code: "p4",
    slug: "royal-jamdani-saree",
    name: "Royal Maroon Jamdani Saree",
    categorySlug: "saree",
    price: 7800,
    salePrice: 6900,
    stock: 6,
    rating: 4.9,
    reviewCount: 19,
    status: "active",
    sortOrder: 3,
    isNew: true,
    isHandmade: true,
    isBestSeller: true,
    hasVideo: true,
    customSize: false,
    customSizeCharge: null,
    color: "Maroon",
    colors: null,
    fabric: "Handwoven Jamdani",
    occasion: "Wedding",
    description:
      "A heritage handwoven jamdani saree in royal maroon with antique-gold motifs. Includes a matching blouse piece.",
    care: "Dry clean only. Store wrapped in muslin.",
    ...NULLS,
    blousePiece: true,
    length: "12 hands (5.5m + 0.8m blouse)",
    workType: "Traditional handloom motif",
    media: media("saree.jpg", "Royal Maroon Jamdani Saree", 2),
    sizes: [],
    reviews: reviewsFor("p4"),
  },
  {
    code: "p5",
    slug: "sage-unstitched-three-piece",
    name: "Sage Embroidered Unstitched Three Piece",
    categorySlug: "three-piece",
    price: 4200,
    salePrice: 3650,
    stock: 14,
    rating: 4.7,
    reviewCount: 23,
    status: "active",
    sortOrder: 4,
    isNew: true,
    isHandmade: false,
    isBestSeller: false,
    hasVideo: false,
    customSize: false,
    customSizeCharge: null,
    color: "Sage",
    colors: null,
    fabric: "Lawn Cotton",
    occasion: "Festive",
    description:
      "Unstitched three-piece set in soft sage with delicate threadwork — ready for your tailor's magic.",
    care: "Wash before stitching. Hand wash recommended.",
    ...NULLS,
    stitched: false,
    piecesIncluded: "Shirt, Dupatta, Bottom (3 pcs)",
    media: media("three-piece.jpg", "Sage Embroidered Unstitched Three Piece", 2),
    sizes: [],
    reviews: reviewsFor("p5"),
  },
  {
    code: "p6",
    slug: "rose-stitched-three-piece",
    name: "Rose Stitched Three Piece Set",
    categorySlug: "three-piece",
    price: 5200,
    salePrice: null,
    stock: 9,
    rating: 4.8,
    reviewCount: 12,
    status: "active",
    sortOrder: 5,
    isNew: false,
    isHandmade: false,
    isBestSeller: true,
    hasVideo: false,
    customSize: false,
    customSizeCharge: null,
    color: "Rose",
    colors: null,
    fabric: "Viscose",
    occasion: "Party",
    description: "Ready-to-wear rose three-piece, tailored for an effortless festive look.",
    care: "Dry clean preferred.",
    ...NULLS,
    stitched: true,
    piecesIncluded: "Kameez, Dupatta, Salwar",
    media: media("three-piece.jpg", "Rose Stitched Three Piece Set", 1),
    sizes: readySizes({ XS: 2, S: 2, M: 3, L: 2, XL: 0, XXL: 0 }),
    reviews: reviewsFor("p6"),
  },
  {
    code: "p7",
    slug: "little-blossom-girls-dress",
    name: "Little Blossom Girls Frock",
    categorySlug: "girls-dress",
    price: 1650,
    salePrice: 1390,
    stock: 20,
    rating: 4.9,
    reviewCount: 27,
    status: "active",
    sortOrder: 6,
    isNew: true,
    isHandmade: false,
    isBestSeller: false,
    hasVideo: false,
    customSize: false,
    customSizeCharge: null,
    color: "Blush",
    colors: null,
    fabric: "Cotton Frill",
    occasion: "Party",
    description: "An adorable twirl-worthy frock for your little one, in soft blush cotton.",
    care: "Machine wash gentle, low heat iron.",
    ...NULLS,
    media: media("girls-dress.jpg", "Little Blossom Girls Frock", 2),
    sizes: girlsSizes({
      "1–2 yrs": 4,
      "3–4 yrs": 5,
      "5–6 yrs": 4,
      "7–8 yrs": 3,
      "9–10 yrs": 2,
      "11–12 yrs": 2,
    }),
    reviews: reviewsFor("p7"),
  },
  {
    code: "p8",
    slug: "velvet-matte-lipstick",
    name: "Velvet Matte Lipstick — Maroon Muse",
    categorySlug: "makeup",
    price: 890,
    salePrice: 750,
    stock: 40,
    rating: 4.7,
    reviewCount: 64,
    status: "active",
    sortOrder: 7,
    isNew: false,
    isHandmade: false,
    isBestSeller: true,
    hasVideo: false,
    customSize: false,
    customSizeCharge: null,
    color: "Maroon",
    colors: null,
    fabric: null,
    occasion: null,
    description:
      "A weightless velvet-matte lipstick in our signature maroon, all-day comfort wear.",
    care: null,
    ...NULLS,
    shade: "Maroon Muse",
    volume: "3.5 g",
    skinType: "All skin types",
    expiry: "2028-03",
    batch: "NGM-2403",
    ingredients: "Shea butter, Vitamin E, natural waxes, pigment.",
    howToUse: "Apply directly from bullet, build to desired intensity.",
    safety: "For external use only. Discontinue if irritation occurs.",
    media: media("cosmetics.jpg", "Velvet Matte Lipstick — Maroon Muse", 2),
    sizes: [],
    reviews: reviewsFor("p8"),
  },
  {
    code: "p9",
    slug: "glow-vitamin-c-serum",
    name: "Glow Vitamin C Brightening Serum",
    categorySlug: "serum",
    price: 1450,
    salePrice: 1190,
    stock: 33,
    rating: 4.8,
    reviewCount: 88,
    status: "active",
    sortOrder: 8,
    isNew: true,
    isHandmade: false,
    isBestSeller: true,
    hasVideo: false,
    customSize: false,
    customSizeCharge: null,
    color: "Clear",
    colors: null,
    fabric: null,
    occasion: null,
    description: "A brightening Vitamin C serum for a radiant, even-toned glow.",
    care: null,
    ...NULLS,
    volume: "30 ml",
    skinType: "Normal to combination",
    expiry: "2027-11",
    batch: "NGS-2411",
    ingredients: "10% Vitamin C, Hyaluronic acid, Ferulic acid, Aloe.",
    howToUse: "Apply 3–4 drops on cleansed skin morning & night before moisturiser.",
    safety: "Patch test before first use. Use SPF during the day.",
    media: media("serum.jpg", "Glow Vitamin C Brightening Serum", 2),
    sizes: [],
    reviews: reviewsFor("p9"),
  },
  {
    code: "p10",
    slug: "nude-glow-foundation",
    name: "Nude Glow Liquid Foundation",
    categorySlug: "cosmetics",
    price: 1280,
    salePrice: null,
    stock: 22,
    rating: 4.5,
    reviewCount: 41,
    status: "active",
    sortOrder: 9,
    isNew: false,
    isHandmade: false,
    isBestSeller: false,
    hasVideo: false,
    customSize: false,
    customSizeCharge: null,
    color: "Beige",
    colors: null,
    fabric: null,
    occasion: null,
    description: "A breathable medium-coverage foundation with a natural glow finish.",
    care: null,
    ...NULLS,
    shade: "Natural Beige",
    volume: "30 ml",
    skinType: "Normal to dry",
    expiry: "2027-08",
    batch: "NGC-2408",
    ingredients: "Hydrating complex, SPF 15, light-diffusing pigments.",
    howToUse: "Dot on face and blend with sponge or brush.",
    safety: "Avoid contact with eyes.",
    media: media("cosmetics.jpg", "Nude Glow Liquid Foundation", 1),
    sizes: [],
    reviews: reviewsFor("p10"),
  },
];
