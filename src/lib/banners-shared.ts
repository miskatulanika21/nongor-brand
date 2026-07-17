/**
 * Homepage banners — isomorphic types, input schema & error copy shared by the
 * admin UI, the storefront hero and the server fns. NO server-only imports
 * (safe in the client bundle). Mirrors the Stage-6 P3 RPCs
 * (api.get_active_banners / list_banners / upsert_banner / set_banner_active /
 * delete_banner) and the `banners` table.
 */
import { z } from "zod";
import { focalSchemaShape, toFocal } from "@/lib/image-focal";

/** One banner row as returned by api.list_banners / upsert_banner (snake_case). */
export interface AdminBanner {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  cta_to: string | null;
  image_url: string;
  image_alt: string | null;
  card_title: string | null;
  card_subtitle: string | null;
  /** Focal point, normalized 0..1 (0,0 = top-left; 0.5 = centre). See {@link PublicBanner}. */
  focal_x: number;
  focal_y: number;
  /** Zoom/scale, 1..3 (1 = whole image). See {@link PublicBanner}. */
  zoom: number;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  /** Computed by list_banners: active AND inside the schedule window right now. */
  live: boolean;
}

/** The public storefront payload (api.get_active_banners; no staff ids). */
export interface PublicBanner {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaTo: string | null;
  imageUrl: string;
  imageAlt: string | null;
  cardTitle: string | null;
  cardSubtitle: string | null;
  /**
   * Focal point of {@link imageUrl}, normalized 0..1 (x then y; 0,0 = top-left,
   * 0.5,0.5 = centre). The hero applies it as CSS `object-position` so the point
   * stays framed under `object-fit: cover` at every breakpoint — no re-crop.
   */
  focalX: number;
  focalY: number;
  /** Zoom/scale, 1..3 (1 = whole image); magnifies around the focal point. */
  zoom: number;
}

// ── Input validation (mirrors the table CHECKs; server re-validates) ─────────

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(max).nullable(),
    )
    .nullable()
    .optional();

const nullableDate = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(40).nullable(),
  )
  .nullable()
  .optional();

/** Validator for saveBanner (create/edit). CTA + window coherence mirrored below. */
export const bannerInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    eyebrow: optionalText(80),
    title: z.string().trim().min(1, "A headline is required.").max(120),
    subtitle: optionalText(300),
    cta_label: optionalText(60),
    cta_to: optionalText(300),
    image_url: z.string().trim().min(1, "Pick an image from the media library.").max(1000),
    image_alt: optionalText(300),
    card_title: optionalText(120),
    card_subtitle: optionalText(160),
    ...focalSchemaShape,
    sort_order: z.coerce.number().int().min(0).max(1000).default(0),
    is_active: z.boolean().default(false),
    starts_at: nullableDate,
    ends_at: nullableDate,
  })
  .superRefine((b, ctx) => {
    // Same coherence the DB CHECKs (banners_cta_coherent / banners_window_valid)
    // enforce — surfaced early as field errors instead of a generic reject.
    const hasLabel = !!b.cta_label;
    const hasTo = !!b.cta_to;
    if (hasLabel !== hasTo) {
      ctx.addIssue({
        code: "custom",
        path: [hasLabel ? "cta_to" : "cta_label"],
        message: "Provide both a button label and a destination, or neither.",
      });
    }
    if (hasTo && !b.cta_to!.startsWith("/")) {
      ctx.addIssue({
        code: "custom",
        path: ["cta_to"],
        message: "Must be an internal path starting with / (e.g. /shop).",
      });
    }
    if (b.starts_at && b.ends_at && new Date(b.ends_at) <= new Date(b.starts_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "Must be after the start.",
      });
    }
  });

export type BannerInput = z.infer<typeof bannerInputSchema>;

export const setBannerActiveSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export const bannerIdArgSchema = z.object({ id: z.string().uuid() });

// ── Error copy (stable snake_case codes from the RPCs) ───────────────────────

export const BANNER_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  banner_not_found: "That banner no longer exists.",
  image_not_in_library: "The image must come from the media library.",
  invalid_banner: "Some banner values are out of bounds. Check the fields and try again.",
  internal_error: "Could not save the banner. Please try again.",
};

export const KNOWN_BANNER_ERROR_CODES = new Set(Object.keys(BANNER_ERROR_MESSAGES));

export function bannerErrorMessage(code: string | null | undefined): string {
  if (!code) return BANNER_ERROR_MESSAGES.internal_error;
  return BANNER_ERROR_MESSAGES[code] ?? BANNER_ERROR_MESSAGES.internal_error;
}

// ── Public payload mapping (snake → camel, drops bad rows) ───────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Coerce one api.get_active_banners element into a PublicBanner. */
export function toPublicBanner(raw: unknown): PublicBanner | null {
  if (!isRecord(raw)) return null;
  const id = s(raw.id);
  const title = s(raw.title);
  const imageUrl = s(raw.image_url);
  if (!id || !title || !imageUrl) return null;
  const focal = toFocal(raw.focal_x, raw.focal_y, raw.zoom);
  return {
    id,
    eyebrow: s(raw.eyebrow),
    title,
    subtitle: s(raw.subtitle),
    ctaLabel: s(raw.cta_label),
    ctaTo: s(raw.cta_to),
    imageUrl,
    imageAlt: s(raw.image_alt),
    cardTitle: s(raw.card_title),
    cardSubtitle: s(raw.card_subtitle),
    focalX: focal.x,
    focalY: focal.y,
    zoom: focal.zoom,
  };
}

/** Coerce the api.get_active_banners jsonb array (drops bad rows). */
export function toPublicBanners(raw: unknown): PublicBanner[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicBanner[] = [];
  for (const item of raw) {
    const banner = toPublicBanner(item);
    if (banner) out.push(banner);
  }
  return out;
}
