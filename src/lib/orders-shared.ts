/**
 * Order status model — the SINGLE isomorphic source of truth for the order
 * lifecycle, shared by the admin board, the customer views, and checkout.
 *
 * NO server-only imports — safe for the browser bundle. The 15-status union and
 * the allowed-transition map mirror the DB CHECK + api.transition_order() state
 * machine exactly; a parity test (orders-shared.test.ts) fails if they drift.
 *
 * This replaces the legacy mock vocabulary in src/lib/orders.ts ("New Order",
 * "Payment Pending", …), which is retired as the customer views are rewired.
 */
import { z } from "zod";
import type { PaymentMethod } from "@/lib/checkout-shared";

// ── The 15 statuses (DB CHECK order) ─────────────────────────────────────────

export const ORDER_STATUSES = [
  "pending_payment",
  "payment_submitted",
  "payment_rejected",
  "pending_confirmation",
  "confirmed",
  "processing",
  "ready_to_ship",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "expired",
  "returned",
  "refund_pending",
  "refund_done",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Type guard for an untrusted status string coming back from the DB/RPC. */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export type PaymentStatus = "pending" | "verified" | "rejected";

// ── Lanes + presentation metadata ────────────────────────────────────────────

/** Operational grouping for the admin board columns. */
export const ORDER_LANES = ["needs_action", "in_progress", "closed", "problem"] as const;
export type OrderLane = (typeof ORDER_LANES)[number];

export const ORDER_LANE_LABEL: Record<OrderLane, string> = {
  needs_action: "Needs action",
  in_progress: "In progress",
  closed: "Closed",
  problem: "Problem",
};

/** Abstract colour intent; the UI maps a tone to concrete classes. */
export type StatusTone = "amber" | "blue" | "violet" | "green" | "red" | "slate";

export interface OrderStatusMeta {
  /** Admin-facing label. */
  label: string;
  /** Softer customer-facing label. */
  customerLabel: string;
  tone: StatusTone;
  lane: OrderLane;
}

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  pending_payment: {
    label: "Pending payment",
    customerLabel: "Awaiting payment",
    tone: "amber",
    lane: "in_progress",
  },
  payment_submitted: {
    label: "Payment submitted",
    customerLabel: "Payment under review",
    tone: "blue",
    lane: "needs_action",
  },
  payment_rejected: {
    label: "Payment rejected",
    customerLabel: "Payment needs attention",
    tone: "red",
    lane: "problem",
  },
  pending_confirmation: {
    label: "Pending confirmation",
    customerLabel: "Awaiting confirmation",
    tone: "amber",
    lane: "needs_action",
  },
  confirmed: {
    label: "Confirmed",
    customerLabel: "Confirmed",
    tone: "blue",
    lane: "in_progress",
  },
  processing: {
    label: "Processing",
    customerLabel: "Preparing your order",
    tone: "blue",
    lane: "in_progress",
  },
  ready_to_ship: {
    label: "Ready to ship",
    customerLabel: "Ready to ship",
    tone: "blue",
    lane: "in_progress",
  },
  shipped: {
    label: "Shipped",
    customerLabel: "Shipped",
    tone: "violet",
    lane: "in_progress",
  },
  delivered: {
    label: "Delivered",
    customerLabel: "Delivered",
    tone: "green",
    lane: "in_progress",
  },
  completed: {
    label: "Completed",
    customerLabel: "Completed",
    tone: "green",
    lane: "closed",
  },
  cancelled: {
    label: "Cancelled",
    customerLabel: "Cancelled",
    tone: "slate",
    lane: "problem",
  },
  expired: {
    label: "Expired",
    customerLabel: "Expired",
    tone: "slate",
    lane: "problem",
  },
  returned: {
    label: "Returned",
    customerLabel: "Returned",
    tone: "amber",
    lane: "needs_action",
  },
  refund_pending: {
    label: "Refund pending",
    customerLabel: "Refund in progress",
    tone: "amber",
    lane: "needs_action",
  },
  refund_done: {
    label: "Refund done",
    customerLabel: "Refunded",
    tone: "slate",
    lane: "closed",
  },
};

export function orderStatusMeta(status: OrderStatus): OrderStatusMeta {
  return ORDER_STATUS_META[status];
}

