/**
 * Catalog admin write schemas — single source of truth for product/category
 * input validation. Isomorphic (NO server-only imports), so the same schema
 * validates on the client (form) and on the server (createServerFn validator).
 *
 * Bounds mirror the database CHECK constraints in
 * `20260622000000_catalog_schema.sql` so client and DB agree:
 *   price/stock/custom_size_charge >= 0, sale_price <= price, status enum, etc.
 * The DB remains the final authority; these are defense-in-depth + good UX.
 */
import { z } from "zod";

export const PRODUCT_STATUSES = ["draft", "active", "hidden", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Lowercase, hyphen-separated URL key (no leading/trailing/double hyphens). */
export const slugSchema = z
  .string()
  .trim()
  .min(1, "Required.")
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const productInputSchema = z
  .object({
    // identity
    slug: slugSchema,
    name: z.string().trim().min(1, "Title is required.").max(200),
    categorySlug: z.string().trim().min(1, "Category is required.").max(100),
    status: z.enum(PRODUCT_STATUSES).default("draft"),
    // pricing (integers, BDT — no fractional currency)
    price: z.number().int("Whole number.").nonnegative("Must be 0 or more."),
    salePrice: z.number().int().nonnegative().nullable().optional(),
    stock: z.number().int().nonnegative().default(0),
    // flags
    isNew: z.boolean().optional(),
    isHandmade: z.boolean().optional(),
    isBestSeller: z.boolean().optional(),
    hasVideo: z.boolean().optional(),
    customSize: z.boolean().optional(),
    customSizeCharge: z.number().int().nonnegative().nullable().optional(),
    // descriptive (finite set matching the products table)
    description: z.string().max(8000).default(""),
    color: optionalText(120),
    colors: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    fabric: optionalText(200),
    occasion: optionalText(200),
    care: optionalText(2000),
    length: optionalText(120),
    workType: optionalText(200),
    piecesIncluded: optionalText(200),
    shade: optionalText(120),
    volume: optionalText(120),
    skinType: optionalText(120),
    expiry: optionalText(120),
    batch: optionalText(120),
    ingredients: optionalText(4000),
    howToUse: optionalText(4000),
    safety: optionalText(4000),
    blousePiece: z.boolean().nullable().optional(),
    stitched: z.boolean().nullable().optional(),
  })
  .refine((p) => p.salePrice == null || p.salePrice <= p.price, {
    message: "Sale price must be less than or equal to the regular price.",
    path: ["salePrice"],
  });

export type ProductInput = z.infer<typeof productInputSchema>;

export const categoryInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

// ---- Inventory --------------------------------------------------------------

/** A single stock adjustment (size = null for non-sized products). */
export const inventoryAdjustSchema = z.object({
  code: z.string().trim().min(1).max(64),
  size: z.string().trim().min(1).max(40).nullable(),
  quantity: z.number().int().nonnegative(),
  reason: z.string().trim().min(1, "A reason is required.").max(120),
  note: z.string().trim().max(500).nullable().optional(),
});

export type InventoryAdjust = z.infer<typeof inventoryAdjustSchema>;

/** Bounded bulk adjustment with a client idempotency key (1..100 items). */
export const bulkInventorySchema = z.object({
  opKey: z.string().trim().min(1).max(100),
  items: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(64),
        size: z.string().trim().min(1).max(40).nullable(),
        quantity: z.number().int().nonnegative(),
        reason: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(100),
});

export type BulkInventory = z.infer<typeof bulkInventorySchema>;

/** Reorder payload: one entry per category being repositioned. */
export const categoryReorderSchema = z
  .array(z.object({ slug: slugSchema, sortOrder: z.number().int().min(0).max(100000) }))
  .min(1)
  .max(500);

export type CategoryReorder = z.infer<typeof categoryReorderSchema>;

// ---- Inventory error codes (isomorphic) -------------------------------------

/**
 * Stable, machine-readable error codes raised by the inventory RPCs
 * (api.set_inventory / add_product_variant / remove_product_variant /
 * bulk_set_inventory). The database raises the CODE as the exception message
 * (human-readable context lives in the exception DETAIL), so both the single-op
 * path (thrown PostgREST error) and the bulk path (per-item `error_code`) map
 * through ONE table here. This module is isomorphic (no server-only imports) so
 * the admin UI can translate per-item bulk failures client-side too.
 */
export const INVENTORY_ERROR_MESSAGES: Record<string, string> = {
  product_not_found: "Product not found.",
  variant_not_found: "That size variant does not exist.",
  variant_required: "This product uses size variants; specify a size.",
  variant_not_allowed: "This product has no size variants; omit the size.",
  invalid_quantity: "Invalid quantity.",
  invalid_reason: "A valid reason is required.",
  note_too_long: "Note is too long (max 500 characters).",
  no_change: "Quantity is already at this value.",
  duplicate_target: "Duplicate product/size target in batch.",
  idempotency_key_reused: "This operation key was already used with a different request.",
  actor_not_authorized: "Not authorized.",
  batch_too_large: "Batch size exceeds the maximum (100).",
  batch_empty: "Batch must contain at least one item.",
  op_key_required: "An operation key is required.",
  items_invalid: "Invalid batch payload.",
  variant_not_empty: "Set the variant stock to 0 before removing it.",
  size_already_exists: "That size already exists.",
  invalid_size: "Invalid size label.",
  has_inventory_history: "Cannot purge a product with inventory history.",
  internal_error: "Could not complete the change. Please try again.",
};

/** The set of codes the database is allowed to surface (defensive allow-list). */
export const KNOWN_INVENTORY_ERROR_CODES = new Set(Object.keys(INVENTORY_ERROR_MESSAGES));

/** Map an inventory RPC error code to a safe, user-facing message. */
export function inventoryErrorMessage(code: string | undefined | null): string {
  if (!code) return "An unknown error occurred.";
  return INVENTORY_ERROR_MESSAGES[code] ?? "Could not complete the change. Please try again.";
}

// ---- Reviews (isomorphic) ---------------------------------------------------

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Moderate a single review (set its status). */
export const reviewModerateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(REVIEW_STATUSES),
});
export type ReviewModerate = z.infer<typeof reviewModerateSchema>;

