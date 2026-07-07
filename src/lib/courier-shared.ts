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

// ── Courier status labels (per provider) ─────────────────────────────────────

/** Map raw courier status to human-readable label. */
export const STEADFAST_STATUS_LABELS: Record<string, string> = {
  in_review: "In review",
  pending: "Pending",
  delivered: "Delivered",
  partial_delivered: "Partially delivered",
  cancelled: "Cancelled",
  unknown: "Unknown",
  hold: "On hold",
  in_transit: "In transit",
  // SteadFast-specific
  delivered_to_warehouse: "At warehouse",
};

export const PATHAO_STATUS_LABELS: Record<string, string> = {
  Pending: "Pending",
  "Pickup Assigned": "Pickup assigned",
  "Picked Up": "Picked up",
  "At the Sorting HUB": "At sorting hub",
  "In Transit": "In transit",
  "Out for Delivery": "Out for delivery",
  Delivered: "Delivered",
  "Partial Delivery": "Partially delivered",
  "Payment Invoice": "Payment invoice",
  Exchange: "Exchange",
  Hold: "On hold",
  Return: "Returning",
  "Returned To Merchant": "Returned to merchant",
  Cancelled: "Cancelled",
};

/** Map raw provider status to internal shipment status. */
export function mapCourierStatusToInternal(
  provider: string,
  rawStatus: string,
): string | null {
  const normalized = rawStatus.toLowerCase().replace(/[\s_-]+/g, "_");

  if (provider === "steadfast") {
    switch (normalized) {
      case "delivered":
        return "delivered";
      case "in_transit":
        return "in_transit";
      case "cancelled":
      case "returned":
        return "returned_to_merchant";
      default:
        return null; // unknown — logged, no order transition
    }
  }

  if (provider === "pathao") {
    switch (normalized) {
      case "picked_up":
        return "picked_up";
      case "in_transit":
      case "at_the_sorting_hub":
        return "in_transit";
      case "out_for_delivery":
        return "out_for_delivery";
      case "delivered":
        return "delivered";
      case "return":
      case "returned_to_merchant":
        return "returned_to_merchant";
      case "cancelled":
        return "returned_to_merchant";
      default:
        return null;
    }
  }

  return null;
}

/** Get a friendly label for any courier status. */
export function courierStatusLabel(provider: string, rawStatus: string): string {
  if (provider === "steadfast") return STEADFAST_STATUS_LABELS[rawStatus] ?? rawStatus;
  if (provider === "pathao") return PATHAO_STATUS_LABELS[rawStatus] ?? rawStatus;
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
  return due > 0
    ? { mode: "partial_cod", codAmount: due }
    : { mode: "prepaid", codAmount: 0 };
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
    friendlyStatus: courierStatus
      ? courierStatusLabel(provider, courierStatus)
      : "Booked",
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
  payment_not_verified: "Payment must be verified before courier booking.",
  manual_tracking_required: "Manual shipments require a tracking code or reference.",
  actor_not_authorized: "You are not authorized to perform this action.",
};

export const KNOWN_COURIER_ERROR_CODES = new Set(Object.keys(COURIER_ERROR_MESSAGES));

const GENERIC_COURIER_ERROR = "Could not complete the courier operation. Please try again.";

export function courierErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_COURIER_ERROR;
  return COURIER_ERROR_MESSAGES[code] ?? GENERIC_COURIER_ERROR;
}
