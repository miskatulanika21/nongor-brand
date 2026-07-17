/**
 * Courier integration — isomorphic types, DTOs, Zod schemas, COD computation.
 *
 * NO server-only imports — safe for the browser bundle.
 * Shared between admin UI, customer views, and the server layer.
 */
import { z } from "zod";
import type { PaymentMethod } from "@/lib/checkout-shared";
import type { PaymentStatus } from "@/lib/orders-shared";

// ── Constants ────────────────────────────────────────────────────────────────

export const COURIER_PROVIDERS = ["steadfast", "pathao", "manual"] as const;
export type CourierProviderId = (typeof COURIER_PROVIDERS)[number];

export const SHIPMENT_KINDS = ["forward", "return", "exchange"] as const;
export type ShipmentKind = (typeof SHIPMENT_KINDS)[number];

export const BOOKING_STATUSES = ["pending", "success", "failed"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_COLLECTION_MODES = ["prepaid", "cod", "partial_cod"] as const;
export type PaymentCollectionMode = (typeof PAYMENT_COLLECTION_MODES)[number];

// ── Courier status vocabularies (per provider) ───────────────────────────────
//
// EVERY value below is transcribed from the providers' own published docs, not
// inferred. Do not add a status here because it "seems like one the courier
// would send" — an invented status silently never matches, which is exactly how
// the original picked_up / out_for_delivery / in_transit guesses broke the whole
// Pathao feed. Sources:
//   SteadFast: https://portal.packzy.com/api/v1 docs ("Delivery Statuses" table)
//              + merchant panel → Webhook Integration → Response Documentation
//   Pathao:    https://merchant.pathao.com/courier/developer-api → Webhook Integration

/**
 * SteadFast delivery statuses — the complete set (11) from the API doc's
 * "Delivery Statuses" table, returned by /status_by_cid|invoice|trackingcode.
 *
 * The webhook's delivery_status payload only ever carries the 5 settled ones
 * (pending, delivered, partial_delivered, cancelled, unknown); the
 * *_approval_pending states appear only when polling.
 */
export const STEADFAST_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  delivered_approval_pending: "Delivered — awaiting approval",
  partial_delivered_approval_pending: "Partially delivered — awaiting approval",
  cancelled_approval_pending: "Cancelled — awaiting approval",
  unknown_approval_pending: "Unknown — awaiting approval",
  delivered: "Delivered",
  partial_delivered: "Partially delivered",
  cancelled: "Cancelled",
  hold: "On hold",
  in_review: "In review",
  unknown: "Unknown",
};

/**
 * Pathao webhook event slugs — the complete set (24), harvested from the sample
 * payload of every event in the Webhook Integration doc.
 *
 * The status travels in the payload's `event` field (e.g. "order.delivered"),
 * NOT in order_status/status — reading those yields undefined for every event.
 * Slugs are dot-and-kebab (`order.delivery-failed`), and several are genuinely
 * unguessable: "Payment Invoice" is order.paid, "Exchange" is order.exchanged.
 */
export const PATHAO_EVENT_LABELS: Record<string, string> = {
  "order.created": "Order created",
  "order.updated": "Order updated",
  "order.pickup-requested": "Pickup requested",
  "order.assigned-for-pickup": "Assigned for pickup",
  "order.picked": "Picked up",
  "order.pickup-failed": "Pickup failed",
  "order.pickup-cancelled": "Pickup cancelled",
  "order.at-the-sorting-hub": "At sorting hub",
  "order.in-transit": "In transit",
  "order.received-at-last-mile-hub": "At last-mile hub",
  "order.assigned-for-delivery": "Out for delivery",
  "order.delivered": "Delivered",
  "order.partial-delivery": "Partially delivered",
  "order.returned": "Return initiated",
  "order.delivery-failed": "Delivery failed",
  "order.on-hold": "On hold",
  "order.paid": "Payment invoiced",
  "order.paid-return": "Paid return",
  "order.exchanged": "Exchange",
  "store.created": "Store created",
  "store.updated": "Store updated",
  "order.return-id-created": "Return ID created",
  "order.return-in-transit": "Return in transit",
  "order.returned-to-merchant": "Returned to merchant",
};

