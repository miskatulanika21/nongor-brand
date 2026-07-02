/**
 * Customer-account shared module — isomorphic (NO server-only imports).
 *
 * The single source of truth for the Stage-4 account contract between the
 * server fns (account.api.ts), the server repo (account.server.ts) and the
 * account UI (account-ui.tsx, rewired in P4):
 *   - DTO shapes (mirrors of the api.get_my_account projection, mapped to the
 *     string-based shapes the account UI already renders)
 *   - zod validators that mirror the DB CHECKs / RPC bounds exactly
 *   - camelCase → snake_case RPC payload builders (presence-preserving)
 *   - the stable error-code → safe-message map
 *
 * Server truth lives in api.* (migration 20260702081309); everything here is
 * client-safe validation + mapping, never authorization.
 */
import { z } from "zod";
import { normalizeBDPhone } from "@/lib/bd-phone";

// ── Constants (mirror the DB CHECKs) ─────────────────────────────────────────

export const BD_PHONE_RE = /^01[3-9]\d{8}$/;

export const MAX_SAVED_ADDRESSES = 10;
export const MAX_SAVED_MEASUREMENTS = 12;
export const MAX_WISHLIST_ITEMS = 100;

/** Sync payload bounds (the RPC also clamps server-side). */
export const WISHLIST_SYNC_MAX_CODES = 200;
export const WISHLIST_CODE_MAX_LENGTH = 64;

export const FIT_PREFERENCE_VALUES = ["Fitted", "Regular", "Relaxed"] as const;
export type FitPreferenceValue = (typeof FIT_PREFERENCE_VALUES)[number];

export const MEASUREMENT_VALUE_KEYS = [
  "bust",
  "waist",
  "hip",
  "shoulder",
  "sleeve",
  "dressLength",
] as const;
export type MeasurementValueKey = (typeof MEASUREMENT_VALUE_KEYS)[number];

// ── DTOs (string-based, matching what the account UI renders) ────────────────

export interface AccountProfileDto {
  fullName: string;
  /** Normalized BD mobile or "" when unset. */
  phone: string;
  /** ISO date (YYYY-MM-DD) or "" when unset. */
  birthday: string;
  updatedAt: string;
}

export interface ServerSavedAddress {
  id: string;
  label?: string;
  recipient: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  isDefault: boolean;
}

export interface ServerMeasurement {
  id: string;
  name: string;
  bust: string;
  waist: string;
  hip: string;
  shoulder: string;
  sleeve: string;
  dressLength: string;
  fitPreference: FitPreferenceValue;
  updatedAt: string;
}

/** The api.get_my_account composite, mapped for the account UI. */
export interface AccountSnapshot {
  email: string;
  /** null until the first save_profile (lazy row). */
  profile: AccountProfileDto | null;
  addresses: ServerSavedAddress[];
  measurements: ServerMeasurement[];
}

export interface AccountImportResult {
  profile: boolean;
  addresses: number;
  addressesSkipped: number;
  measurements: number;
  measurementsSkipped: number;
}

// ── Validators (mirror the RPC/DB bounds) ────────────────────────────────────

/** "" clears; otherwise must normalize to a valid BD mobile. */
const phoneField = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v === "" ? "" : normalizeBDPhone(v)))
  .refine((v) => v === "" || BD_PHONE_RE.test(v), {
    message: "Enter a valid Bangladeshi mobile number",
  });

/** "" clears; otherwise an ISO date the DB will range-check (1900..today). */
const birthdayField = z
  .string()
  .trim()
  .max(10)
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "Use the YYYY-MM-DD format",
  });

/**
 * "" clears; otherwise a positive number that still fits the DB bound after
 * rounding to the column scale (numeric(5,1): value < 200 post-round).
 */
const measureField = z
  .string()
  .trim()
  .max(10)
  .refine(
    (v) => {
      if (v === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && Math.round(n * 10) / 10 < 200;
    },
    { message: "Enter a measurement between 0 and 200 inches" },
  );

/** Presence-preserving profile patch: only provided keys reach the RPC. */
export const profilePatchSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: phoneField.optional(),
  birthday: birthdayField.optional(),
});
export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;

/** Full address form (the UI always submits every field). */
export const addressInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().max(40).optional(),
  recipient: z.string().trim().min(1).max(120),
  phone: phoneField,
  district: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  isDefault: z.boolean().optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

/** Full measurement form (the UI always submits every field). */
export const measurementInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  bust: measureField,
  waist: measureField,
  hip: measureField,
  shoulder: measureField,
  sleeve: measureField,
  dressLength: measureField,
  fitPreference: z.enum(FIT_PREFERENCE_VALUES),
});
export type MeasurementInput = z.infer<typeof measurementInputSchema>;

export const accountIdSchema = z.object({ id: z.string().uuid() });

