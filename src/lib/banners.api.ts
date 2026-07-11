/**
 * Homepage banners API — createServerFn handlers.
 *
 *   - getActiveBanners   → storefront hero (anon; cached public read; [] on failure)
 *   - loadBanners        → admin list (requires `content.manage`)
 *   - saveBanner         → create/edit via guardAdminWrite (CSRF + permission +
 *                          MFA step-up + rate limit + denial audit)
 *   - setBannerActiveFn  → enable/disable via guardAdminWrite
 *   - deleteBannerFn     → delete via guardAdminWrite
 *   - listMediaForBanners→ media-library assets for the banner image picker
 *
 * The canonical banner.* audit rows are written SQL-side by the api.*_banner
 * RPCs. Server-only modules are imported INSIDE handler closures so they never
 * enter the client bundle (same pattern as coupons.api.ts / settings.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { bannerInputSchema, setBannerActiveSchema, bannerIdArgSchema } from "@/lib/banners-shared";

async function messageFromBannerError(e: unknown): Promise<string> {
  const { BannerAdminError } = await import("@/lib/server/banners.server");
  const { bannerErrorMessage } = await import("@/lib/banners-shared");
  return bannerErrorMessage(e instanceof BannerAdminError ? e.code : undefined);
}

export const getActiveBanners = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchActiveBanners } = await import("@/lib/server/banners.server");
  return fetchActiveBanners();
});

export const loadBanners = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("content.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", banners: [] };
  const repo = await import("@/lib/server/banners.server");
  try {
    return { success: true as const, banners: await repo.listBanners(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load banners.", banners: [] };
  }
});

export const saveBanner = createServerFn({ method: "POST" })
  .validator(bannerInputSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("content.manage", "saveBanner");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/banners.server");
    try {
      const result = await repo.upsertBanner(data, g.actorId);
      return { success: true as const, ...result };
    } catch (e) {
      return { success: false as const, error: await messageFromBannerError(e) };
    }
  });

export const setBannerActiveFn = createServerFn({ method: "POST" })
  .validator(setBannerActiveSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("content.manage", "setBannerActive");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/banners.server");
    try {
      const banner = await repo.setBannerActive(data.id, data.active, g.actorId);
      return { success: true as const, banner };
    } catch (e) {
      return { success: false as const, error: await messageFromBannerError(e) };
    }
  });

export const deleteBannerFn = createServerFn({ method: "POST" })
  .validator(bannerIdArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("content.manage", "deleteBanner");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/banners.server");
    try {
      await repo.deleteBanner(data.id, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromBannerError(e) };
    }
  });

/** Media-library assets for the banner editor's image picker. */
export const listMediaForBanners = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("content.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", media: [] };
  const { listMedia } = await import("@/lib/server/media.server");
  try {
    return { success: true as const, media: await listMedia(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load media.", media: [] };
  }
});
