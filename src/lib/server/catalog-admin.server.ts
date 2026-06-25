/**
 * Catalog ADMIN repository — SERVER ONLY. Uses the service-role client, so it
 * sees and writes EVERY product/category regardless of status or RLS (drafts,
 * hidden, archived included). Authorization is enforced upstream in the API
 * handlers (guardAdminWrite); this layer assumes the caller is already verified.
 *
 * Mutations are intentionally small and explicit. Errors are thrown as
 * CatalogAdminError with a stable `code` so the API layer can map them to safe,
 * user-facing messages (unique slug, unknown category, category in use, …).
 */
import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import type {
  ProductInput,
  CategoryInput,
  CategoryReorder,
  ProductStatus,
} from "@/lib/catalog-admin.schema";
import { KNOWN_INVENTORY_ERROR_CODES } from "@/lib/catalog-admin.schema";

// Re-export the isomorphic mapper so existing server-side importers keep working;
// the canonical definition now lives in the (client-safe) schema module so the
// admin UI can translate per-item bulk failures too.
export { inventoryErrorMessage } from "@/lib/catalog-admin.schema";

/**
 * Stable, immutable, opaque product code (the storefront/cart id). Generated
 * independently of the mutable SEO slug so the slug can change freely without
 * breaking carts/wishlists, and always within the 64-char code bound.
 */