/**
 * Pathao `order_status` display names → event slug.
 *
 * The polling endpoint (/orders/{cid}/info) reports human display names
 * ("Pending"), while the webhook reports slugs ("order.created"). Both funnel
 * through mapCourierStatusToInternal, so both spellings must resolve.
 */
const PATHAO_DISPLAY_TO_EVENT: Record<string, string> = {
  "order created": "order.created",
  "order updated": "order.updated",
  pending: "order.created",
  "pickup requested": "order.pickup-requested",
  "assigned for pickup": "order.assigned-for-pickup",
  // "Pickup" — Pathao's label for the picked event. NOT "Picked Up": that
  // spelling is our old invention and must stay unmapped.
  pickup: "order.picked",
  "pickup failed": "order.pickup-failed",
  "pickup cancelled": "order.pickup-cancelled",
  "at the sorting hub": "order.at-the-sorting-hub",
  "in transit": "order.in-transit",
  "received at last mile hub": "order.received-at-last-mile-hub",
  "assigned for delivery": "order.assigned-for-delivery",
  delivered: "order.delivered",
  "partial delivery": "order.partial-delivery",
  return: "order.returned",
  "delivery failed": "order.delivery-failed",
  "on hold": "order.on-hold",
  "payment invoice": "order.paid",
  "paid return": "order.paid-return",
  exchange: "order.exchanged",
  "return id created": "order.return-id-created",
  "return in transit": "order.return-in-transit",
  "returned to merchant": "order.returned-to-merchant",
};

/**
 * Friendly labels for our canonical INTERNAL shipment statuses (what we store).
 *
 * Only six of these move the order, per api.update_shipment_status:
 *   picked_up | in_transit | out_for_delivery → shipped
 *   delivered                                 → delivered
 *   failed                                    → delivery_failed
 *   returned_to_merchant                      → nothing (admin decides)
 * Every other value is recorded as a shipment_event for the timeline and leaves
 * the order untouched. Note the transition key is `failed`, NOT `delivery_failed`
 * — mapping a courier's failure to `delivery_failed` records an event that never
 * transitions the order.
 */
export const INTERNAL_STATUS_LABELS: Record<string, string> = {
  booked: "Booked",
  updated: "Updated",
  pending: "Pending",
  in_review: "In review",
  pickup_requested: "Pickup requested",
  pickup_assigned: "Assigned for pickup",
  picked_up: "Picked up",
  pickup_failed: "Pickup failed",
  pickup_cancelled: "Pickup cancelled",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  failed: "Delivery failed",
  delivery_failed: "Delivery failed",
  on_hold: "On hold",
  return_initiated: "Return initiated",
  return_id_created: "Return ID created",
  return_in_transit: "Return in transit",
  returned_to_merchant: "Returned to merchant",
  paid: "Payment invoiced",
  paid_return: "Paid return",
  exchanged: "Exchange",
  tracking_update: "Tracking update",
  unknown: "Unknown",
  delivered_approval_pending: "Delivered — awaiting approval",
  partial_delivered_approval_pending: "Partially delivered — awaiting approval",
  cancelled_approval_pending: "Cancelled — awaiting approval",
  unknown_approval_pending: "Unknown — awaiting approval",
};

/** Pathao event slug → our canonical internal status. */
const PATHAO_EVENT_TO_INTERNAL: Record<string, string | null> = {
  "order.created": "booked",
  "order.updated": "updated",
  "order.pickup-requested": "pickup_requested",
  "order.assigned-for-pickup": "pickup_assigned",
  "order.picked": "picked_up",
  "order.pickup-failed": "pickup_failed",
  "order.pickup-cancelled": "pickup_cancelled",
  "order.at-the-sorting-hub": "in_transit",
  "order.in-transit": "in_transit",
  "order.received-at-last-mile-hub": "in_transit",
  "order.assigned-for-delivery": "out_for_delivery",
  "order.delivered": "delivered",
  // Pathao bills a partial delivery as completed — money collected, parcel handed over.
  "order.partial-delivery": "delivered",
  "order.returned": "return_initiated",
  "order.delivery-failed": "failed",
  "order.on-hold": "on_hold",
  "order.paid": "paid",
  "order.paid-return": "paid_return",
  "order.exchanged": "exchanged",
  "order.return-id-created": "return_id_created",
  "order.return-in-transit": "return_in_transit",
  "order.returned-to-merchant": "returned_to_merchant",
  // Store lifecycle events are account-level, not shipment-level: they carry no
  // consignment_id and must never touch an order.
  "store.created": null,
  "store.updated": null,
};

