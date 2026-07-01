// Frontend-only checkout/delivery helpers shared by Cart and Checkout.
// No backend, no server validation. Coupons here are a client-side mock.
// This module is the single source of truth for delivery configuration and
// Bangladesh location data.

import { isDemoCommerceEnabled } from "@/lib/checkout-mode";

export type DeliveryZone = "dhaka" | "major" | "outside";

export interface DeliveryZoneOption {
  value: DeliveryZone;
  label: string;
  fee: number;
}

export const DELIVERY_ZONES: DeliveryZoneOption[] = [
  { value: "dhaka", label: "Inside Dhaka", fee: 80 },
  { value: "major", label: "Major cities", fee: 100 },
  { value: "outside", label: "Outside Dhaka", fee: 130 },
];

export const FREE_DELIVERY_THRESHOLD = 3000;

export const DEFAULT_DELIVERY_ZONE: DeliveryZone = "dhaka";

export function isDeliveryZone(value: unknown): value is DeliveryZone {
  return value === "dhaka" || value === "major" || value === "outside";
}

export function normalizeZone(value: unknown): DeliveryZone {
  return isDeliveryZone(value) ? value : DEFAULT_DELIVERY_ZONE;
}

export function zoneLabel(zone: DeliveryZone): string {
  return DELIVERY_ZONES.find((z) => z.value === zone)?.label ?? "Inside Dhaka";
}

export function zoneFee(zone: DeliveryZone): number {
  return DELIVERY_ZONES.find((z) => z.value === zone)?.fee ?? 0;
}

/**
 * UI ESTIMATE ONLY — do not use for the authoritative total. These constants are
 * a client-side preview; the live fees/threshold live in site_settings and are
 * computed server-side by private.compute_shipping (api.quote_order). Always
 * prefer the server quote's shipping_fee/total; this exists only for a pre-quote
 * preview and an offline fallback.
 */
export function computeShipping(zone: DeliveryZone, subtotal: number): number {
  if (subtotal <= 0) return 0;
  if (subtotal >= FREE_DELIVERY_THRESHOLD) return 0;
  return DELIVERY_ZONES.find((item) => item.value === zone)?.fee ?? 0;
}

export function freeDeliveryRemaining(subtotal: number): number {
  return Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal);
}

// ---- Bangladesh location data (normalized, single source) -------------------

export interface DistrictOption {
  name: string;
  division: string;
  /** Suggested default delivery zone — only a default; the UI may override it. */
  suggestedZone: DeliveryZone;
  /** Common legacy / alternate spellings; canonical spelling is always `name`. */
  aliases?: string[];
}