function generateProductCode(): string {
  return `prd_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export type CatalogAdminErrorCode =
  | "unknown_category"
  | "duplicate"
  | "in_use"
  | "not_found"
  | "constraint"
  | "query_failed";

export class CatalogAdminError extends Error {
  constructor(
    public readonly code: CatalogAdminErrorCode,
    message: string,
    public readonly cause?: string,
  ) {
    super(message);
    this.name = "CatalogAdminError";
  }
}

// ---- Admin DTOs -------------------------------------------------------------

export interface AdminProductListItem {
  code: string;
  slug: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  price: number;
  salePrice: number | null;
  stock: number;
  status: ProductStatus;
  rating: number;
  reviewCount: number;
  isNew: boolean;
  isHandmade: boolean;
  isBestSeller: boolean;
  customSize: boolean;
  image: string | null;
}

export interface AdminCategory {
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

// ---- Internal row shapes ----------------------------------------------------

interface AdminProductRow {
  code: string;
  slug: string;
  name: string;
  price: number;
  sale_price: number | null;
  stock: number;
  status: string;
  rating: number;
  review_count: number;
  is_new: boolean;
  is_handmade: boolean;
  is_best_seller: boolean;
  custom_size: boolean;
  category: { slug: string; name: string } | null;
  media: Array<{ url: string; is_primary: boolean; sort_order: number }> | null;
}

const ADMIN_PRODUCT_SELECT = `
  code, slug, name, price, sale_price, stock, status, rating, review_count,
  is_new, is_handmade, is_best_seller, custom_size,
  category:product_categories ( slug, name ),
  media:product_media ( url, is_primary, sort_order )
`;

function primaryImage(media: AdminProductRow["media"]): string | null {
  const list = media ?? [];
  if (list.length === 0) return null;
  const primary = list.find((m) => m.is_primary);
  if (primary) return primary.url;
  return [...list].sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null;
}

// ---- Reads ------------------------------------------------------------------

/** Every product (any status), shaped for the admin list. */
export async function fetchAdminProducts(): Promise<AdminProductListItem[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("products")
    .select(ADMIN_PRODUCT_SELECT)
    .order("sort_order", { ascending: true });
  if (error) throw new CatalogAdminError("query_failed", "Failed to load products", error.message);

  return ((data ?? []) as unknown as AdminProductRow[]).map((r) => ({
    code: r.code,
    slug: r.slug,
    name: r.name,
    categorySlug: r.category?.slug ?? "",
    categoryName: r.category?.name ?? "",
    price: r.price,
    salePrice: r.sale_price,
    stock: r.stock,
    status: r.status as ProductStatus,
    rating: r.rating,
    reviewCount: r.review_count,
    isNew: r.is_new,
    isHandmade: r.is_handmade,
    isBestSeller: r.is_best_seller,
    customSize: r.custom_size,
    image: primaryImage(r.media),
  }));
}

/** Full editable detail for one product (any status), keyed by stable code. */
export interface AdminProductDetail extends ProductInput {
  code: string;
}

interface AdminProductDetailRow {
  code: string;
  slug: string;
  name: string;
  status: string;
  price: number;
  sale_price: number | null;
  stock: number;
  custom_size: boolean;
  custom_size_charge: number | null;
  is_new: boolean;
  is_handmade: boolean;
  is_best_seller: boolean;
  has_video: boolean;
  description: string;
  color: string | null;
  colors: string[] | null;
  fabric: string | null;
  occasion: string | null;
  care: string | null;
  length: string | null;
  work_type: string | null;
  pieces_included: string | null;
  shade: string | null;
  volume: string | null;
  skin_type: string | null;
  expiry: string | null;
  batch: string | null;
  ingredients: string | null;
  how_to_use: string | null;
  safety: string | null;
  blouse_piece: boolean | null;
  stitched: boolean | null;
  category: { slug: string } | null;
}

const ADMIN_DETAIL_SELECT = `
  code, slug, name, status, price, sale_price, stock, custom_size, custom_size_charge,
  is_new, is_handmade, is_best_seller, has_video, description,
  color, colors, fabric, occasion, care, length, work_type, pieces_included,
  shade, volume, skin_type, expiry, batch, ingredients, how_to_use, safety,
  blouse_piece, stitched,
  category:product_categories ( slug )
`;

const und = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export async function fetchAdminProductDetail(code: string): Promise<AdminProductDetail | null> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("products")
    .select(ADMIN_DETAIL_SELECT)
    .eq("code", code)
    .maybeSingle();
  if (error) throw new CatalogAdminError("query_failed", "Failed to load product", error.message);
  if (!data) return null;
  const r = data as unknown as AdminProductDetailRow;
  return {
    code: r.code,
    slug: r.slug,
    name: r.name,
    categorySlug: r.category?.slug ?? "",
    status: r.status as ProductStatus,
    price: r.price,
    salePrice: r.sale_price,
    stock: r.stock,
    customSize: r.custom_size,
    customSizeCharge: r.custom_size_charge,
    isNew: r.is_new,
    isHandmade: r.is_handmade,
    isBestSeller: r.is_best_seller,
    hasVideo: r.has_video,
    description: r.description,
    color: und(r.color),
    colors: und(r.colors),
    fabric: und(r.fabric),
    occasion: und(r.occasion),
    care: und(r.care),
    length: und(r.length),
    workType: und(r.work_type),
    piecesIncluded: und(r.pieces_included),
    shade: und(r.shade),
    volume: und(r.volume),
    skinType: und(r.skin_type),
    expiry: und(r.expiry),
    batch: und(r.batch),
    ingredients: und(r.ingredients),
    howToUse: und(r.how_to_use),
    safety: und(r.safety),
    blousePiece: r.blouse_piece,
    stitched: r.stitched,
  };
}

/** Every category (active or not), ordered for admin display. */
export async function fetchAdminCategories(): Promise<AdminCategory[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("product_categories")
    .select("slug, name, sort_order, is_active, products(count)")
    .order("sort_order", { ascending: true });
  if (error)
    throw new CatalogAdminError("query_failed", "Failed to load categories", error.message);
  type CategoryCountRow = {
    slug: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    products: Array<{ count: number }> | null;
  };
  return ((data ?? []) as unknown as CategoryCountRow[]).map((c) => ({
    slug: c.slug,
    name: c.name,
    sortOrder: c.sort_order,
    isActive: c.is_active,
    productCount: c.products?.[0]?.count ?? 0,
  }));
}

// ---- Inventory --------------------------------------------------------------

export interface InventorySize {
  size: string;
  quantity: number;
}

export interface InventoryItem {
  code: string;
  name: string;
  image: string | null;
  categoryName: string;
  status: ProductStatus;
  stock: number;
  sizes: InventorySize[];
}

interface InventoryRow {
  code: string;
  name: string;
  stock: number;
  status: string;
  category: { name: string } | null;
  media: Array<{ url: string; is_primary: boolean; sort_order: number }> | null;
  sizes: Array<{ size: string; quantity: number; sort_order: number }> | null;
}

const INVENTORY_SELECT = `
  code, name, stock, status,
  category:product_categories ( name ),
  media:product_media ( url, is_primary, sort_order ),
  sizes:product_size_stock ( size, quantity, sort_order )
`;

export async function fetchInventoryList(): Promise<InventoryItem[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("products")
    .select(INVENTORY_SELECT)
    .order("sort_order", { ascending: true });
  if (error) throw new CatalogAdminError("query_failed", "Failed to load inventory", error.message);
  return ((data ?? []) as unknown as InventoryRow[]).map((r) => ({
    code: r.code,
    name: r.name,
    image: primaryImage(r.media),
    categoryName: r.category?.name ?? "",
    status: r.status as ProductStatus,
    stock: r.stock,
    sizes: [...(r.sizes ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ size: s.size, quantity: s.quantity })),
  }));
}

export interface InventoryMovement {
  id: string;
  code: string;
  productName: string;
  size: string | null;
  previousQuantity: number;
  newQuantity: number;
  delta: number;
  reason: string;
  note: string | null;
  createdAt: string;
}

interface MovementRow {
  id: string;
  size: string | null;
  previous_quantity: number;
  new_quantity: number;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  product: { code: string; name: string } | null;
}

export async function fetchRecentMovements(limit = 50): Promise<InventoryMovement[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("product_inventory_movements")
    .select(
      "id, size, previous_quantity, new_quantity, delta, reason, note, created_at, product:products ( code, name )",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new CatalogAdminError("query_failed", "Failed to load history", error.message);
  return ((data ?? []) as unknown as MovementRow[]).map((m) => ({
    id: m.id,
    code: m.product?.code ?? "",
    productName: m.product?.name ?? "",
    size: m.size,
    previousQuantity: m.previous_quantity,
    newQuantity: m.new_quantity,
    delta: m.delta,
    reason: m.reason,
    note: m.note,
    createdAt: m.created_at,
  }));
}

export async function adjustInventory(params: {
  code: string;
  size: string | null;
  quantity: number;
  reason: string;
  note: string | null;
  actorId: string | null;
}): Promise<{ total: number }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("set_inventory", {
    p_code: params.code,
    p_size: params.size,
    p_quantity: params.quantity,
    p_reason: params.reason,
    p_note: params.note,
    p_actor_id: params.actorId,
  });
  if (error) throwInventoryError(error);
  const result = data as { total?: number } | null;
  return { total: result?.total ?? params.quantity };
}

export interface BulkInventoryItem {
  code: string;
  size: string | null;
  quantity: number;
  reason: string;
}

export interface BulkInventoryItemResult {
  productCode: string;
  size: string | null;
  success: boolean;
  errorCode?: string;
}

export interface BulkInventoryResult {
  operationKey: string;
  replayed: boolean;
  count: number;
  ok: number;
  failed: number;
  results: BulkInventoryItemResult[];
}

/**
 * Error thrown by the inventory RPC wrappers, carrying a STABLE machine code
 * (see INVENTORY_ERROR_MESSAGES). The API layer maps `.code` to a safe message
 * via inventoryErrorMessage — no raw SQL text ever reaches the client.
 */
export class InventoryError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "InventoryError";
  }
}

/**
 * Convert a PostgREST error from an inventory RPC into an InventoryError. The
 * RPCs raise the stable code AS the exception message; we accept it only if it
 * is a known code, otherwise collapse to `internal_error` so an unexpected raise
 * can never leak raw SQL context to the user.
 */
function throwInventoryError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new InventoryError(KNOWN_INVENTORY_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/**
 * One bounded, idempotent bulk adjustment. All integrity guards still apply
 * per item (each routes through api.set_inventory inside the RPC). `opKey`
 * makes retries safe — a replay returns the stored result without re-applying.
 * Idempotency is scoped by (actor_id, op_key) + canonical request hash.
 */
export async function bulkSetInventory(
  items: BulkInventoryItem[],
  actorId: string,
  opKey: string,
): Promise<BulkInventoryResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("bulk_set_inventory", {
    p_items: items,
    p_actor_id: actorId,
    p_op_key: opKey,
  });
  if (error) throwInventoryError(error);
  const raw = data as {
    op_key: string;
    replayed: boolean;
    count: number;
    ok: number;
    failed: number;
    results: Array<{
      code: string;
      size: string | null;
      ok: boolean;
      error_code?: string;
    }>;
  };
  return {
    operationKey: raw.op_key,
    replayed: raw.replayed ?? false,
    count: raw.count,
    ok: raw.ok,
    failed: raw.failed,
    results: (raw.results ?? []).map((r) => ({
      productCode: r.code,
      size: r.size,
      success: r.ok,
      errorCode: r.error_code,
    })),
  };
}

// ---- Variant management -----------------------------------------------------

export interface VariantResult {
  code: string;
  size: string;
  initial?: number;
  total?: number;
}

/** Add a size variant to a product. First-variant conserves existing stock. */
export async function addProductVariant(
  code: string,
  size: string,
  actorId: string,
): Promise<VariantResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("add_product_variant", {
    p_code: code,
    p_size: size,
    p_actor_id: actorId,
  });
  if (error) throwInventoryError(error);
  const r = data as { code: string; size: string; initial?: number };
  return { code: r.code, size: r.size, initial: r.initial };
}

/** Remove a zero-stock size variant from a product. */
export async function removeProductVariant(
  code: string,
  size: string,
  actorId: string,
): Promise<VariantResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("remove_product_variant", {
    p_code: code,
    p_size: size,
    p_actor_id: actorId,
  });
  if (error) throwInventoryError(error);
  const r = data as { code: string; size: string; total?: number };
  return { code: r.code, size: r.size, total: r.total };
}

// ---- Product writes ---------------------------------------------------------

type ProductWrite = {
  name: string;
  slug: string;
  status: ProductStatus;
  category_id: string;
  price: number;
  sale_price: number | null;
  // products.stock is owned by the inventory ledger (api.set_inventory) and a DB
  // trigger rejects direct writes — it is deliberately absent from this payload.
  custom_size: boolean;
  custom_size_charge: number | null;
  is_new: boolean;
  is_handmade: boolean;
  is_best_seller: boolean;
  has_video: boolean;
  description: string;
  color: string | null;
  colors: string[] | null;
  fabric: string | null;
  occasion: string | null;
  care: string | null;
  length: string | null;
  work_type: string | null;
  pieces_included: string | null;
  shade: string | null;
  volume: string | null;
  skin_type: string | null;
  expiry: string | null;
  batch: string | null;
  ingredients: string | null;
  how_to_use: string | null;
  safety: string | null;
  blouse_piece: boolean | null;
  stitched: boolean | null;
};

const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

async function resolveCategoryId(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  slug: string,
): Promise<string> {
  const { data, error } = await admin
    .from("product_categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new CatalogAdminError("query_failed", "Category lookup failed", error.message);
  if (!data) throw new CatalogAdminError("unknown_category", "Selected category was not found.");
  return data.id;
}

function buildProductWrite(input: ProductInput, categoryId: string): ProductWrite {
  return {
    name: input.name,
    slug: input.slug,
    status: input.status,
    category_id: categoryId,
    price: input.price,
    sale_price: input.salePrice ?? null,
    custom_size: input.customSize ?? false,
    custom_size_charge: input.customSizeCharge ?? null,
    is_new: input.isNew ?? false,
    is_handmade: input.isHandmade ?? false,
    is_best_seller: input.isBestSeller ?? false,
    has_video: input.hasVideo ?? false,
    description: input.description ?? "",
    color: orNull(input.color),
    colors: orNull(input.colors),
    fabric: orNull(input.fabric),
    occasion: orNull(input.occasion),
    care: orNull(input.care),
    length: orNull(input.length),
    work_type: orNull(input.workType),
    pieces_included: orNull(input.piecesIncluded),
    shade: orNull(input.shade),
    volume: orNull(input.volume),
    skin_type: orNull(input.skinType),
    expiry: orNull(input.expiry),
    batch: orNull(input.batch),
    ingredients: orNull(input.ingredients),
    how_to_use: orNull(input.howToUse),
    safety: orNull(input.safety),
    blouse_piece: orNull(input.blousePiece),
    stitched: orNull(input.stitched),
  };
}

/** Map a Postgres error to a stable CatalogAdminError. */
function fromPgError(error: { code?: string; message?: string }, fallbackMsg: string): never {
  const code = error.code;
  if (code === "23505") throw new CatalogAdminError("duplicate", "duplicate", error.message);
  if (code === "23503") throw new CatalogAdminError("in_use", "in_use", error.message);
  if (code === "23514") throw new CatalogAdminError("constraint", "constraint", error.message);
  throw new CatalogAdminError("query_failed", fallbackMsg, error.message);
}

export interface SavedProduct {
  code: string;
  slug: string;
}

/**
 * Create a new product through api.save_product (mutation + canonical
 * product.created audit in one transaction). `code` is an independent immutable
 * id; new products start at zero stock (set later via the inventory ledger).
 */
export async function createProduct(input: ProductInput, actorId: string): Promise<SavedProduct> {
  const admin = createAdminSupabaseClient();
  const categoryId = await resolveCategoryId(admin, input.categorySlug);
  const { data, error } = await admin.schema("api").rpc("save_product", {
    p_mode: "create",
    p_code: generateProductCode(),
    p_payload: buildProductWrite(input, categoryId),
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to create product");
  const r = data as { code: string; slug: string };
  return { code: r.code, slug: r.slug };
}

/** Update an existing product (by stable `code`) + canonical audit, one txn. */
export async function updateProduct(
  code: string,
  input: ProductInput,
  actorId: string,
): Promise<SavedProduct> {
  const admin = createAdminSupabaseClient();
  const categoryId = await resolveCategoryId(admin, input.categorySlug);
  const { data, error } = await admin.schema("api").rpc("save_product", {
    p_mode: "update",
    p_code: code,
    p_payload: buildProductWrite(input, categoryId),
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to update product");
  const r = data as { code: string; slug: string };
  return { code: r.code, slug: r.slug };
}

export async function setProductStatus(
  code: string,
  status: ProductStatus,
  actorId: string,
): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("set_product_status", {
    p_code: code,
    p_status: status,
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to update status");
}

// ---- Category writes (transactional canonical audit via api.* RPCs) ---------

export async function createCategory(input: CategoryInput, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("save_category", {
    p_mode: "create",
    p_orig_slug: null,
    p_slug: input.slug,
    p_name: input.name,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to create category");
}

export async function updateCategory(
  originalSlug: string,
  input: CategoryInput,
  actorId: string,
): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("save_category", {
    p_mode: "update",
    p_orig_slug: originalSlug,
    p_slug: input.slug,
    p_name: input.name,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to update category");
}

export async function setCategoryActive(
  slug: string,
  active: boolean,
  actorId: string,
): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("set_category_active", {
    p_slug: slug,
    p_active: active,
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to update category");
}

export async function reorderCategories(items: CategoryReorder, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("reorder_categories", {
    p_items: items,
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to reorder categories");
}

export async function deleteCategory(slug: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("delete_category", {
    p_slug: slug,
    p_actor_id: actorId,
  });
  if (error) fromPgError(error, "Failed to delete category");
}
