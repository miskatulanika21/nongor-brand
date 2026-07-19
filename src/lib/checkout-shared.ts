/**
 * Checkout — isomorphic types & helpers shared by the storefront UI and the
 * server fns. NO server-only imports here, so it is safe in the client bundle.
 *
 * This mirrors the Stage 3 Pass 3a RPC contract (api.quote_order /
 * api.place_order; see supabase/migrations/20260627150000_order_rpcs.sql):
 *   - Lines are keyed on product `code`. The DB-backed storefront sets
 *     Product.id = products.code (catalog-map.ts), so a CartItem.productId IS
 *     the code the RPCs expect — no separate lookup is needed.
 *   - The server always re-prices; client totals are display-only. `quote_token`
 *     is the drift guard carried from quote → place.
 *   - Coupons are server-validated (P5b): quote_order returns the applied
 *     discount + a `coupon` status object; place_order re-validates + consumes
 *     the coupon under a row lock. The client never computes a discount.
 */
import { z } from "zod";
import type { CartItem } from "@/lib/store";
import type { DeliveryZone } from "@/lib/checkout-ui";
import type { ManualPaymentMethod, PublicSettings } from "@/lib/settings.schema";

/** Delivery zones, matching the DB CHECK and DeliveryZone union. */
export const DELIVERY_ZONE_VALUES = ["dhaka", "major", "outside"] as const;
/** Bangladesh mobile, normalized to 01XXXXXXXXX (matches the checkout form). */
export const BD_PHONE_RE = /^01[3-9]\d{8}$/;

// ── Payment methods ──────────────────────────────────────────────────────────

/** Every checkout payment method (COD + the manual transfer methods). */
export type PaymentMethod = "cod" | ManualPaymentMethod;

/** Manual (non-COD) methods require a TrxID + send-money flow. */
export const MANUAL_METHODS: readonly ManualPaymentMethod[] = ["bkash", "nagad"] as const;

export function isManualMethod(m: PaymentMethod): m is ManualPaymentMethod {
  return m === "bkash" || m === "nagad";
}

/**
 * Customer-facing label for a payment method — never render the raw slug
 * (`Cod` / `Bkash`) to a customer. Unknown values fall back to the raw string.
 */
export function paymentMethodLabel(method: string): string {
  switch (method) {
    case "cod":
      return "Cash on Delivery";
    case "bkash":
      return "bKash";
    case "nagad":
      return "Nagad";
    default:
      return method;
  }
}

/**
 * Methods currently offered, derived from public settings. Falls back to a
 * safe default (COD on, bKash) when settings are unavailable so checkout is
 * never left with zero options purely due to a transient read failure.
 */
export function availableMethods(settings: PublicSettings | null): {
  cod: boolean;
  manual: ManualPaymentMethod[];
} {
  if (!settings) return { cod: true, manual: ["bkash"] };
  return { cod: settings.cod_enabled, manual: settings.payment_methods_enabled };
}

/** Ordered list of every enabled method (COD first), for rendering a selector. */
export function enabledMethodList(settings: PublicSettings | null): PaymentMethod[] {
  const { cod, manual } = availableMethods(settings);
  return [...(cod ? (["cod"] as const) : []), ...manual];
}

// ── Quote / place request + response shapes (mirror the RPC JSON) ────────────

/** One input line for api.quote_order / api.place_order. */
export interface QuoteLineInput {
  code: string;
  size?: string;
  qty: number;
}

/**
 * A place_order line: a quote line plus optional made-to-measure `measures`
 * (label → value). Measurements are FULFILMENT data only — the server ignores
 * them for pricing and excludes them from the quote_token canon, so quote →
 * place never drifts on them (they are stripped for the quote request).
 */
export interface PlaceLineInput extends QuoteLineInput {
  measures?: Record<string, string>;
}

/** One priced line returned by api.quote_order (per input line, order kept). */
export interface QuoteLine {
  product_id?: string;
  code: string;
  name?: string;
  image?: string | null;
  size: string | null;
  qty: number;
  unit_price?: number;
  line_total?: number;
  /** Ready-size availability. `null` for a made-to-order custom line (unlimited). */
  available?: number | null;
  /** True when this is a made-to-measure line (size = "Custom"); not stock-bound. */
  custom?: boolean;
  visible: boolean;
  found: boolean;
}

/**
 * Coupon status echoed by api.quote_order when a code was supplied. `applied`
 * distinguishes a live discount from a rejection (`reason` is one of the stable
 * coupon codes). For a free_shipping coupon `discount` is 0 and `shipping_waived`
 * carries the saved delivery fee. `null` on QuoteResult.coupon = no code sent.
 */
export interface QuoteCoupon {
  code: string;
  applied: boolean;
  /** Stable rejection code when `applied` is false (see COUPON_REASON_MESSAGES). */
  reason?: string;
  type?: "percent" | "fixed" | "free_shipping";
  /** Amount taken off the subtotal (0 for free_shipping). */
  discount?: number;
  /** Delivery fee waived (free_shipping only; 0 otherwise). */
  shipping_waived?: number;
  /** Total customer saving (discount, or the waived shipping for free_shipping). */
  amount?: number;
  description?: string | null;
}