/** All 64 districts of Bangladesh, each exactly once. */
export const BD_DISTRICTS: DistrictOption[] = [
  // Barishal
  { name: "Barguna", division: "Barishal", suggestedZone: "outside" },
  { name: "Barishal", division: "Barishal", suggestedZone: "outside", aliases: ["Barisal"] },
  { name: "Bhola", division: "Barishal", suggestedZone: "outside" },
  { name: "Jhalokati", division: "Barishal", suggestedZone: "outside" },
  { name: "Patuakhali", division: "Barishal", suggestedZone: "outside" },
  { name: "Pirojpur", division: "Barishal", suggestedZone: "outside" },
  // Chattogram
  { name: "Bandarban", division: "Chattogram", suggestedZone: "outside" },
  { name: "Brahmanbaria", division: "Chattogram", suggestedZone: "outside" },
  { name: "Chandpur", division: "Chattogram", suggestedZone: "outside" },
  {
    name: "Chattogram",
    division: "Chattogram",
    suggestedZone: "major",
    aliases: ["Chittagong"],
  },
  { name: "Cumilla", division: "Chattogram", suggestedZone: "outside", aliases: ["Comilla"] },
  {
    name: "Cox's Bazar",
    division: "Chattogram",
    suggestedZone: "outside",
    aliases: ["Coxs Bazar", "Cox Bazar"],
  },
  { name: "Feni", division: "Chattogram", suggestedZone: "outside" },
  {
    name: "Khagrachhari",
    division: "Chattogram",
    suggestedZone: "outside",
    aliases: ["Khagrachari"],
  },
  { name: "Lakshmipur", division: "Chattogram", suggestedZone: "outside", aliases: ["Laxmipur"] },
  { name: "Noakhali", division: "Chattogram", suggestedZone: "outside" },
  { name: "Rangamati", division: "Chattogram", suggestedZone: "outside" },
  // Dhaka
  { name: "Dhaka", division: "Dhaka", suggestedZone: "dhaka" },
  { name: "Faridpur", division: "Dhaka", suggestedZone: "outside" },
  { name: "Gazipur", division: "Dhaka", suggestedZone: "major" },
  { name: "Gopalganj", division: "Dhaka", suggestedZone: "outside" },
  { name: "Kishoreganj", division: "Dhaka", suggestedZone: "outside" },
  { name: "Madaripur", division: "Dhaka", suggestedZone: "outside" },
  { name: "Manikganj", division: "Dhaka", suggestedZone: "outside" },
  { name: "Munshiganj", division: "Dhaka", suggestedZone: "outside" },
  { name: "Narayanganj", division: "Dhaka", suggestedZone: "major" },
  { name: "Narsingdi", division: "Dhaka", suggestedZone: "outside" },
  { name: "Rajbari", division: "Dhaka", suggestedZone: "outside" },
  { name: "Shariatpur", division: "Dhaka", suggestedZone: "outside" },
  { name: "Tangail", division: "Dhaka", suggestedZone: "outside" },
  // Khulna
  { name: "Bagerhat", division: "Khulna", suggestedZone: "outside" },
  { name: "Chuadanga", division: "Khulna", suggestedZone: "outside" },
  { name: "Jashore", division: "Khulna", suggestedZone: "outside", aliases: ["Jessore"] },
  { name: "Jhenaidah", division: "Khulna", suggestedZone: "outside" },
  { name: "Khulna", division: "Khulna", suggestedZone: "major" },
  { name: "Kushtia", division: "Khulna", suggestedZone: "outside" },
  { name: "Magura", division: "Khulna", suggestedZone: "outside" },
  { name: "Meherpur", division: "Khulna", suggestedZone: "outside" },
  { name: "Narail", division: "Khulna", suggestedZone: "outside" },
  { name: "Satkhira", division: "Khulna", suggestedZone: "outside" },
  // Mymensingh
  { name: "Jamalpur", division: "Mymensingh", suggestedZone: "outside" },
  { name: "Mymensingh", division: "Mymensingh", suggestedZone: "outside" },
  { name: "Netrokona", division: "Mymensingh", suggestedZone: "outside" },
  { name: "Sherpur", division: "Mymensingh", suggestedZone: "outside" },
  // Rajshahi
  { name: "Bogura", division: "Rajshahi", suggestedZone: "outside", aliases: ["Bogra"] },
  { name: "Joypurhat", division: "Rajshahi", suggestedZone: "outside" },
  { name: "Naogaon", division: "Rajshahi", suggestedZone: "outside" },
  { name: "Natore", division: "Rajshahi", suggestedZone: "outside" },
  {
    name: "Chapai Nawabganj",
    division: "Rajshahi",
    suggestedZone: "outside",
    aliases: ["Chapainawabganj", "Nawabganj", "Chapai Nababganj"],
  },
  { name: "Pabna", division: "Rajshahi", suggestedZone: "outside" },
  { name: "Rajshahi", division: "Rajshahi", suggestedZone: "major" },
  { name: "Sirajganj", division: "Rajshahi", suggestedZone: "outside" },
  // Rangpur
  { name: "Dinajpur", division: "Rangpur", suggestedZone: "outside" },
  { name: "Gaibandha", division: "Rangpur", suggestedZone: "outside" },
  { name: "Kurigram", division: "Rangpur", suggestedZone: "outside" },
  { name: "Lalmonirhat", division: "Rangpur", suggestedZone: "outside" },
  { name: "Nilphamari", division: "Rangpur", suggestedZone: "outside" },
  { name: "Panchagarh", division: "Rangpur", suggestedZone: "outside" },
  { name: "Rangpur", division: "Rangpur", suggestedZone: "outside" },
  { name: "Thakurgaon", division: "Rangpur", suggestedZone: "outside" },
  // Sylhet
  { name: "Habiganj", division: "Sylhet", suggestedZone: "outside" },
  { name: "Moulvibazar", division: "Sylhet", suggestedZone: "outside", aliases: ["Maulvibazar"] },
  { name: "Sunamganj", division: "Sylhet", suggestedZone: "outside" },
  { name: "Sylhet", division: "Sylhet", suggestedZone: "major" },
];

