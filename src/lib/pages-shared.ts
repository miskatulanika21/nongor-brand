/**
 * Site pages (policies CMS) — isomorphic types, input schema & error copy
 * shared by the admin editor, the storefront policy routes and the server fns.
 * NO server-only imports (safe in the client bundle). Mirrors the Stage-6 P4
 * RPCs (api.get_site_page / list_site_pages / get_site_page_admin /
 * save_site_page_draft / publish_site_page / discard_site_page_draft /
 * list_site_page_revisions / restore_site_page_revision) and `site_pages`.
 */
import { z } from "zod";

/** The fixed, code-registered set of CMS-editable page slugs (DB CHECK mirrors). */
export const CMS_PAGE_SLUGS = [
  "delivery-policy",
  "payment-policy",
  "cookie-policy",
  "authenticity-policy",
] as const;

export type CmsPageSlug = (typeof CMS_PAGE_SLUGS)[number];

export function isCmsPageSlug(value: string): value is CmsPageSlug {
  return (CMS_PAGE_SLUGS as readonly string[]).includes(value);
}

/** Published page content as served to the storefront (api.get_site_page). */
export interface PublicSitePage {
  slug: string;
  eyebrow: string | null;
  title: string;
  description: string | null;
  bodyMd: string;
}

/** Draft working copy (site_pages.draft). */
export interface SitePageDraft {
  eyebrow: string | null;
  title: string;
  description: string | null;
  body_md: string;
}

/** Admin list row (api.list_site_pages — no bodies). */
export interface AdminSitePageSummary {
  slug: string;
  title: string;
  eyebrow: string | null;
  has_draft: boolean;
  published_at: string;
  updated_at: string;
  revision_count: number;
}

/** Full admin row (api.get_site_page_admin). */
export interface AdminSitePage {
  slug: string;
  eyebrow: string | null;
  title: string;
  description: string | null;
  body_md: string;
  draft: SitePageDraft | null;
  published_at: string;
  updated_at: string;
}

/** One revision (api.list_site_page_revisions). */
export interface SitePageRevision {
  id: number;
  eyebrow: string | null;
  title: string;
  description: string | null;
  body_md: string;
  published_at: string;
  published_by_email: string | null;
}

// ── Input validation (mirrors the RPC bounds; server re-validates) ───────────

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(max).nullable(),
    )
    .nullable()
    .optional();

export const pageSlugArgSchema = z.object({
  slug: z.enum(CMS_PAGE_SLUGS),
});

export const pageDraftSchema = z.object({
  slug: z.enum(CMS_PAGE_SLUGS),
  eyebrow: optionalText(80),
  title: z.string().trim().min(1, "A title is required.").max(160),
  description: optionalText(300),
  body_md: z.string().min(1, "The page needs some content.").max(100000),
});

export type PageDraftInput = z.infer<typeof pageDraftSchema>;

export const pageRevisionArgSchema = z.object({
  slug: z.enum(CMS_PAGE_SLUGS),
  revisionId: z.coerce.number().int().positive(),
});

// ── Error copy (stable snake_case codes from the RPCs) ───────────────────────

export const PAGE_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  page_not_found: "That page is not CMS-editable.",
  revision_not_found: "That revision no longer exists.",
  no_draft_to_publish: "There is no draft to publish — save your changes first.",
  invalid_page: "Some page values are out of bounds. Check the fields and try again.",
  internal_error: "Could not save the page. Please try again.",
};

export const KNOWN_PAGE_ERROR_CODES = new Set(Object.keys(PAGE_ERROR_MESSAGES));

export function pageErrorMessage(code: string | null | undefined): string {
  if (!code) return PAGE_ERROR_MESSAGES.internal_error;
  return PAGE_ERROR_MESSAGES[code] ?? PAGE_ERROR_MESSAGES.internal_error;
}

// ── Public payload mapping (snake → camel, drops bad payloads) ───────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Coerce an api.get_site_page payload into a PublicSitePage (null when absent/bad). */
export function toPublicSitePage(raw: unknown): PublicSitePage | null {
  if (!isRecord(raw)) return null;
  const slug = s(raw.slug);
  const title = s(raw.title);
  const bodyMd = s(raw.body_md);
  if (!slug || !title || !bodyMd) return null;
  return {
    slug,
    eyebrow: s(raw.eyebrow),
    title,
    description: s(raw.description),
    bodyMd,
  };
}
