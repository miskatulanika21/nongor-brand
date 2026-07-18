/**
 * Founder profile (CMS) API — createServerFn handlers.
 *
 *   - getFounderProfile        → storefront /founder (anon; cached public read;
 *                                null on failure → built-in fallback copy)
 *   - loadFounderAdmin         → owner editor (full row incl. draft)
 *   - saveFounderDraftFn       → draft save via guardAdminWrite (CSRF +
 *                                permission + MFA step-up + rate limit +
 *                                denial audit)
 *   - publishFounderFn         → draft → live (+ revision)
 *   - discardFounderDraftFn / loadFounderRevisions / restoreFounderRevisionFn
 *   - listMediaForFounder      → media-library assets for the image pickers
 *
 * Every handler gates on `founder.manage`, which ONLY the owner role holds
 * (see permissions.ts) — the founder page is personal, brand-identity content.
 * The RPCs re-check `role = 'owner'` SQL-side and write the canonical founder.*
 * audit rows. Server-only modules are imported INSIDE handler closures so they
 * never enter the client bundle (same pattern as pages.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { founderDraftSchema, founderRevisionArgSchema } from "@/lib/founder-shared";

async function messageFromFounderError(e: unknown): Promise<string> {
  const { FounderAdminError } = await import("@/lib/server/founder.server");
  const { founderErrorMessage } = await import("@/lib/founder-shared");
  return founderErrorMessage(e instanceof FounderAdminError ? e.code : undefined);
}

export const getFounderProfile = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchPublicFounderContent } = await import("@/lib/server/founder.server");
  return fetchPublicFounderContent();
});

export const loadFounderAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("founder.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", profile: null };
  const repo = await import("@/lib/server/founder.server");
  try {
    return {
      success: true as const,
      profile: await repo.getFounderProfileAdmin(authz.identity.userId),
    };
  } catch (e) {
    return { success: false as const, error: await messageFromFounderError(e), profile: null };
  }
});

export const saveFounderDraftFn = createServerFn({ method: "POST" })
  .validator(founderDraftSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("founder.manage", "saveFounderDraft");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/founder.server");
    try {
      await repo.saveFounderDraft(data.content, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromFounderError(e) };
    }
  });

export const publishFounderFn = createServerFn({ method: "POST" }).handler(async () => {
  const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
  const g = await guardAdminWrite("founder.manage", "publishFounderProfile");
  if (!g.ok) return { success: false as const, error: g.error };
  const repo = await import("@/lib/server/founder.server");
  try {
    await repo.publishFounderProfile(g.actorId);
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: await messageFromFounderError(e) };
  }
});

export const discardFounderDraftFn = createServerFn({ method: "POST" }).handler(async () => {
  const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
  const g = await guardAdminWrite("founder.manage", "discardFounderDraft");
  if (!g.ok) return { success: false as const, error: g.error };
  const repo = await import("@/lib/server/founder.server");
  try {
    await repo.discardFounderDraft(g.actorId);
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: await messageFromFounderError(e) };
  }
});

export const loadFounderRevisions = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("founder.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", revisions: [] };
  const repo = await import("@/lib/server/founder.server");
  try {
    return {
      success: true as const,
      revisions: await repo.listFounderRevisions(authz.identity.userId),
    };
  } catch (e) {
    return { success: false as const, error: await messageFromFounderError(e), revisions: [] };
  }
});

export const restoreFounderRevisionFn = createServerFn({ method: "POST" })
  .validator(founderRevisionArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("founder.manage", "restoreFounderRevision");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/founder.server");
    try {
      await repo.restoreFounderRevision(data.revisionId, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromFounderError(e) };
    }
  });

export const listMediaForFounder = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("founder.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", media: [] };
  const { listMedia } = await import("@/lib/server/media.server");
  try {
    return { success: true as const, media: await listMedia(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load media.", media: [] };
  }
});
