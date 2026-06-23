/**
 * Catalog admin API — createServerFn handlers for the admin product/category
 * write path. Reads require `products.view`; writes go through guardAdminWrite
 * (CSRF + strict permission + MFA step-up + rate limit + denial audit) and emit
 * a best-effort audit event on success.
 *
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as catalog.api.ts / staff.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  productInputSchema,
  categoryInputSchema,
  categoryReorderSchema,
  PRODUCT_STATUSES,
  slugSchema,
} from "@/lib/catalog-admin.schema";

// ---- Reads ------------------------------------------------------------------

export const listAdminProducts = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("products.view");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", products: [] };
  const { fetchAdminProducts } = await import("@/lib/server/catalog-admin.server");
  try {
    return { success: true as const, products: await fetchAdminProducts() };
  } catch {
    return { success: false as const, error: "Could not load products.", products: [] };
  }
});

export const listAdminCategories = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("products.view");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", categories: [] };
  const { fetchAdminCategories } = await import("@/lib/server/catalog-admin.server");
  try {
    return { success: true as const, categories: await fetchAdminCategories() };
  } catch {
    return { success: false as const, error: "Could not load categories.", categories: [] };
  }
});

export const getAdminProduct = createServerFn({ method: "GET" })
  .validator(z.object({ code: z.string().trim().min(1).max(64) }))
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("products.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", product: null };
    const { fetchAdminProductDetail } = await import("@/lib/server/catalog-admin.server");
    try {
      const product = await fetchAdminProductDetail(data.code);
      if (!product) return { success: false as const, error: "Product not found.", product: null };
      return { success: true as const, product };
    } catch {
      return { success: false as const, error: "Could not load product.", product: null };
    }
  });

// ---- Error mapping ----------------------------------------------------------

async function messageFromError(e: unknown): Promise<string> {
  const { CatalogAdminError } = await import("@/lib/server/catalog-admin.server");
  if (e instanceof CatalogAdminError) {
    switch (e.code) {
      case "unknown_category":
        return "The selected category was not found.";
      case "duplicate":
        return "That slug is already in use. Choose a unique slug.";
      case "in_use":
        return "This item is referenced by other records and cannot be removed.";
      case "not_found":
        return "That item no longer exists. Refresh and try again.";
      case "constraint":
        return "Some values are invalid. Check pricing and stock and try again.";
      default:
        return "Could not complete the change. Please try again.";
    }
  }
  return "Could not complete the change. Please try again.";
}

// ---- Product writes ---------------------------------------------------------

export const saveProduct = createServerFn({ method: "POST" })
  .validator(
    z.object({
      mode: z.enum(["create", "update"]),
      code: z.string().trim().min(1).max(64).optional(), // required for update
      product: productInputSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("products.manage", "saveProduct");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      const saved =
        data.mode === "create"
          ? await repo.createProduct(data.product)
          : await repo.updateProduct(requireCode(data.code), data.product);
      await writeAudit({
        action: data.mode === "create" ? "product.created" : "product.updated",
        actorId: g.actorId,
        targetType: "products",
        targetId: saved.code,
        metadata: { slug: saved.slug, status: data.product.status },
      });
      return { success: true as const, product: saved };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

export const setProductStatus = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().trim().min(1).max(64), status: z.enum(PRODUCT_STATUSES) }))
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("products.manage", "setProductStatus");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      await repo.setProductStatus(data.code, data.status);
      await writeAudit({
        action: "product.status_changed",
        actorId: g.actorId,
        targetType: "products",
        targetId: data.code,
        metadata: { status: data.status },
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().trim().min(1).max(64) }))
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("products.manage", "deleteProduct");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      await repo.deleteProduct(data.code);
      await writeAudit({
        action: "product.deleted",
        actorId: g.actorId,
        targetType: "products",
        targetId: data.code,
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

// ---- Category writes --------------------------------------------------------

export const saveCategory = createServerFn({ method: "POST" })
  .validator(
    z.object({
      mode: z.enum(["create", "update"]),
      slug: slugSchema.optional(), // original slug, required for update
      category: categoryInputSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("categories.manage", "saveCategory");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      if (data.mode === "create") await repo.createCategory(data.category);
      else await repo.updateCategory(requireSlug(data.slug), data.category);
      await writeAudit({
        action: data.mode === "create" ? "category.created" : "category.updated",
        actorId: g.actorId,
        targetType: "product_categories",
        targetId: data.category.slug,
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

export const setCategoryActive = createServerFn({ method: "POST" })
  .validator(z.object({ slug: slugSchema, active: z.boolean() }))
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("categories.manage", "setCategoryActive");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      await repo.setCategoryActive(data.slug, data.active);
      await writeAudit({
        action: "category.status_changed",
        actorId: g.actorId,
        targetType: "product_categories",
        targetId: data.slug,
        metadata: { isActive: data.active },
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

export const reorderCategories = createServerFn({ method: "POST" })
  .validator(z.object({ items: categoryReorderSchema }))
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("categories.manage", "reorderCategories");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      await repo.reorderCategories(data.items);
      await writeAudit({
        action: "category.reordered",
        actorId: g.actorId,
        targetType: "product_categories",
        metadata: { count: data.items.length },
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .validator(z.object({ slug: slugSchema }))
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("categories.manage", "deleteCategory");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    try {
      await repo.deleteCategory(data.slug);
      await writeAudit({
        action: "category.deleted",
        actorId: g.actorId,
        targetType: "product_categories",
        targetId: data.slug,
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

// ---- Inventory --------------------------------------------------------------

export const listInventory = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("inventory.view");
  if (!authz.ok)
    return { success: false as const, error: "Not authorized.", items: [], movements: [] };
  const repo = await import("@/lib/server/catalog-admin.server");
  try {
    const [items, movements] = await Promise.all([
      repo.fetchInventoryList(),
      repo.fetchRecentMovements(),
    ]);
    return { success: true as const, items, movements };
  } catch {
    return {
      success: false as const,
      error: "Could not load inventory.",
      items: [],
      movements: [],
    };
  }
});

export const adjustInventory = createServerFn({ method: "POST" })
  .validator(
    z.object({
      code: z.string().trim().min(1).max(64),
      size: z.string().trim().min(1).max(40).nullable(),
      quantity: z.number().int().nonnegative(),
      reason: z.string().trim().min(1).max(120),
      note: z.string().trim().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("inventory.manage", "adjustInventory");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/catalog-admin.server");
    // Canonical audit (inventory.adjusted) is written inside api.set_inventory
    // in the same transaction as the movement + stock change.
    try {
      const res = await repo.adjustInventory({
        code: data.code,
        size: data.size,
        quantity: data.quantity,
        reason: data.reason,
        note: data.note ?? null,
        actorId: g.actorId,
      });
      return { success: true as const, total: res.total };
    } catch (e) {
      return { success: false as const, error: await messageFromError(e) };
    }
  });

// ---- helpers ----------------------------------------------------------------

function requireCode(code: string | undefined): string {
  if (!code) throw new Error("Missing product code for update.");
  return code;
}
function requireSlug(slug: string | undefined): string {
  if (!slug) throw new Error("Missing category slug for update.");
  return slug;
}
