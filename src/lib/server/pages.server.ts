/**
 * Site pages (policies CMS) repository — SERVER ONLY.
 *
 * Admin calls use the SERVICE-ROLE client because the staff api.*_site_page*
 * RPCs are REVOKE-d from anon/authenticated; the server fn (pages.api.ts) has
 * already enforced CSRF + `policies.manage` + MFA step-up + rate limit via
 * guardAdminWrite. The RPCs re-check active-staff and write the canonical
 * page.* audit rows. Errors are re-thrown as PageAdminError with a STABLE
 * code; raw SQL never reaches the client.
 *
 * The public storefront read uses the per-request ANON client behind the
 * shared public TTL cache — one key per slug, same guarantee as settings.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { cachedPublic } from "./public-cache.server";
import {
  CMS_PAGE_SLUGS,
  KNOWN_PAGE_ERROR_CODES,
  toPublicSitePage,
  type AdminSitePage,
  type AdminSitePageSummary,
  type CmsPageSlug,
  type PageDraftInput,
  type PublicSitePage,
  type SitePageRevision,
} from "@/lib/pages-shared";

export class PageAdminError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PageAdminError";
  }
}

function throwPageError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  if (error.code === "23514" || error.code === "23502") throw new PageAdminError("invalid_page");
  throw new PageAdminError(KNOWN_PAGE_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/** Published page for the storefront. Null on failure/unknown slug (→ static fallback). */
async function loadPublicSitePage(slug: CmsPageSlug): Promise<PublicSitePage | null> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("get_site_page", { p_slug: slug });
  if (error) return null;
  return toPublicSitePage(data);
}

/** Per-slug cached wrappers — public pages change rarely; admin edits show within the TTL. */
const cachedPageReaders = Object.fromEntries(
  CMS_PAGE_SLUGS.map((slug) => [
    slug,
    cachedPublic(`public-page-${slug}`, 60_000, () => loadPublicSitePage(slug)),
  ]),
) as Record<CmsPageSlug, () => Promise<PublicSitePage | null>>;

export function fetchPublicSitePage(slug: CmsPageSlug): Promise<PublicSitePage | null> {
  return cachedPageReaders[slug]();
}

/** All CMS pages for the admin list (no bodies). */
export async function listSitePages(actorId: string): Promise<AdminSitePageSummary[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_site_pages", { p_actor: actorId });
  if (error) throwPageError(error);
  return (data ?? []) as AdminSitePageSummary[];
}

/** Full page row incl. draft for the editor. */
export async function getSitePageAdmin(slug: string, actorId: string): Promise<AdminSitePage> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("get_site_page_admin", { p_actor: actorId, p_slug: slug });
  if (error) throwPageError(error);
  return data as AdminSitePage;
}

/** Save/replace the draft working copy. */
export async function saveSitePageDraft(input: PageDraftInput, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { slug, ...draft } = input;
  const { error } = await admin
    .schema("api")
    .rpc("save_site_page_draft", { p_actor: actorId, p_slug: slug, p_draft: draft });
  if (error) throwPageError(error);
}

/** Publish the draft (writes a revision, prunes to 20). */
export async function publishSitePage(slug: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("publish_site_page", { p_actor: actorId, p_slug: slug });
  if (error) throwPageError(error);
}

/** Drop the draft working copy. */
export async function discardSitePageDraft(slug: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("discard_site_page_draft", { p_actor: actorId, p_slug: slug });
  if (error) throwPageError(error);
}

/** Revision history (≤20, newest first, incl. bodies). */
export async function listSitePageRevisions(
  slug: string,
  actorId: string,
): Promise<SitePageRevision[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("list_site_page_revisions", { p_actor: actorId, p_slug: slug });
  if (error) throwPageError(error);
  return (data ?? []) as SitePageRevision[];
}

/** Load a revision into the draft (publish separately to go live). */
export async function restoreSitePageRevision(
  slug: string,
  revisionId: number,
  actorId: string,
): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("restore_site_page_revision", {
    p_actor: actorId,
    p_slug: slug,
    p_revision_id: revisionId,
  });
  if (error) throwPageError(error);
}
