// Frontend-only helpers to normalize and merge order data for the customer UI.
// Two incompatible sources exist:
//  - seeded `Order` objects from src/lib/orders.ts (demo records)
//  - checkout-created objects stored in localStorage under "nongorr_orders"
// This module produces one safe display type (UIOrder) used by all order routes.

import { ORDERS, type Order, type OrderStatus } from "@/lib/orders";
import { PRODUCTS, requiresSelection, type Product } from "@/lib/products";
import { isDemoCommerceEnabled } from "@/lib/checkout-mode";

export interface UIOrderItem {
  productId?: string;
  name: string;
  image: string;
  qty: number;
  price: number;
  size?: string;
  customSize?: Record<string, string>;
  customCharge?: number;
}

export interface UIOrder {
  id: string;
  date: string;
  status: OrderStatus;
  customerName: string;
  phone: string;
  district: string;
  locality?: string;
  address: string;
  items: UIOrderItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  trxId: string;
  paymentStatus: "Pending" | "Verified" | "Rejected";
  deliveryZone?: string;
  couponCode?: string | null;
  orderNote?: string;
  deliveryNote?: string;
  screenshotAttached?: boolean;
  screenshotFileName?: string;
  courier?: string;
  trackingId?: string;
  source: "demo" | "device";
}

// ---- Customer-facing six-step timeline --------------------------------------

export const CUSTOMER_ORDER_STEPS = [
  "Order submitted",
  "Payment verification pending",
  "Payment verified",
  "Preparing order",
  "Courier booked",
  "Delivered",
] as const;

export type CustomerStep = (typeof CUSTOMER_ORDER_STEPS)[number];

export const EXCEPTION_STATUSES: OrderStatus[] = [
  "Cancelled",
  "Returned",
  "Refund Pending",
  "Refund Done",
];

const STATUS_TO_STEP: Partial<Record<OrderStatus, CustomerStep>> = {
  "New Order": "Order submitted",
  "Payment Pending": "Payment verification pending",
  "Payment Verified": "Payment verified",
  Confirmed: "Payment verified",
  Processing: "Preparing order",
  "Courier Booked": "Courier booked",
  Shipped: "Courier booked",
  Delivered: "Delivered",
  Completed: "Delivered",
};

export function isExceptionStatus(status: OrderStatus): boolean {
  return EXCEPTION_STATUSES.includes(status);
}

// Returns the index of the current customer step, or -1 for exception statuses
// (which should be rendered via a separate exception panel, not the timeline).
export function customerStepIndex(status: OrderStatus): number {
  const step = STATUS_TO_STEP[status];
  if (!step) return -1;
  return CUSTOMER_ORDER_STEPS.indexOf(step);
}

// ---- Safe value coercion ----------------------------------------------------

function safeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function safeNum(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

const VALID_PAYMENT: UIOrder["paymentStatus"][] = ["Pending", "Verified", "Rejected"];

// Derive a cautious payment status when none is explicitly stored.
function derivePaymentStatus(status: OrderStatus): UIOrder["paymentStatus"] {
  if (status === "New Order" || status === "Payment Pending") return "Pending";
  if (isExceptionStatus(status)) return "Pending";
  // Payment Verified or later normal fulfilment status
  return "Verified";
}

function normalizeItem(raw: unknown): UIOrderItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = safeStr(o.name);
  const image = safeStr(o.image);
  if (!name && !image) return null;
  const customSize =
    o.customSize && typeof o.customSize === "object" && !Array.isArray(o.customSize)
      ? (o.customSize as Record<string, string>)
      : undefined;
  return {
    productId: typeof o.productId === "string" ? o.productId : undefined,
    name: name || "Item",
    image,
    qty: Math.max(1, safeInt(o.qty, 1)),
    price: Math.max(0, safeNum(o.price, 0)),
    size: typeof o.size === "string" ? o.size : undefined,
    customSize,
    customCharge: o.customCharge != null ? Math.max(0, safeNum(o.customCharge, 0)) : undefined,
  };
}

