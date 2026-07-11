/**
 * Site pages (policies CMS) API — createServerFn handlers.
 *
 *   - getSitePage          → storefront policy routes (anon; per-slug cached
 *                            public read; null on failure → static fallback)
 *   - loadSitePages        → admin list (requires `policies.manage`)
 *   - loadSitePageAdmin    → editor (full row incl. draft)
 *   - saveSitePageDraftFn  → draft save via guardAdminWrite (CSRF + permission
 *                            + MFA step-up + rate limit + denial audit)
 *   - publishSitePageFn    → draft → live (+ revision) via guardAdminWrite
 *   - discardSitePageDraftFn / restoreSitePageRevisionFn / loadSitePageRevisions
 *
 * The canonical page.* audit rows are written SQL-side by the api.* RPCs.
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as banners.api.ts / coupons.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { pageSlugArgSchema, pageDraftSchema, pageRevisionArgSchema } from "@/lib/pages-shared";

async function messageFromPageError(e: unknown): Promise<string> {
  const { PageAdminError } = await import("@/lib/server/pages.server");
  const { pageErrorMessage } = await import("@/lib/pages-shared");
  return pageErrorMessage(e instanceof PageAdminError ? e.code : undefined);
}

export const getSitePage = createServerFn({ method: "GET" })
  .validator(pageSlugArgSchema)
  .handler(async ({ data }) => {
    const { fetchPublicSitePage } = await import("@/lib/server/pages.server");
    return fetchPublicSitePage(data.slug);
  });

export const loadSitePages = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("policies.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", pages: [] };
  const repo = await import("@/lib/server/pages.server");
  try {
    return { success: true as const, pages: await repo.listSitePages(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load pages.", pages: [] };
  }
});

export const loadSitePageAdmin = createServerFn({ method: "GET" })
  .validator(pageSlugArgSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("policies.manage");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", page: null };
    const repo = await import("@/lib/server/pages.server");
    try {
      return {
        success: true as const,
        page: await repo.getSitePageAdmin(data.slug, authz.identity.userId),
      };
    } catch (e) {
      return { success: false as const, error: await messageFromPageError(e), page: null };
    }
  });

export const saveSitePageDraftFn = createServerFn({ method: "POST" })
  .validator(pageDraftSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("policies.manage", "saveSitePageDraft");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/pages.server");
    try {
      await repo.saveSitePageDraft(data, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromPageError(e) };
    }
  });

export const publishSitePageFn = createServerFn({ method: "POST" })
  .validator(pageSlugArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("policies.manage", "publishSitePage");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/pages.server");
    try {
      await repo.publishSitePage(data.slug, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromPageError(e) };
    }
  });

export const discardSitePageDraftFn = createServerFn({ method: "POST" })
  .validator(pageSlugArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("policies.manage", "discardSitePageDraft");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/pages.server");
    try {
      await repo.discardSitePageDraft(data.slug, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromPageError(e) };
    }
  });

export const loadSitePageRevisions = createServerFn({ method: "GET" })
  .validator(pageSlugArgSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("policies.manage");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", revisions: [] };
    const repo = await import("@/lib/server/pages.server");
    try {
      return {
        success: true as const,
        revisions: await repo.listSitePageRevisions(data.slug, authz.identity.userId),
      };
    } catch (e) {
      return { success: false as const, error: await messageFromPageError(e), revisions: [] };
    }
  });

export const restoreSitePageRevisionFn = createServerFn({ method: "POST" })
  .validator(pageRevisionArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("policies.manage", "restoreSitePageRevision");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/pages.server");
    try {
      await repo.restoreSitePageRevision(data.slug, data.revisionId, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromPageError(e) };
    }
  });
