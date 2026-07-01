/**
 * Admin coupons API — createServerFn handlers for admin.coupons.tsx.
 *
 *   - loadCoupons     → admin read (requires `coupons.manage`)
 *   - saveCoupon      → create/edit via guardAdminWrite (CSRF + permission +
 *                       MFA step-up + rate limit + denial audit)
 *   - setCouponActive → enable/disable via guardAdminWrite
 *   - deleteCoupon    → delete (unused only) via guardAdminWrite
 *
 * The canonical coupon.* audit rows are written SQL-side by the api.*_coupon
 * RPCs. Server-only modules are imported INSIDE handler closures so they never
 * enter the client bundle (same pattern as settings.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import {
  couponInputSchema,
  setCouponActiveSchema,
  couponCodeArgSchema,
} from "@/lib/coupons-shared";

async function messageFromCouponError(e: unknown): Promise<string> {
  const { CouponAdminError } = await import("@/lib/server/coupons.server");
  const { couponAdminErrorMessage } = await import("@/lib/coupons-shared");
  return couponAdminErrorMessage(e instanceof CouponAdminError ? e.code : undefined);
}

export const loadCoupons = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("coupons.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", coupons: [] };
  const repo = await import("@/lib/server/coupons.server");
  try {
    return { success: true as const, coupons: await repo.listCoupons(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load coupons.", coupons: [] };
  }
});

export const saveCoupon = createServerFn({ method: "POST" })
  .validator(couponInputSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("coupons.manage", "saveCoupon");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/coupons.server");
    try {
      const result = await repo.upsertCoupon(data, g.actorId);
      return { success: true as const, ...result };
    } catch (e) {
      return { success: false as const, error: await messageFromCouponError(e) };
    }
  });

export const setCouponActive = createServerFn({ method: "POST" })
  .validator(setCouponActiveSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("coupons.manage", "setCouponActive");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/coupons.server");
    try {
      const coupon = await repo.setCouponActive(data.code, data.active, g.actorId);
      return { success: true as const, coupon };
    } catch (e) {
      return { success: false as const, error: await messageFromCouponError(e) };
    }
  });

export const deleteCoupon = createServerFn({ method: "POST" })
  .validator(couponCodeArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("coupons.manage", "deleteCoupon");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/coupons.server");
    try {
      await repo.deleteCoupon(data.code, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromCouponError(e) };
    }
  });