// ── Allowed transitions (parity with api.transition_order) ───────────────────
//
// Each key's array must equal the CASE arm in 20260627210936_order_transition_rpc.
// Terminal states map to []. A test asserts this map matches the documented table.

export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["payment_submitted", "cancelled", "expired"],
  payment_submitted: ["confirmed", "payment_rejected", "cancelled", "expired"],
  payment_rejected: ["payment_submitted", "cancelled", "expired"],
  pending_confirmation: ["confirmed", "cancelled", "expired"],
  confirmed: ["processing", "cancelled"],
  processing: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["completed", "returned"],
  completed: ["returned"],
  cancelled: [],
  expired: [],
  returned: ["refund_pending"],
  refund_pending: ["refund_done"],
  refund_done: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ── Admin actions per status ─────────────────────────────────────────────────
//
// Which server fn drives each action. "transition" uses the generic
// transitionOrderFn (carries expected_version for optimistic concurrency); the
// others use the matching convenience RPC, which does not take a version.

export type OrderActionRpc =
  | "transition"
  | "verify_payment"
  | "reject_payment"
  | "confirm_cod"
  | "cancel"
  | "return";

export interface OrderAction {
  /** Stable key, unique within a status (for React keys + analytics). */
  key: string;
  label: string;
  rpc: OrderActionRpc;
  /** Target status for "transition" (and informational for the rest). */
  toStatus: OrderStatus;
  /** A reason input is required before the action can run. */
  requiresReason?: boolean;
  /** A reason input may be supplied but is optional. */
  optionalReason?: boolean;
  /** Offer a "restock items" toggle (return only). */
  allowsRestock?: boolean;
  /** Render with a destructive/confirm affordance. */
  destructive?: boolean;
}

const CANCEL_ACTION: OrderAction = {
  key: "cancel",
  label: "Cancel order",
  rpc: "cancel",
  toStatus: "cancelled",
  optionalReason: true,
  destructive: true,
};

/**
 * The actions an admin can take on an order in a given status. Every
 * `rpc: "transition"` action's `toStatus` is guaranteed to be in
 * ALLOWED_TRANSITIONS[status] (asserted by test). Terminal states return [].
 */
export function nextActions(status: OrderStatus): OrderAction[] {
  switch (status) {
    case "pending_payment":
      return [CANCEL_ACTION];
    case "payment_submitted":
      return [
        {
          key: "verify_payment",
          label: "Verify payment",
          rpc: "verify_payment",
          toStatus: "confirmed",
        },
        {
          key: "reject_payment",
          label: "Reject payment",
          rpc: "reject_payment",
          toStatus: "payment_rejected",
          requiresReason: true,
          destructive: true,
        },
        CANCEL_ACTION,
      ];
    case "payment_rejected":
      return [CANCEL_ACTION];
    case "pending_confirmation":
      return [
        { key: "confirm_cod", label: "Confirm order", rpc: "confirm_cod", toStatus: "confirmed" },
        CANCEL_ACTION,
      ];
    case "confirmed":
      return [
        {
          key: "to_processing",
          label: "Start processing",
          rpc: "transition",
          toStatus: "processing",
        },
        CANCEL_ACTION,
      ];
    case "processing":
      return [
        {
          key: "to_ready_to_ship",
          label: "Mark ready to ship",
          rpc: "transition",
          toStatus: "ready_to_ship",
        },
        CANCEL_ACTION,
      ];
    case "ready_to_ship":
      return [
        { key: "to_shipped", label: "Mark shipped", rpc: "transition", toStatus: "shipped" },
        CANCEL_ACTION,
      ];
    case "shipped":
      return [
        { key: "to_delivered", label: "Mark delivered", rpc: "transition", toStatus: "delivered" },
      ];
    case "delivered":
      return [
        { key: "to_completed", label: "Mark completed", rpc: "transition", toStatus: "completed" },
        {
          key: "return",
          label: "Return order",
          rpc: "return",
          toStatus: "returned",
          allowsRestock: true,
          optionalReason: true,
          destructive: true,
        },
      ];
    case "completed":
      return [
        {
          key: "return",
          label: "Return order",
          rpc: "return",
          toStatus: "returned",
          allowsRestock: true,
          optionalReason: true,
          destructive: true,
        },
      ];
    case "returned":
      return [
        {
          key: "to_refund_pending",
          label: "Start refund",
          rpc: "transition",
          toStatus: "refund_pending",
        },
      ];
    case "refund_pending":
      return [
        {
          key: "to_refund_done",
          label: "Mark refunded",
          rpc: "transition",
          toStatus: "refund_done",
        },
      ];
    case "cancelled":
    case "expired":
    case "refund_done":
      return [];
  }
}

