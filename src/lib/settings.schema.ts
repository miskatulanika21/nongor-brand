/**
 * Site settings — isomorphic types, validation, and error messages (Stage 2
 * Pass 3d). Shared by the server repository, the server fns, and the admin UI.
 *
 * Two projections mirror the DB RPCs:
 *   - PublicSettings  ← api.get_public_settings()  (includes the bKash/Nagad
 *     RECEIVE numbers — these are customer-facing, shown at checkout so the
 *     buyer knows where to send money; they are not secrets. No real secrets
 *     (keys/tokens) are ever projected here.)
 *   - AdminSettings   ← api.get_admin_settings()   (full row + audit fields)
 *
 * `settingsSaveSchema` validates an admin patch before it reaches the DB; it
 * mirrors the table CHECK bounds and normalises empty strings to null so a
 * nullable field can be cleared. No server-only imports here.
 */
import { z } from "zod";

export type PublicSettings = {
  store_name: string;
  tagline: string | null;
  announcement_enabled: boolean;
  announcement_text: string | null;
  announcement_link: string | null;
  free_delivery_threshold: number;
  delivery_fee_dhaka: number;
  delivery_fee_major: number;
  delivery_fee_outside: number;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  return_window_days: number;
  order_hold_hours: number;
  /** Is Cash-on-Delivery offered? */
  cod_enabled: boolean;
  /** Which MANUAL payment methods are live (subset of {bkash, nagad}). */
  payment_methods_enabled: ManualPaymentMethod[];
  /** Customer-facing bKash receive number (shown at checkout). */
  bkash_number: string | null;
  /** Customer-facing Nagad receive number (shown at checkout). */
  nagad_number: string | null;
};

/** Manual (non-COD) payment methods the storefront can offer. */
export type ManualPaymentMethod = "bkash" | "nagad";

export type AdminSettings = PublicSettings & {
  payment_instructions: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

// ── Validation (admin patch) ────────────────────────────────────────────────

/** Optional, clearable text: trims, treats "" as null, bounds the length. */
const optText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
      z.string().max(max).nullable(),
    )
    .optional();

const reqText = (max: number) => z.string().trim().min(1).max(max).optional();

/**
 * A link is safe to render into an `href` only if it is an absolute http(s) URL
 * or a site-relative path (`/…`, but not protocol-relative `//…`). This rejects
 * `javascript:`, `data:`, `vbscript:`, etc. Used for the announcement + social
 * link fields, which are operator-supplied and rendered as anchors.
 */
export function isSafeLinkUrl(v: string): boolean {
  if (v.startsWith("/") && !v.startsWith("//")) return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Optional, clearable link bounded to `max`, restricted to safe URL schemes. */
const optUrl = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
      z
        .string()
        .max(max)
        .refine(isSafeLinkUrl, "Enter a valid http(s) or site-relative link.")
        .nullable(),
    )
    .optional();

/** Optional, clearable email address bounded to `max`. */
const optEmail = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
      z.string().max(max).email("Enter a valid email address.").nullable(),
    )
    .optional();

const nonNegInt = (max?: number) => {
  const base = z.coerce.number().int().min(0);
  return (max != null ? base.max(max) : base).optional();
};

export const settingsSaveSchema = z.object({
  store_name: reqText(80),
  tagline: optText(160),
  announcement_enabled: z.boolean().optional(),
  announcement_text: optText(200),
  announcement_link: optUrl(300),
  free_delivery_threshold: nonNegInt(),
  delivery_fee_dhaka: nonNegInt(),
  delivery_fee_major: nonNegInt(),
  delivery_fee_outside: nonNegInt(),
  contact_email: optEmail(160),
  contact_phone: optText(40),
  whatsapp: optText(40),
  instagram: optUrl(300),
  facebook: optUrl(300),
  tiktok: optUrl(300),
  return_window_days: nonNegInt(365),
  order_hold_hours: nonNegInt(720),
  cod_enabled: z.boolean().optional(),
  payment_methods_enabled: z.array(z.enum(["bkash", "nagad"])).optional(),
  bkash_number: optText(40),
  nagad_number: optText(40),
  payment_instructions: optText(500),
});