export interface QuoteResult {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  /** Coupon outcome when a code was quoted; null when none was supplied. */
  coupon: QuoteCoupon | null;
  /**
   * Price-drift fingerprint (`md5(canonical_lines || '#' || subtotal)`), carried
   * from quote → place. This is NOT an authentication token: prices are public,
   * so anyone can recompute it. The server re-prices and re-validates everything
   * under the product locks regardless of whether this matches; the token only
   * lets place_order detect that prices moved between quote and submit and ask
   * the customer to re-confirm (`price_changed`). md5 is sufficient for that.
   */
  quote_token: string;
  zone: DeliveryZone;
}

/** Customer payload for api.place_order (name/phone/district/address required). */
export interface CheckoutCustomer {
  name: string;
  phone: string;
  district: string;
  address: string;
  email?: string;
  area?: string;
  /**
   * Level 3 of the address hierarchy — thana (metropolitan) or upazila (rural).
   *
   * Carried alongside the resolved ids because a Pathao booking needs
   * recipient_city / recipient_zone, and the zone IS the thana. Without these
   * the courier falls back to parsing the free-text address, which is what the
   * location work exists to stop.
   */
  thana?: string;
  districtId?: number;
  thanaId?: number;
  areaId?: number;
}

export interface PlaceOrderResult {
  order_id: string;
  order_no: string;
  status: string;
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  /** The coupon code actually consumed by the order, or null. */
  coupon: string | null;
  guest_token: string | null;
  replayed: boolean;
}

// ── Cart → quote lines ───────────────────────────────────────────────────────

/**
 * Trim a cart's custom-size map into a clean measurements object: drop entries
 * with an empty label or value, trim both sides. Returns undefined when nothing
 * meaningful remains, so a line with no real measurements carries none.
 */
export function normalizeMeasures(
  customSize: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!customSize) return undefined;
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(customSize)) {
    const key = rawKey.trim();
    const val = typeof rawVal === "string" ? rawVal.trim() : "";
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build place_order line inputs from the cart. CartItem.productId is the product
 * code. Made-to-measure items carry their measurements (from customSize); the
 * custom charge itself is server-priced via the 'Custom' size. Lines with a
 * non-positive qty are dropped. The cart is iterated in order so the resulting
 * line order is stable — quote and place share it, which the drift token needs.
 */
export function cartToPlaceLines(cart: CartItem[]): PlaceLineInput[] {
  const lines: PlaceLineInput[] = [];
  for (const item of cart) {
    const qty = Math.trunc(item.qty);
    if (!item.productId || qty < 1) continue;
    const measures = normalizeMeasures(item.customSize);
    lines.push({
      code: item.productId,
      ...(item.size ? { size: item.size } : {}),
      qty,
      ...(measures ? { measures } : {}),
    });
  }
  return lines;
}

/**
 * Quote lines are the place lines with measurements stripped — same code/size/
 * qty and order, so the quote_token computed here matches what place re-derives.
 * Measurements never reach the public quote RPC.
 */
export function cartToQuoteLines(cart: CartItem[]): QuoteLineInput[] {
  return cartToPlaceLines(cart).map(({ measures: _measures, ...line }) => line);
}

// ── Stable error codes → customer-facing messages ────────────────────────────

export const CHECKOUT_ERROR_MESSAGES: Record<string, string> = {
  out_of_stock: "Some items just sold out or don't have enough stock. Please review your cart.",
  price_changed: "Prices changed since you started. Please review the updated total and confirm.",
  product_not_purchasable:
    "An item in your cart is no longer available. Please remove it to continue.",
  invalid_qty: "An item has an invalid quantity. Please adjust it and try again.",
  empty_cart: "Your cart is empty.",
  invalid_address: "Please check your delivery details and try again.",
  invalid_payment_method: "That payment method isn't available right now.",
  idempotency_conflict:
    "This order is already being processed — please wait a moment before retrying.",
  invalid_coupon: "That coupon code isn't valid.",
  coupon_min_not_met: "Your cart doesn't meet this coupon's minimum spend.",
  coupon_exhausted: "This coupon has reached its usage limit.",
  coupon_not_eligible: "This coupon isn't available for this order.",
};

export const KNOWN_CHECKOUT_ERROR_CODES = new Set(Object.keys(CHECKOUT_ERROR_MESSAGES));

/**
 * Coupon rejection code → short, cart-friendly message. Reuses the shared error
 * copy but softens the phrasing for the inline coupon field (vs. a blocking
 * checkout error). Unknown reasons fall back to the generic invalid message.
 */
export const COUPON_REASON_MESSAGES: Record<string, string> = {
  invalid_coupon: "This code isn't valid.",
  coupon_min_not_met: "Cart doesn't meet the minimum for this code.",
  coupon_exhausted: "This code has reached its limit.",
  coupon_not_eligible: "This code isn't available for your order.",
};

export function couponReasonMessage(reason: string | null | undefined): string {
  if (!reason) return COUPON_REASON_MESSAGES.invalid_coupon;
  return COUPON_REASON_MESSAGES[reason] ?? COUPON_REASON_MESSAGES.invalid_coupon;
}

/** Normalize a coupon code to the canonical stored form (UPPERCASE, trimmed). */
export function normalizeCouponCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  return c.length > 0 ? c : null;
}