/**
 * One-time import payload (P4 builds it from the legacy localStorage state).
 * Deliberately loose — the RPC re-validates row-by-row and salvages what it
 * can (bad rows skip, bad phones/numerics coerce to NULL) — but bounded so an
 * oversized request never reaches the DB. Arrays may exceed the storage caps
 * slightly; the RPC keeps the first 10 / 12.
 */
const importString = z.string().trim().max(600);
export const importPayloadSchema = z.object({
  profile: z
    .object({
      fullName: importString.optional(),
      phone: importString.optional(),
      birthday: importString.optional(),
    })
    .optional(),
  addresses: z
    .array(
      z.object({
        label: importString.optional(),
        recipient: importString.optional(),
        phone: importString.optional(),
        district: importString.optional(),
        area: importString.optional(),
        address: importString.optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .max(20)
    .optional(),
  measurements: z
    .array(
      z.object({
        name: importString.optional(),
        bust: importString.optional(),
        waist: importString.optional(),
        hip: importString.optional(),
        shoulder: importString.optional(),
        sleeve: importString.optional(),
        dressLength: importString.optional(),
        fitPreference: importString.optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type AccountImportPayload = z.infer<typeof importPayloadSchema>;

// ── Wishlist (P6) ────────────────────────────────────────────────────────────
// The client stores product CODES (the stable public catalog id — `Product.id`
// in the UI). Sync merges a device's local list on login; toggle flips one
// heart. Both return the canonical server list.

export const wishlistSyncSchema = z.object({
  codes: z
    .array(z.string().trim().min(1).max(WISHLIST_CODE_MAX_LENGTH))
    .max(WISHLIST_SYNC_MAX_CODES),
});
export type WishlistSyncInput = z.infer<typeof wishlistSyncSchema>;

export const wishlistToggleSchema = z.object({
  code: z.string().trim().min(1).max(WISHLIST_CODE_MAX_LENGTH),
});
export type WishlistToggleInput = z.infer<typeof wishlistToggleSchema>;

export interface WishlistToggleResult {
  wishlisted: boolean;
  codes: string[];
}

/**
 * Clean a device-stored code list before it reaches wishlistSyncSchema: keep
 * only plausible non-blank strings, dedupe preserving order, clamp the count.
 * A single poisoned localStorage entry must never fail the whole sync.
 */
export function sanitizeWishlistCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const code = value.trim();
    if (code === "" || code.length > WISHLIST_CODE_MAX_LENGTH || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= WISHLIST_SYNC_MAX_CODES) break;
  }
  return out;
}

// ── RPC payload builders (camelCase → snake_case) ────────────────────────────
// "" means CLEAR for the nullable fields → sent as null so the RPC's
// present-but-null semantics apply.

const clearable = (v: string): string | null => (v === "" ? null : v);

export function toProfilePatch(input: ProfilePatchInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.fullName !== undefined) patch.full_name = input.fullName;
  if (input.phone !== undefined) patch.phone = clearable(input.phone);
  if (input.birthday !== undefined) patch.birthday = clearable(input.birthday);
  return patch;
}

export function toAddressPayload(input: AddressInput): Record<string, unknown> {
  return {
    label: clearable(input.label ?? ""),
    recipient: input.recipient,
    phone: clearable(input.phone),
    district: input.district,
    area: input.area,
    address: input.address,
    is_default: input.isDefault ?? false,
  };
}

export function toMeasurementPayload(input: MeasurementInput): Record<string, unknown> {
  return {
    name: input.name,
    bust: clearable(input.bust),
    waist: clearable(input.waist),
    hip: clearable(input.hip),
    shoulder: clearable(input.shoulder),
    sleeve: clearable(input.sleeve),
    dress_length: clearable(input.dressLength),
    fit_preference: input.fitPreference,
  };
}

export function toImportPayload(input: AccountImportPayload): Record<string, unknown> {
  return {
    profile: input.profile
      ? {
          full_name: input.profile.fullName ?? "",
          phone: input.profile.phone ?? "",
          birthday: input.profile.birthday ?? "",
        }
      : undefined,
    addresses: (input.addresses ?? []).map((a) => ({
      label: a.label ?? "",
      recipient: a.recipient ?? "",
      phone: a.phone ?? "",
      district: a.district ?? "",
      area: a.area ?? "",
      address: a.address ?? "",
      is_default: a.isDefault ?? false,
    })),
    measurements: (input.measurements ?? []).map((m) => ({
      name: m.name ?? "",
      bust: m.bust ?? "",
      waist: m.waist ?? "",
      hip: m.hip ?? "",
      shoulder: m.shoulder ?? "",
      sleeve: m.sleeve ?? "",
      dress_length: m.dressLength ?? "",
      fit_preference: m.fitPreference ?? "",
    })),
  };
}

// ── Row mappers (snake_case RPC rows → DTOs; defensive, never throw) ─────────

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function numStr(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return v;
  return "";
}

function isFit(v: unknown): v is FitPreferenceValue {
  return v === "Fitted" || v === "Regular" || v === "Relaxed";
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function mapProfileRow(raw: unknown): AccountProfileDto | null {
  const o = rec(raw);
  if (!o) return null;
  const fullName = str(o.full_name);
  if (!fullName) return null;
  return {
    fullName,
    phone: str(o.phone),
    birthday: str(o.birthday),
    updatedAt: str(o.updated_at),
  };
}

export function mapAddressRow(raw: unknown): ServerSavedAddress | null {
  const o = rec(raw);
  if (!o) return null;
  const id = str(o.id);
  const recipient = str(o.recipient);
  const district = str(o.district);
  const area = str(o.area);
  const address = str(o.address);
  if (!id || !recipient || !district || !area || !address) return null;
  return {
    id,
    label: typeof o.label === "string" && o.label !== "" ? o.label : undefined,
    recipient,
    phone: str(o.phone),
    district,
    area,
    address,
    isDefault: o.is_default === true,
  };
}

export function mapMeasurementRow(raw: unknown): ServerMeasurement | null {
  const o = rec(raw);
  if (!o) return null;
  const id = str(o.id);
  const name = str(o.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    bust: numStr(o.bust),
    waist: numStr(o.waist),
    hip: numStr(o.hip),
    shoulder: numStr(o.shoulder),
    sleeve: numStr(o.sleeve),
    dressLength: numStr(o.dress_length),
    fitPreference: isFit(o.fit_preference) ? o.fit_preference : "Regular",
    updatedAt: str(o.updated_at),
  };
}

export function mapAccountSnapshot(raw: unknown): AccountSnapshot {
  const o = rec(raw) ?? {};
  const addresses = Array.isArray(o.addresses)
    ? o.addresses.map(mapAddressRow).filter((a): a is ServerSavedAddress => a !== null)
    : [];
  const measurements = Array.isArray(o.measurements)
    ? o.measurements.map(mapMeasurementRow).filter((m): m is ServerMeasurement => m !== null)
    : [];
  return {
    email: str(o.email),
    profile: mapProfileRow(o.profile),
    addresses,
    measurements,
  };
}

/** Map an RPC wishlist snapshot ({codes, count, wishlisted?}) to a code list. */
export function mapWishlistCodes(raw: unknown): string[] {
  const o = rec(raw);
  if (!o || !Array.isArray(o.codes)) return [];
  return o.codes.filter((c): c is string => typeof c === "string" && c !== "");
}

export function mapWishlistToggle(raw: unknown): WishlistToggleResult {
  const o = rec(raw);
  return {
    wishlisted: o?.wishlisted === true,
    codes: mapWishlistCodes(raw),
  };
}

export function mapImportResult(raw: unknown): AccountImportResult {
  const o = rec(raw) ?? {};
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    profile: o.profile === true,
    addresses: n(o.addresses),
    addressesSkipped: n(o.addresses_skipped),
    measurements: n(o.measurements),
    measurementsSkipped: n(o.measurements_skipped),
  };
}

// ── Stable error codes → safe messages ───────────────────────────────────────

export const ACCOUNT_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Please sign in to manage your account.",
  invalid_profile: "Please check your profile details and try again.",
  invalid_phone: "Enter a valid Bangladeshi mobile number (e.g. 01712345678).",
  invalid_birthday: "Enter a valid birthday (YYYY-MM-DD).",
  invalid_address: "Please check the address fields and try again.",
  address_not_found: "That address no longer exists.",
  too_many_addresses: `You can save up to ${MAX_SAVED_ADDRESSES} addresses. Remove one first.`,
  invalid_measurement: "Please check the measurement values and try again.",
  measurement_not_found: "That measurement profile no longer exists.",
  too_many_measurements: `You can save up to ${MAX_SAVED_MEASUREMENTS} measurement profiles. Remove one first.`,
  duplicate_measurement_name: "You already have a profile with this name.",
  already_imported: "Your account data is already synced.",
  wishlist_full: `Your wishlist is full (${MAX_WISHLIST_ITEMS} items). Remove one first.`,
  product_not_found: "That product is no longer available.",
  internal_error: "Something went wrong. Please try again.",
};

export const KNOWN_ACCOUNT_ERROR_CODES = new Set(Object.keys(ACCOUNT_ERROR_MESSAGES));

const GENERIC_ACCOUNT_ERROR = "Could not save your changes. Please try again.";

export function accountErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_ACCOUNT_ERROR;
  return ACCOUNT_ERROR_MESSAGES[code] ?? GENERIC_ACCOUNT_ERROR;
}