// Normalize a single localStorage (device) order. Returns null if unusable.
function normalizeDeviceOrder(raw: unknown): UIOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = safeStr(o.id);
  if (!id) return null;

  const status = (safeStr(o.status) || "Payment Pending") as OrderStatus;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items = itemsRaw.map(normalizeItem).filter((i): i is UIOrderItem => i !== null);

  const storedPayment = safeStr(o.paymentStatus) as UIOrder["paymentStatus"];
  const paymentStatus = VALID_PAYMENT.includes(storedPayment)
    ? storedPayment
    : derivePaymentStatus(status);

  return {
    id,
    date: safeStr(o.date),
    status,
    customerName: safeStr(o.customerName),
    phone: safeStr(o.phone),
    district: safeStr(o.district),
    locality: typeof o.locality === "string" ? o.locality : undefined,
    address: safeStr(o.address),
    items,
    subtotal: Math.max(0, safeNum(o.subtotal, 0)),
    shipping: Math.max(0, safeNum(o.shipping, 0)),
    discount: Math.max(0, safeNum(o.discount, 0)),
    total: Math.max(0, safeNum(o.total, 0)),
    trxId: safeStr(o.trxId),
    paymentStatus,
    deliveryZone: typeof o.deliveryZone === "string" ? o.deliveryZone : undefined,
    couponCode: typeof o.couponCode === "string" ? o.couponCode : null,
    orderNote: typeof o.orderNote === "string" ? o.orderNote : undefined,
    deliveryNote: typeof o.deliveryNote === "string" ? o.deliveryNote : undefined,
    screenshotAttached:
      typeof o.screenshotAttached === "boolean" ? o.screenshotAttached : undefined,
    screenshotFileName: typeof o.screenshotFileName === "string" ? o.screenshotFileName : undefined,
    courier: typeof o.courier === "string" ? o.courier : undefined,
    trackingId: typeof o.trackingId === "string" ? o.trackingId : undefined,
    source: "device",
  };
}

// ---- localStorage readers/writer (browser-only, per-user scoped) ------------
//
// Device orders carry PII (name, phone, address), so they are partitioned per
// signed-in user. `scope` is the verified auth user id, or "guest" for a guest
// checkout. The legacy unscoped keys below predate namespacing and are never
// read; purgeLegacyOrderKeys() removes them so they cannot bleed across accounts.

const ORDERS_KEY = "nongorr_orders";
const LAST_ORDER_KEY = "nongorr_last_order";

/** Map a (possibly absent) user id to a storage scope. */
export function orderScope(userId: string | null | undefined): string {
  return userId && userId.length > 0 ? userId : "guest";
}

function ordersKey(scope: string): string {
  return `${ORDERS_KEY}::u:${scope}`;
}
function lastOrderKey(scope: string): string {
  return `${LAST_ORDER_KEY}::u:${scope}`;
}

export function purgeLegacyOrderKeys(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ORDERS_KEY);
    window.localStorage.removeItem(LAST_ORDER_KEY);
  } catch {
    // ignore
  }
}

export function readStoredOrders(scope: string): UIOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ordersKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeDeviceOrder).filter((o): o is UIOrder => o !== null);
  } catch {
    return [];
  }
}

export function readLastStoredOrder(scope: string): UIOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastOrderKey(scope));
    if (!raw) return null;
    return normalizeDeviceOrder(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist a freshly-created (demo) order under the user's partition. */
export function storeDeviceOrder(scope: string, order: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastOrderKey(scope), JSON.stringify(order));
    const raw = window.localStorage.getItem(ordersKey(scope));
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.unshift(order);
    window.localStorage.setItem(ordersKey(scope), JSON.stringify(list));
  } catch {
    // ignore storage failures in the demo flow
  }
}

// ---- Seed normalization + merge ---------------------------------------------

export function normalizeSeedOrder(o: Order): UIOrder {
  return {
    id: o.id,
    date: o.date,
    status: o.status,
    customerName: o.customer,
    phone: o.phone,
    district: o.district,
    locality: undefined,
    address: o.address,
    items: o.items.map((i) => ({
      productId: undefined,
      name: i.name,
      image: i.image,
      qty: Math.max(1, safeInt(i.qty, 1)),
      price: Math.max(0, safeNum(i.price, 0)),
      size: i.size,
      customSize: undefined,
      customCharge: undefined,
    })),
    subtotal: o.subtotal,
    shipping: o.shipping,
    discount: 0,
    total: o.total,
    trxId: o.trxId,
    paymentStatus: o.paymentStatus,
    deliveryZone: undefined,
    couponCode: null,
    orderNote: o.note,
    deliveryNote: undefined,
    screenshotAttached: undefined,
    screenshotFileName: undefined,
    courier: o.courier,
    trackingId: o.trackingId,
    source: "demo",
  };
}

// Parse ISO timestamps and date-only values; invalid dates sort last.
function dateValue(date: string): number {
  if (!date) return -Infinity;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : -Infinity;
}

