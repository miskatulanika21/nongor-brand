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