/** SteadFast delivery_status → our canonical internal status. */
const STEADFAST_STATUS_TO_INTERNAL: Record<string, string | null> = {
  pending: "pending",
  in_review: "in_review",
  hold: "on_hold",
  delivered: "delivered",
  // Balance is added for partial delivery too — treat as delivered, like Pathao.
  partial_delivered: "delivered",
  cancelled: "returned_to_merchant",
  unknown: "unknown",
  // *_approval_pending: SteadFast has delivered/cancelled the parcel but has not
  // settled the balance. Record for the timeline; do NOT transition the order —
  // the outcome can still flip during admin review.
  delivered_approval_pending: "delivered_approval_pending",
  partial_delivered_approval_pending: "partial_delivered_approval_pending",
  cancelled_approval_pending: "cancelled_approval_pending",
  unknown_approval_pending: "unknown_approval_pending",
};

// ── Webhook auth helpers ─────────────────────────────────────────────────────
//
// Pure and isomorphic so they can be unit-tested directly; the route handlers
// are thin wrappers around them.

/**
 * The fixed constant Pathao requires echoed back in the
 * X-Pathao-Merchant-Webhook-Integration-Secret response header during webhook
 * registration. Published in their docs — a handshake token, not a secret.
 */
export const PATHAO_INTEGRATION_SECRET = "f3992ecc-59da-4cbe-a049-a13da2018d51";

/**
 * Extract the token from an `Authorization: Bearer <token>` header.
 *
 * SteadFast authenticates its webhooks this way — the token is the value entered
 * as "Auth Token(Bearer)" in the merchant panel. Returns "" when the header is
 * missing or is not a Bearer credential, which then fails the constant-time
 * comparison at the call site.
 */
export function extractBearerToken(authHeader: string | null | undefined): string {
  if (!authHeader) return "";
  const match = /^\s*bearer\s+(.+)$/i.exec(authHeader);
  return match ? match[1].trim() : "";
}

/**
 * Is this Pathao's webhook-registration probe rather than a real event?
 *
 * Pathao POSTs `{ event: "webhook_integration" }` when you click "Add Webhook"
 * and only accepts the URL if it answers 202 with the integration-secret header.
 * The probe carries no X-PATHAO-Signature, so it must be detected before the
 * signature check.
 */
export function isPathaoIntegrationProbe(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).event === "webhook_integration"
  );
}

/**
 * Stable idempotency key for an inbound webhook: SHA-256 of the RAW request body.
 *
 * A provider retry sends a byte-identical body → identical id → deduped by the
 * webhook_events UNIQUE(provider, event_id). A genuinely different event has a
 * different body → new id → processed. Replaces the old
 * `${provider}-${cid}-${status}-${Date.now()}` scheme, whose clock made every
 * retry look unique and defeated dedup entirely.
 */
