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
 *   - Coupons/discounts are not handled yet (discount is always 0; P5).
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
  available?: number;
  visible: boolean;
  found: boolean;
}

export interface QuoteResult {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
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
}

export interface PlaceOrderResult {
  order_id: string;
  order_no: string;
  status: string;
  subtotal: number;
  shipping_fee: number;
  total: number;
  guest_token: string | null;
  replayed: boolean;
}

// ── Cart → quote lines ───────────────────────────────────────────────────────

/**
 * Build RPC line inputs from the cart. CartItem.productId is the product code.
 * Custom-size items carry no ready `size`; they quote at the server base price
 * (the custom charge is not yet server-priced — handled separately in P3b UI).
 * Lines with a non-positive qty are dropped.
 */
export function cartToQuoteLines(cart: CartItem[]): QuoteLineInput[] {
  const lines: QuoteLineInput[] = [];
  for (const item of cart) {
    const qty = Math.trunc(item.qty);
    if (!item.productId || qty < 1) continue;
    lines.push({
      code: item.productId,
      ...(item.size ? { size: item.size } : {}),
      qty,
    });
  }
  return lines;
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
};

export const KNOWN_CHECKOUT_ERROR_CODES = new Set(Object.keys(CHECKOUT_ERROR_MESSAGES));

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

// ── Server-fn input validation (zod; mirrors the RPC argument bounds) ─────────

const lineSchema = z.object({
  code: z.string().min(1).max(64),
  size: z.string().min(1).max(40).optional(),
  qty: z.number().int().min(1).max(50),
});

/** Validator for quoteOrderFn. */
export const quoteOrderSchema = z.object({
  lines: z.array(lineSchema).min(1).max(50),
  zone: z.enum(DELIVERY_ZONE_VALUES),
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
});

/** Validator for placeOrderFn. */
export const placeOrderSchema = z.object({
  lines: z.array(lineSchema).min(1).max(50),
  customer: checkoutCustomerSchema,
  zone: z.enum(DELIVERY_ZONE_VALUES),
  method: z.enum(["cod", "bkash", "nagad"]),
  idempotencyKey: z.string().min(1).max(200),
  quoteToken: z.string().min(1).max(64).optional(),
});

export type QuoteOrderInput = z.infer<typeof quoteOrderSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