export function mergeOrders(demoOrders: Order[], deviceOrders: UIOrder[]): UIOrder[] {
  const byId = new Map<string, UIOrder>();
  for (const o of demoOrders) byId.set(o.id, normalizeSeedOrder(o));
  // device orders override demo orders with the same id
  for (const o of deviceOrders) byId.set(o.id, o);
  return Array.from(byId.values()).sort((a, b) => dateValue(b.date) - dateValue(a.date));
}

// Convenience: full merged list. The built-in seed ORDERS are fabricated demo
// records (with names/phones/addresses) and must NEVER appear in a real
// customer's order list — they are included only when demo commerce is enabled
// (dev / explicit preview). In production the list reflects device orders only.
export function buildOrderList(deviceOrders: UIOrder[]): UIOrder[] {
  const seed = isDemoCommerceEnabled() ? ORDERS : [];
  return mergeOrders(seed, deviceOrders);
}

// ---- Phone normalization ----------------------------------------------------

export function normalizeBDPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("880")) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.length === 10 && digits.startsWith("1")) {
    digits = `0${digits}`;
  }
  return digits;
}

export function isValidBDPhone(input: string): boolean {
  return /^01[3-9]\d{8}$/.test(normalizeBDPhone(input));
}

// ---- Canonical measurement schema -------------------------------------------
// One internal schema bridges the PDP's legacy display keys ("Kurti Length")
// and account profile keys ("dressLength"). Pure data — no React imports, so
// it stays dependency-safe for account-ui.tsx to consume.

export type CanonicalMeasurementKey =
  | "bust"
  | "waist"
  | "hip"
  | "shoulder"
  | "sleeve"
  | "kurtiLength";

export const CANONICAL_MEASUREMENT_KEYS: CanonicalMeasurementKey[] = [
  "bust",
  "waist",
  "hip",
  "shoulder",
  "sleeve",
  "kurtiLength",
];

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

const MEASURE_LABELS: Record<string, string> = {
  bust: "Bust",
  waist: "Waist",
  hip: "Hip",
  shoulder: "Shoulder",
  sleeve: "Sleeve",
  length: "Kurti length",
  kurtiLength: "Kurti length",
  kurti_length: "Kurti length",
  dressLength: "Kurti length",
};

export function measurementLabel(key: string): string {
  const canonical = toCanonicalMeasurementKey(key);
  if (canonical && MEASURE_LABELS[canonical]) return MEASURE_LABELS[canonical];
  if (MEASURE_LABELS[key]) return MEASURE_LABELS[key];
  // camelCase / snake_case → Title Case
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

// Append inches only to numeric measurement values, never to arbitrary text.
export function measurementValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "—";
  return /^\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}″` : trimmed;
}

// ---- Reorder ----------------------------------------------------------------

export interface ReorderCartItem {
  productId: string;
  name: string;
  image: string;
  price: number;
  qty: number;
  size?: string;
  customSize?: Record<string, string>;
  customCharge?: number;
}

type AddToCartFn = (item: ReorderCartItem) => void;

// Resolve a product for reorder: by productId, then exact name match. Never positions.
function resolveReorderProduct(item: UIOrderItem): Product | undefined {
  if (item.productId) {
    const byId = PRODUCTS.find((p) => p.id === item.productId);
    if (byId) return byId;
  }
  return PRODUCTS.find((p) => p.name.toLowerCase() === item.name.toLowerCase());
}

export function reorderItems(
  order: UIOrder,
  addToCart: AddToCartFn,
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;

  for (const item of order.items) {
    const product = resolveReorderProduct(item);
    if (!product || product.stock <= 0) {
      skipped++;
      continue;
    }
    const currentPrice = product.salePrice ?? product.price;
    const hasCustom = Boolean(item.customSize && Object.keys(item.customSize).length > 0);

    // Validate ready size availability where sizeStock is known.
    if (item.size && product.sizeStock) {
      const stock = product.sizeStock[item.size];
      if (stock == null || stock <= 0) {
        skipped++;
        continue;
      }
    }

    // A product requiring selection must carry a valid stored size or custom measurements.
    if (requiresSelection(product) && !item.size && !hasCustom) {
      skipped++;
      continue;
    }

    addToCart({
      productId: product.id,
      name: product.name,
      image: product.image,
      price: currentPrice,
      qty: Math.max(1, item.qty),
      size: item.size,
      customSize: hasCustom ? item.customSize : undefined,
      customCharge: hasCustom ? item.customCharge : undefined,
    });
    added++;
  }

  return { added, skipped };
}