export type SettingsPatch = z.infer<typeof settingsSaveSchema>;

// ── Error messages ──────────────────────────────────────────────────────────

export const SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  invalid_settings: "Some settings are invalid. Please review and try again.",
  internal_error: "Could not save settings. Please try again.",
};

export const KNOWN_SETTINGS_ERROR_CODES = new Set(Object.keys(SETTINGS_ERROR_MESSAGES));

export function settingsErrorMessage(code: string): string {
  return SETTINGS_ERROR_MESSAGES[code] ?? SETTINGS_ERROR_MESSAGES.internal_error;
}

// ── Normalisation ───────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Coerce the public-settings jsonb into the typed shape (or null if absent). */
export function normalizePublicSettings(raw: unknown): PublicSettings | null {
  if (!isRecord(raw)) return null;
  return {
    store_name: str(raw.store_name) ?? "Nongorr",
    tagline: str(raw.tagline),
    announcement_enabled: bool(raw.announcement_enabled, true),
    announcement_text: str(raw.announcement_text),
    announcement_link: str(raw.announcement_link),
    free_delivery_threshold: num(raw.free_delivery_threshold, 3000),
    delivery_fee_dhaka: num(raw.delivery_fee_dhaka, 80),
    delivery_fee_major: num(raw.delivery_fee_major, 100),
    delivery_fee_outside: num(raw.delivery_fee_outside, 130),
    contact_email: str(raw.contact_email),
    contact_phone: str(raw.contact_phone),
    whatsapp: str(raw.whatsapp),
    instagram: str(raw.instagram),
    facebook: str(raw.facebook),
    tiktok: str(raw.tiktok),
    return_window_days: num(raw.return_window_days, 7),
    order_hold_hours: num(raw.order_hold_hours, 24),
    cod_enabled: bool(raw.cod_enabled, true),
    payment_methods_enabled: manualMethods(raw.payment_methods_enabled),
    bkash_number: str(raw.bkash_number),
    nagad_number: str(raw.nagad_number),
  };
}

/** Keep only known manual methods, de-duplicated, order preserved. */
function manualMethods(v: unknown): ManualPaymentMethod[] {
  if (!Array.isArray(v)) return ["bkash"];
  const out: ManualPaymentMethod[] = [];
  for (const x of v) {
    if ((x === "bkash" || x === "nagad") && !out.includes(x)) out.push(x);
  }
  return out;
}

/** Coerce the admin-settings jsonb (public fields + payment) into the type. */
export function normalizeAdminSettings(raw: unknown): AdminSettings | null {
  const pub = normalizePublicSettings(raw);
  if (!pub || !isRecord(raw)) return null;
  return {
    ...pub, // includes bkash_number / nagad_number (now public, customer-facing)
    payment_instructions: str(raw.payment_instructions),
    updated_at: str(raw.updated_at),
    updated_by: str(raw.updated_by),
  };
}

/**
 * Header announcement state (serialisable — safe to pass through router context):
 *   - "hidden"   → the operator turned the bar off.
 *   - "custom"   → show the configured text (+ optional link).
 *   - "fallback" → no usable DB value (read failed, or enabled-but-empty); the
 *                  header keeps its own static default so the bar never vanishes
 *                  on a transient failure.
 */
export type AnnouncementState =
  | { mode: "fallback" }
  | { mode: "hidden" }
  | { mode: "custom"; text: string; link: string | null };

export function announcementState(settings: PublicSettings | null): AnnouncementState {
  if (!settings) return { mode: "fallback" };
  if (!settings.announcement_enabled) return { mode: "hidden" };
  const text = (settings.announcement_text ?? "").trim();
  if (!text) return { mode: "fallback" };
  return { mode: "custom", text, link: settings.announcement_link };
}