const GENERIC_CHECKOUT_ERROR =
  "Could not place your order. Please try again, or contact us on WhatsApp.";

export function checkoutErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_CHECKOUT_ERROR;
  return CHECKOUT_ERROR_MESSAGES[code] ?? GENERIC_CHECKOUT_ERROR;
}

// ── Idempotency ──────────────────────────────────────────────────────────────

/** A fresh idempotency key for one place-order attempt (safe retries). */
export function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback (older runtimes / tests without WebCrypto).
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Guest tracking token (client-generated capability) ───────────────────────

/**
 * A fresh guest tracking token: 32 random bytes as hex. The RAW token is a
 * capability the client keeps (localStorage + the success URL); ONLY its sha256
 * hash is ever sent to or stored by the server (see place_order's
 * p_guest_token_hash). It is never transmitted raw anywhere but the customer's
 * own browser, so the server can never leak or rotate it.
 */
export function newGuestToken(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const bytes = new Uint8Array(32);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lowercase hex sha256 of a string (Web Crypto; browsers + Node ≥ 20). */
export async function sha256Hex(input: string): Promise<string> {
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  const data = new TextEncoder().encode(input);
  const digest = await g.crypto!.subtle!.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Canonical fingerprint of a logical placement attempt. Two submits with the
 * same lines + customer + zone + method + coupon share ONE idempotency key and
 * ONE guest token (a safe replay that never duplicates the order); changing any
 * of them is a new attempt. Mirrors the server's request_hash inputs so a
 * same-signature retry always matches the stored hash rather than conflicting.
 */
export function placementSignature(input: {
  lines: PlaceLineInput[];
  customer: CheckoutCustomer;
  zone: string;
  method: string;
  coupon?: string | null;
}): string {
  return JSON.stringify({
    lines: input.lines,
    customer: input.customer,
    zone: input.zone,
    method: input.method,
    coupon: normalizeCouponCode(input.coupon),
  });
}

// ── Server-fn input validation (zod; mirrors the RPC argument bounds) ─────────

const lineSchema = z.object({
  code: z.string().min(1).max(64),
  size: z.string().min(1).max(40).optional(),
  qty: z.number().int().min(1).max(50),
});

/**
 * Per-line measurements: label → value, both bounded, capped at 20 fields.
 * The bounds keep the serialized object well under the DB shape CHECK
 * (pg_column_size <= 8192) so a valid order never trips it.
 */
const measuresSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(120))
  .refine((m) => Object.keys(m).length <= 20, "Too many measurement fields.");

/** A place_order line = quote line + optional made-to-measure measurements. */
const placeLineSchema = lineSchema.extend({
  measures: measuresSchema.optional(),
});

/** A coupon code field: optional, bounded, normalized to the stored form. */
const couponCodeSchema = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(40).optional(),
  )
  .optional();

/** Validator for quoteOrderFn. */
export const quoteOrderSchema = z.object({
  lines: z.array(lineSchema).min(1).max(50),
  zone: z.enum(DELIVERY_ZONE_VALUES),
  coupon: couponCodeSchema,
});

/** Customer details for placeOrderFn (name/phone/district/address required). */
export const checkoutCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().regex(BD_PHONE_RE, "Enter a valid Bangladesh mobile number."),
  district: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(500),
  email: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().email().max(200).optional(),
    )
    .optional(),
  area: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(200).optional(),
    )
    .optional(),
  // Level 3 + resolved ids. All optional: an order placed without them still
  // succeeds and the courier falls back to auto-address, so a location lookup
  // failure can never block a sale.
  thana: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(200).optional(),
    )
    .optional(),
  districtId: z.number().int().positive().optional(),
  thanaId: z.number().int().positive().optional(),
  areaId: z.number().int().positive().optional(),
});

/** Validator for placeOrderFn. */
export const placeOrderSchema = z.object({
  lines: z.array(placeLineSchema).min(1).max(50),
  customer: checkoutCustomerSchema,
  zone: z.enum(DELIVERY_ZONE_VALUES),
  method: z.enum(["cod", "bkash", "nagad"]),
  idempotencyKey: z.string().min(1).max(200),
  quoteToken: z.string().min(1).max(64).optional(),
  coupon: couponCodeSchema,
  /** sha256 hex of the client-held guest token; required for guest checkout. */
  guestTokenHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Malformed guest token hash.")
    .optional(),
});

export type QuoteOrderInput = z.infer<typeof quoteOrderSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