/** Hard-delete a single review. */
export const reviewDeleteSchema = z.object({ id: z.string().uuid() });
export type ReviewDelete = z.infer<typeof reviewDeleteSchema>;

/**
 * Customer review submission (Pass 3b). Isomorphic — validates the product-page
 * form on the client and the server function on the server. Bounds mirror the
 * api.submit_review DB checks. `code` is the stable product code (Product.id).
 */
export const reviewSubmitSchema = z.object({
  code: z.string().trim().min(1).max(64),
  authorName: z.string().trim().min(1, "Your name is required.").max(80),
  rating: z.number().int().min(1, "Select a rating.").max(5),
  body: z.string().trim().min(1, "Please write a few words.").max(2000),
});
export type ReviewSubmit = z.infer<typeof reviewSubmitSchema>;

/**
 * Stable codes raised by the review moderation RPCs (api.set_review_status /
 * api.delete_review), same convention as the inventory codes. Isomorphic so the
 * admin UI can map a thrown code to a message client-side.
 */
export const REVIEW_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  review_not_found: "That review no longer exists. Refresh and try again.",
  invalid_status: "Invalid review status.",
  // Customer submission (Pass 3b)
  product_not_visible: "This product is not available for review.",
  already_reviewed: "You have already reviewed this product.",
  invalid_rating: "Please choose a rating from 1 to 5.",
  invalid_author: "Please enter your name (up to 80 characters).",
  invalid_body: "Please write a review (up to 2000 characters).",
  internal_error: "Could not complete the change. Please try again.",
};

export const KNOWN_REVIEW_ERROR_CODES = new Set(Object.keys(REVIEW_ERROR_MESSAGES));

/** Map a review RPC error code to a safe, user-facing message. */
export function reviewErrorMessage(code: string | undefined | null): string {
  if (!code) return "An unknown error occurred.";
  return REVIEW_ERROR_MESSAGES[code] ?? "Could not complete the change. Please try again.";
}

// ---- Product gallery (Pass 3f) ----------------------------------------------

/** One image in a product's gallery; URLs come from the media library. */
export const productGalleryItemSchema = z.object({
  url: z.string().min(1).max(1000),
  alt: z.string().max(300).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

/** A product's full gallery: at most 12 images, at most one primary. */
export const productGallerySchema = z
  .array(productGalleryItemSchema)
  .max(12)
  .refine((items) => items.filter((i) => i.isPrimary).length <= 1, {
    message: "Only one image can be primary.",
  });

export const productGallerySaveSchema = z.object({
  code: z.string().min(1).max(64),
  items: productGallerySchema,
});

export type ProductGalleryItem = z.infer<typeof productGalleryItemSchema>;

/** Stable codes raised by api.set_product_media (snake_case == error.message). */
export const GALLERY_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  product_not_found: "That product no longer exists. Refresh and try again.",
  invalid_gallery: "The gallery is invalid. Check the images and try again.",
  invalid_media: "Each image must come from the media library.",
  internal_error: "Could not save the gallery. Please try again.",
};

export const KNOWN_GALLERY_ERROR_CODES = new Set(Object.keys(GALLERY_ERROR_MESSAGES));

export function galleryErrorMessage(code: string): string {
  return GALLERY_ERROR_MESSAGES[code] ?? GALLERY_ERROR_MESSAGES.internal_error;
}