export async function webhookEventId(provider: string, rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${provider}:${hex}`;
}

/**
 * Map a raw provider status to our canonical INTERNAL shipment status.
 *
 * Returns null only for truly unknown statuses (logged, no state change). Known
 * but non-transitioning statuses (on_hold / in_review / pending) are returned so
 * they get RECORDED as shipment events; api.update_shipment_status decides which
 * ones move the order (picked_up / in_transit / out_for_delivery → shipped;
 * delivered; failed → delivery_failed; returned_to_merchant → admin decides).
 *
 * SteadFast has no pickup signal — its parcels go courier_booked → delivered
 * directly (the RPC permits that), which is why callers must never assume a
 * "shipped" event will precede "delivered".
 */
export function mapCourierStatusToInternal(provider: string, rawStatus: string): string | null {
  const raw = rawStatus.trim().toLowerCase();
  if (!raw) return null;

  if (provider === "steadfast") {
    // SteadFast spells statuses in snake_case but the webhook example capitalises
    // them ("Delivered"), so collapse separators and case before lookup.
    return STEADFAST_STATUS_TO_INTERNAL[raw.replace(/[\s-]+/g, "_")] ?? null;
  }

  if (provider === "pathao") {
    // Webhooks send the dotted event slug; polling sends the display name.
    const slug = raw.includes(".") ? raw : PATHAO_DISPLAY_TO_EVENT[raw.replace(/[\s_-]+/g, " ")];
    return slug ? (PATHAO_EVENT_TO_INTERNAL[slug] ?? null) : null;
  }

  // manual (and any other) provider: no automatic status feed
  return null;
}

/**
 * Get a friendly label for a shipment status.
 *
 * Accepts either one of our internal canonical statuses (what shipments.courier_status
 * holds) or a raw provider status/event slug, so it stays correct for rows written
 * before the vocabulary was corrected.
 */
export function courierStatusLabel(provider: string, rawStatus: string): string {
  if (INTERNAL_STATUS_LABELS[rawStatus]) return INTERNAL_STATUS_LABELS[rawStatus];
  if (provider === "steadfast") return STEADFAST_STATUS_LABELS[rawStatus] ?? rawStatus;
  if (provider === "pathao") {
    const key = rawStatus.trim().toLowerCase();
    const slug = key.includes(".") ? key : PATHAO_DISPLAY_TO_EVENT[key.replace(/[\s_-]+/g, " ")];
    return (slug && PATHAO_EVENT_LABELS[slug]) || rawStatus;
  }
  return rawStatus;
}

// ── COD computation ──────────────────────────────────────────────────────────
//
// Currently Nongorr supports: cod | bkash | nagad (no partial payments).
// The function is written to accept verifiedPaidAmount so future partial
// payment or store credit support is a one-line change, not a rewrite.

export function computeCodAmount(
  paymentMethod: PaymentMethod,
  paymentStatus: PaymentStatus,
  orderTotal: number,
  verifiedPaidAmount: number = 0,
): { mode: PaymentCollectionMode; codAmount: number } {
  if (paymentMethod === "cod") {
    const due = Math.max(0, orderTotal - verifiedPaidAmount);
    return { mode: due < orderTotal ? "partial_cod" : "cod", codAmount: due };
  }
  // bKash / Nagad — must be verified
  if (paymentStatus === "verified") {
    return { mode: "prepaid", codAmount: 0 };
  }
  // Not verified yet — compute remaining due
  const due = Math.max(0, orderTotal - verifiedPaidAmount);
  return due > 0 ? { mode: "partial_cod", codAmount: due } : { mode: "prepaid", codAmount: 0 };
}

// ── Customer-safe shipment DTO ───────────────────────────────────────────────
//
// This is what the customer/guest sees. NEVER: raw payloads, fees, errors,
// admin notes, settlement refs, booking errors.

export interface CustomerShipmentInfo {
  /** Display name, e.g. "SteadFast". */
  provider: string;
  trackingCode: string | null;
  trackingUrl: string | null;
  /** Human label, e.g. "In transit". */
  friendlyStatus: string;
}

/** Build a customer-safe shipment info from admin data. */
export function toCustomerShipmentInfo(
  providerDisplayName: string,
  trackingCode: string | null,
  trackingUrlTemplate: string | null,
  courierStatus: string | null,
  provider: string,
): CustomerShipmentInfo {
  const trackingUrl =
    trackingUrlTemplate && trackingCode
      ? trackingUrlTemplate.replace("{code}", encodeURIComponent(trackingCode))
      : null;

  return {
    provider: providerDisplayName,
    trackingCode,
    trackingUrl,
    friendlyStatus: courierStatus ? courierStatusLabel(provider, courierStatus) : "Booked",
  };
}

// ── Admin shipment DTOs (camelCase from snake_case RPC) ──────────────────────

export interface ShipmentRow {
  id: string;
  orderId: string;
  provider: CourierProviderId;
  providerName: string;
  trackingUrlTemplate: string | null;
  shipmentKind: ShipmentKind;
  bookingStatus: BookingStatus;
  bookingError: string | null;
  attemptNo: number;
  pendingExpiresAt: string | null;
  consignmentId: string | null;
  trackingCode: string | null;
  courierStatus: string | null;
  paymentCollectionMode: PaymentCollectionMode;
  codAmount: number;
  courierFee: number | null;
  returnFee: number | null;
  codCollectedAt: string | null;
  codSettledAt: string | null;
  settlementReference: string | null;
  netReceivable: number | null;
  createdBy: string | null;
  createdAt: string;
  bookedAt: string | null;
  updatedAt: string;
  cancelledAt: string | null;
  parentShipmentId: string | null;
  returnReason: string | null;
  events: ShipmentEventRow[];
}

export interface ShipmentEventRow {
  id: number;
  shipmentId: string;
  status: string;
  source: string;
  receivedAt: string;
  // raw_payload intentionally omitted from this DTO — admin can access via full API
}

export interface CourierProviderRow {
  id: CourierProviderId;
  displayName: string;
  enabled: boolean;
  trackingUrlTemplate: string | null;
  defaultWeightKg: number;
  defaultServiceType: string | null;
  sandboxEnabled: boolean;
}

// ── Zod schemas for API input ────────────────────────────────────────────────

const uuid = z.string().uuid();

export const bookCourierSchema = z.object({
  orderId: uuid,
  provider: z.enum(COURIER_PROVIDERS),
  trackingCode: z.string().trim().min(2).max(100).optional(),
  note: z.string().max(500).optional(),
});

export const cancelShipmentSchema = z.object({
  shipmentId: uuid,
  reason: z.string().trim().max(500).optional(),
});

export const resolveStaleSchema = z.object({
  shipmentId: uuid,
});

export const pollStatusSchema = z.object({
  shipmentId: uuid,
});

export const reconciliationSchema = z.object({
  shipmentId: uuid,
  courierFee: z.number().min(0).optional(),
  returnFee: z.number().min(0).optional(),
  codCollectedAt: z.string().datetime().optional(),
  codSettledAt: z.string().datetime().optional(),
  settlementRef: z.string().trim().max(200).optional(),
});

export const listShipmentsSchema = z.object({
  orderId: uuid,
});

export type BookCourierInput = z.infer<typeof bookCourierSchema>;
export type CancelShipmentInput = z.infer<typeof cancelShipmentSchema>;
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;

// ── Error codes ──────────────────────────────────────────────────────────────

export const COURIER_ERROR_MESSAGES: Record<string, string> = {
  provider_not_configured: "This courier is not configured. Check server environment.",
  invalid_provider: "Unknown or disabled courier provider.",
  order_not_found: "Order not found.",
  invalid_transition: "Order is not in a state that allows courier booking.",
  shipment_not_found: "Shipment record not found.",
  invalid_booking_state: "Shipment is not in the expected state for this action.",
  booking_not_stale: "This booking attempt has not expired yet.",
  double_booking: "An active forward shipment already exists for this order.",
  booking_in_progress:
    "This booking is already being processed. Refresh in a moment to see the result.",
  payment_not_verified: "Payment must be verified before courier booking.",
  manual_tracking_required: "Manual shipments require a tracking code or reference.",
  empty_courier_reference:
    "The courier accepted the booking but returned no tracking reference. Please retry.",
  actor_not_authorized: "You are not authorized to perform this action.",
};

export const KNOWN_COURIER_ERROR_CODES = new Set(Object.keys(COURIER_ERROR_MESSAGES));

const GENERIC_COURIER_ERROR = "Could not complete the courier operation. Please try again.";

export function courierErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_COURIER_ERROR;
  return COURIER_ERROR_MESSAGES[code] ?? GENERIC_COURIER_ERROR;
}
