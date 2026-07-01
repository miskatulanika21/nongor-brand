/**
 * Canonical custom-measurement schema. One internal schema bridges the PDP's
 * legacy display keys ("Kurti Length") and account-profile keys ("dressLength").
 * Pure data — no React/server imports, browser-safe for account-ui.tsx.
 */
export type CanonicalMeasurementKey =
  | "bust"
  | "waist"
  | "hip"
  | "shoulder"
  | "sleeve"
  | "kurtiLength";

// Map any legacy / display variant onto a canonical key.
const MEASUREMENT_KEY_ALIASES: Record<string, CanonicalMeasurementKey> = {
  bust: "bust",
  waist: "waist",
  hip: "hip",
  shoulder: "shoulder",
  sleeve: "sleeve",
  length: "kurtiLength",
  kurtilength: "kurtiLength",
  kurti_length: "kurtiLength",
  "kurti length": "kurtiLength",
  dresslength: "kurtiLength",
  dress_length: "kurtiLength",
  "dress length": "kurtiLength",
};

export function toCanonicalMeasurementKey(key: string): CanonicalMeasurementKey | null {
  const norm = key.trim().toLowerCase().replace(/\s+/g, " ");
  return MEASUREMENT_KEY_ALIASES[norm] ?? null;
}

/**
 * Normalize an arbitrary custom-measurement record (legacy or mixed keys) to a
 * canonical-keyed record, keeping only recognized, non-empty values.
 */
export function normalizeCustomMeasurements(
  raw: Record<string, string> | undefined | null,
): Partial<Record<CanonicalMeasurementKey, string>> {
  const out: Partial<Record<CanonicalMeasurementKey, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const canonical = toCanonicalMeasurementKey(k);
    if (!canonical) continue;
    const value = typeof v === "string" ? v.trim() : "";
    if (value) out[canonical] = value;
  }
  return out;
}