// ── DTOs (camelCase; mapped from the snake_case RPC JSON in orders.server) ────

export interface OrderListItemLine {
  name: string;
  image: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  variantSize: string | null;
}

export interface OrderPaymentSummary {
  id: string;
  method: PaymentMethod;
  amount: number;
  trxId: string | null;
  senderNumber: string | null;
  status: PaymentStatus;
  verifiedAt: string | null;
  rejectReason: string | null;
}

/** One row in the admin orders board (api.list_orders). */
export interface OrderListRow {
  id: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  shipDistrict: string;
  shipZone: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  placedAt: string;
  confirmedAt: string | null;
  version: number;
  items: OrderListItemLine[];
  payment: OrderPaymentSummary | null;
}

export interface OrderListResult {
  orders: OrderListRow[];
  total: number;
}

/** Full order record for the detail view (api.get_order_detail → order). */
export interface OrderRecord {
  id: string;
  orderNo: string;
  userId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  shipDistrict: string;
  shipZone: string;
  shipAddress: string;
  shipArea: string | null;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  couponCode: string | null;
  version: number;
  placedAt: string;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Made-to-measure measurements captured at checkout (label → value), surfaced to
 * the workshop (admin) and back to the customer. Fulfilment data only — never
 * part of pricing. `null` for ready-size lines.
 */
export type CustomMeasurements = Record<string, string>;

export interface OrderDetailItem {
  id: string;
  productId: string;
  variantSize: string | null;
  name: string;
  image: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  customMeasurements: CustomMeasurements | null;
}

export interface OrderPaymentDetail {
  id: string;
  method: PaymentMethod;
  amount: number;
  senderNumber: string | null;
  trxId: string | null;
  status: PaymentStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface OrderScreenshot {
  id: string;
  storagePath: string;
  createdAt: string;
}

export interface OrderHistoryEntry {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface OrderDetail {
  order: OrderRecord;
  items: OrderDetailItem[];
  payment: OrderPaymentDetail | null;
  screenshots: OrderScreenshot[];
  history: OrderHistoryEntry[];
}

/** Shape returned by api.transition_order (and the convenience wrappers). */
export interface OrderTransitionResult {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  version: number;
  noop: boolean;
}

// ── Stable error codes → safe messages ───────────────────────────────────────

export const ORDER_ERROR_MESSAGES: Record<string, string> = {
  order_not_found: "That order no longer exists. Refresh and try again.",
  actor_not_authorized: "You are not authorized to perform this action.",
  invalid_transition:
    "That status change isn't allowed from the order's current state. Refresh and try again.",
  version_conflict:
    "This order was just updated by someone else. Refresh to see the latest, then retry.",
  payment_not_found: "No payment record was found for this order.",
};

export const KNOWN_ORDER_ERROR_CODES = new Set(Object.keys(ORDER_ERROR_MESSAGES));

const GENERIC_ORDER_ERROR = "Could not complete the change. Please try again.";

export function orderErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_ORDER_ERROR;
  return ORDER_ERROR_MESSAGES[code] ?? GENERIC_ORDER_ERROR;
}

// ── Server-fn input validators (zod; mirror the RPC argument bounds) ─────────

const orderStatusEnum = z.enum(ORDER_STATUSES);
const uuid = z.string().uuid();
const reason = z.string().trim().min(1).max(500);

/** Validator for listOrdersFn. */
export const listOrdersSchema = z.object({
  status: orderStatusEnum.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Validator for getOrderDetailFn / single-order convenience fns. */
export const orderIdSchema = z.object({ orderId: uuid });

/** Validator for transitionOrderFn (generic state move). */
export const transitionOrderSchema = z.object({
  orderId: uuid,
  toStatus: orderStatusEnum,
  reason: reason.optional(),
  expectedVersion: z.number().int().min(0).optional(),
  restock: z.boolean().optional(),
});

/** Validator for rejectPaymentFn (reason required). */
export const rejectPaymentSchema = z.object({ orderId: uuid, reason });

/** Validator for cancelOrderFn (reason optional). */
export const cancelOrderSchema = z.object({ orderId: uuid, reason: reason.optional() });

/** Validator for returnOrderFn (restock + optional reason). */
export const returnOrderSchema = z.object({
  orderId: uuid,
  restock: z.boolean().optional(),
  reason: reason.optional(),
});

export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type ReturnOrderInput = z.infer<typeof returnOrderSchema>;

// ── Customer-facing reads (api.list_my_orders / get_my_order / track_order) ──

/** Validator for listMyOrdersFn (pagination only; owner = the auth user). */
export const listMyOrdersSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Validator for guest order tracking. The raw token is hashed server-side. */
export const trackOrderSchema = z.object({
  orderNo: z.string().trim().min(1).max(40),
  token: z.string().trim().min(1).max(200),
});

export type TrackOrderInput = z.infer<typeof trackOrderSchema>;

export interface MyOrderListItem {
  id: string;
  orderNo: string;
  status: OrderStatus;
  total: number;
  paymentMethod: PaymentMethod;
  placedAt: string;
  itemCount: number;
  firstItem: { name: string; image: string | null } | null;
}

export interface MyOrdersResult {
  orders: MyOrderListItem[];
  total: number;
}

export interface MyOrderLine {
  name: string;
  image: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  variantSize: string | null;
  customMeasurements: CustomMeasurements | null;
}

export interface MyOrderHistoryEntry {
  toStatus: OrderStatus;
  createdAt: string;
}

/** Owner-scoped order detail (api.get_my_order). */
export interface MyOrderDetail {
  order: {
    id: string;
    orderNo: string;
    status: OrderStatus;
    subtotal: number;
    discount: number;
    shippingFee: number;
    total: number;
    paymentMethod: PaymentMethod;
    placedAt: string;
    shipDistrict: string;
    shipZone: string;
    shipAddress: string;
    shipArea: string | null;
  };
  items: MyOrderLine[];
  payment: { method: PaymentMethod; status: PaymentStatus; trxId: string | null } | null;
  history: MyOrderHistoryEntry[];
}

/** Guest tracking projection (api.track_order) — no PII beyond the order line. */
export interface TrackOrderResult {
  order: {
    orderNo: string;
    status: OrderStatus;
    total: number;
    paymentMethod: PaymentMethod;
    placedAt: string;
  };
  items: Array<{
    name: string;
    image: string | null;
    qty: number;
    unitPrice: number;
    variantSize: string | null;
    customMeasurements: CustomMeasurements | null;
  }>;
  history: MyOrderHistoryEntry[];
}

// ── Customer progress timeline (the 15 statuses → a 6-step happy path) ────────

export const CUSTOMER_STEPS = [
  "Order placed",
  "Payment",
  "Confirmed",
  "Preparing",
  "Shipped",
  "Delivered",
] as const;

export type CustomerStep = (typeof CUSTOMER_STEPS)[number];

/**
 * Map a real status to a position on the customer's 6-step timeline, plus an
 * `exception` flag for off-path states (cancelled / expired / payment_rejected /
 * returned / refund_*), which the UI renders as a callout instead of progress.
 */
export function customerProgress(status: OrderStatus): { stepIndex: number; exception: boolean } {
  switch (status) {
    case "pending_payment":
    case "pending_confirmation":
      return { stepIndex: 0, exception: false };
    case "payment_submitted":
      return { stepIndex: 1, exception: false };
    case "confirmed":
      return { stepIndex: 2, exception: false };
    case "processing":
    case "ready_to_ship":
      return { stepIndex: 3, exception: false };
    case "shipped":
      return { stepIndex: 4, exception: false };
    case "delivered":
    case "completed":
      return { stepIndex: 5, exception: false };
    case "payment_rejected":
    case "cancelled":
    case "expired":
    case "returned":
    case "refund_pending":
    case "refund_done":
      return { stepIndex: -1, exception: true };
  }
}