/** Canonical district names, for selects (back-compat with existing checkout). */
export const DISTRICTS: string[] = BD_DISTRICTS.map((d) => d.name);

export const DHAKA_AREAS = [
  "Dhanmondi",
  "Gulshan",
  "Banani",
  "Mirpur",
  "Uttara",
  "Mohammadpur",
  "Motijheel",
  "Wari",
  "Badda",
  "Khilgaon",
  "Rayer Bazar",
];

/** Stable sentinel for the custom "Other area" Dhaka option. */
export const OTHER_AREA_VALUE = "__other__";

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase().replace(/[`']/g, "'");
}

/** Resolve any input (canonical or legacy alias) to a canonical DistrictOption. */
export function resolveDistrict(input: string): DistrictOption | null {
  const norm = normalizeName(input);
  if (!norm) return null;
  for (const d of BD_DISTRICTS) {
    if (normalizeName(d.name) === norm) return d;
    if (d.aliases?.some((a) => normalizeName(a) === norm)) return d;
  }
  return null;
}

/** Canonical spelling for a district input, or null if unknown. */
export function canonicalDistrict(input: string): string | null {
  return resolveDistrict(input)?.name ?? null;
}

/**
 * Suggested default delivery zone for a district. Returns null for unknown or
 * empty input — never silently falls back to "outside". This is only a default;
 * later UI phases may let the customer/admin override the actual zone.
 */
export function suggestDeliveryZoneForDistrict(input: string): DeliveryZone | null {
  return resolveDistrict(input)?.suggestedZone ?? null;
}

/** @deprecated Use suggestDeliveryZoneForDistrict (district ≠ guaranteed zone). */
export function mapDistrictToZone(district: string): DeliveryZone | null {
  return suggestDeliveryZoneForDistrict(district);
}

// ---- Shared checkout address shape (single source of truth) ------------------
// Defined here (not in account-ui) so adapters stay dependency-safe.

export interface CheckoutAddress {
  recipient: string;
  phone: string;
  district: string;
  /** Thana / upazila / Dhaka area. Never the OTHER_AREA_VALUE sentinel. */
  area: string;
  address: string;
}

// ---- Coupons (client-side mock) ---------------------------------------------

export interface Coupon {
  code: string;
  type: "percent" | "flat";
  value: number;
  min: number;
  label: string;
}

// TODO: backend must validate coupons later. These are display-only mocks.
export const MOCK_COUPONS: Coupon[] = [
  { code: "WELCOME10", type: "percent", value: 10, min: 1500, label: "10% off" },
  { code: "FLAT200", type: "flat", value: 200, min: 2500, label: "৳200 off" },
  { code: "EID500", type: "flat", value: 500, min: 5000, label: "৳500 off" },
];

export function findCoupon(code: string | null): Coupon | null {
  if (!code) return null;
  // Coupons are server-validated only from Stage 3 Pass 5. Until then these are
  // demo-only mocks: api.place_order forces discount = 0, so honouring a mock
  // code in production would show a phantom discount the order never receives.
  // Gate behind the demo flag so prod never resolves one. See checkout-mode.ts.
  if (!isDemoCommerceEnabled()) return null;
  return MOCK_COUPONS.find((c) => c.code === code.trim().toUpperCase()) ?? null;
}

export function couponDiscount(coupon: Coupon | null, subtotal: number): number {
  if (!coupon || subtotal < coupon.min) return 0;
  const raw =
    coupon.type === "percent" ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  return Math.min(subtotal, Math.max(0, raw));
}
