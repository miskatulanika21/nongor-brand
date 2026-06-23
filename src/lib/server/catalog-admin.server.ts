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
import { createAdminSupabaseClient } from "./supabase-admin.server";
import type {
  ProductInput,
  CategoryInput,
  CategoryReorder,
  ProductStatus,
} from "@/lib/catalog-admin.schema";

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

/** Every category (active or not), ordered for admin display. */
export async function fetchAdminCategories(): Promise<AdminCategory[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("product_categories")
    .select("slug, name, sort_order, is_active")
    .order("sort_order", { ascending: true });
  if (error)
    throw new CatalogAdminError("query_failed", "Failed to load categories", error.message);
  return (data ?? []).map((c) => ({
    slug: c.slug,
    name: c.name,
    sortOrder: c.sort_order,
    isActive: c.is_active,
  }));
}

// ---- Product writes ---------------------------------------------------------

type ProductWrite = {
  name: string;
  slug: string;
  status: ProductStatus;
  category_id: string;
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
    stock: input.stock,
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

/** Create a new product. `code` (the stable storefront id) defaults to the slug. */
export async function createProduct(input: ProductInput): Promise<SavedProduct> {
  const admin = createAdminSupabaseClient();
  const categoryId = await resolveCategoryId(admin, input.categorySlug);
  const { data, error } = await admin
    .from("products")
    .insert({ ...buildProductWrite(input, categoryId), code: input.slug })
    .select("code, slug")
    .single();
  if (error) fromPgError(error, "Failed to create product");
  return { code: data!.code, slug: data!.slug };
}

/** Update an existing product identified by its stable `code` (slug may change). */
export async function updateProduct(code: string, input: ProductInput): Promise<SavedProduct> {
  const admin = createAdminSupabaseClient();
  const categoryId = await resolveCategoryId(admin, input.categorySlug);
  const { data, error } = await admin
    .from("products")
    .update(buildProductWrite(input, categoryId))
    .eq("code", code)
    .select("code, slug")
    .maybeSingle();
  if (error) fromPgError(error, "Failed to update product");
  if (!data) throw new CatalogAdminError("not_found", "Product not found.");
  return { code: data.code, slug: data.slug };
}

export async function setProductStatus(code: string, status: ProductStatus): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("products")
    .update({ status })
    .eq("code", code)
    .select("code")
    .maybeSingle();
  if (error) fromPgError(error, "Failed to update status");
  if (!data) throw new CatalogAdminError("not_found", "Product not found.");
}

export async function deleteProduct(code: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("products").delete().eq("code", code);
  if (error) fromPgError(error, "Failed to delete product");
}

// ---- Category writes --------------------------------------------------------

export async function createCategory(input: CategoryInput): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("product_categories").insert({
    slug: input.slug,
    name: input.name,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  });
  if (error) fromPgError(error, "Failed to create category");
}

export async function updateCategory(originalSlug: string, input: CategoryInput): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("product_categories")
    .update({
      slug: input.slug,
      name: input.name,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .eq("slug", originalSlug)
    .select("slug")
    .maybeSingle();
  if (error) fromPgError(error, "Failed to update category");
  if (!data) throw new CatalogAdminError("not_found", "Category not found.");
}

export async function setCategoryActive(slug: string, active: boolean): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("product_categories")
    .update({ is_active: active })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();
  if (error) fromPgError(error, "Failed to update category");
  if (!data) throw new CatalogAdminError("not_found", "Category not found.");
}

export async function reorderCategories(items: CategoryReorder): Promise<void> {
  const admin = createAdminSupabaseClient();
  for (const item of items) {
    const { error } = await admin
      .from("product_categories")
      .update({ sort_order: item.sortOrder })
      .eq("slug", item.slug);
    if (error) fromPgError(error, "Failed to reorder categories");
  }
}

export async function deleteCategory(slug: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("product_categories").delete().eq("slug", slug);
  if (error) fromPgError(error, "Failed to delete category");
}
