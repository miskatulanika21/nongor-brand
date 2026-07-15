/**
 * Order administration repository — SERVER ONLY.
 *
 * Wraps the service-role admin client over the api.* order RPCs, which are all
 * REVOKE-d from anon/authenticated. Authorization (CSRF + strict permission +
 * step-up + rate limit) is enforced upstream by the API handlers (orders.api.ts
 * via guardAdminWrite / requirePermission); this layer assumes a verified actor
 * and only does the narrowly-scoped system call + snake→camel mapping.
 *
 * Every RPC raises a STABLE snake_case code AS the exception message; we accept
 * it only when it is a known code, else collapse to `internal_error`, so raw SQL
 * context can never reach the client (pattern: checkout.server / catalog-admin).
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  KNOWN_ORDER_ERROR_CODES,
  type OrderListResult,
  type OrderListRow,
  type OrderListItemLine,
  type OrderPaymentSummary,
  type OrderDetail,
  type OrderRecord,
  type OrderDetailItem,
  type OrderPaymentDetail,
  type OrderScreenshot,
  type OrderHistoryEntry,
  type OrderStatus,
  type PaymentStatus,
  type OrderTransitionResult,
  type MyOrdersResult,
  type MyOrderListItem,
  type MyOrderDetail,
  type MyOrderLine,
  type MyOrderHistoryEntry,
  type OrderCourierInfo,
  type TrackOrderResult,
  type ClaimGuestOrderResult,
  type CustomMeasurements,
  type AdminOrderStats,
} from "@/lib/orders-shared";
import type { PaymentMethod } from "@/lib/checkout-shared";
import { createHash } from "node:crypto";

export class OrderError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OrderError";
  }
}

/** Map a Postgres/PostgREST error to a stable OrderError (unknowns → internal_error). */
function throwOrderError(error: { message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new OrderError(KNOWN_ORDER_ERROR_CODES.has(raw) ? raw : "internal_error");
}

// ── Raw RPC row shapes (snake_case JSON) ─────────────────────────────────────

interface RawListLine {
  name: string;
  image: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  variant_size: string | null;
}

interface RawPaymentSummary {
  id: string;
  method: PaymentMethod;
  amount: number;
  trx_id: string | null;
  sender_number: string | null;
  status: PaymentStatus;
  verified_at: string | null;
  reject_reason: string | null;
}

interface RawListRow {
  id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string;
  ship_district: string;
  ship_zone: string;
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  payment_method: PaymentMethod;
  status: OrderStatus;
  placed_at: string;
  confirmed_at: string | null;
  version: number;
  items: RawListLine[] | null;
  payment: RawPaymentSummary | null;
}

function mapListLine(l: RawListLine): OrderListItemLine {
  return {
    name: l.name,
    image: l.image,
    qty: l.qty,
    unitPrice: l.unit_price,
    lineTotal: l.line_total,
    variantSize: l.variant_size,
  };
}

function mapPaymentSummary(p: RawPaymentSummary): OrderPaymentSummary {
  return {
    id: p.id,
    method: p.method,
    amount: p.amount,
    trxId: p.trx_id,
    senderNumber: p.sender_number,
    status: p.status,
    verifiedAt: p.verified_at,
    rejectReason: p.reject_reason,
  };
}

function mapListRow(r: RawListRow): OrderListRow {
  return {
    id: r.id,
    orderNo: r.order_no,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    shipDistrict: r.ship_district,
    shipZone: r.ship_zone,
    subtotal: r.subtotal,
    discount: r.discount,
    shippingFee: r.shipping_fee,
    total: r.total,
    paymentMethod: r.payment_method,
    status: r.status,
    placedAt: r.placed_at,
    confirmedAt: r.confirmed_at,
    version: r.version,
    items: (r.items ?? []).map(mapListLine),
    payment: r.payment ? mapPaymentSummary(r.payment) : null,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface ListOrdersArgs {
  actorId: string;
  status?: OrderStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listOrders(args: ListOrdersArgs): Promise<OrderListResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_orders", {
    p_actor: args.actorId,
    p_status: args.status ?? null,
    p_search: args.search ?? null,
    p_limit: args.limit ?? 50,
    p_offset: args.offset ?? 0,
  });
  if (error) throwOrderError(error);
  const raw = (data ?? { orders: [], total: 0 }) as { orders: RawListRow[] | null; total: number };
  return {
    orders: (raw.orders ?? []).map(mapListRow),
    total: raw.total ?? 0,
  };
}

interface RawAdminOrderStats {
  total_orders: number;
  today_orders: number;
  pending_payments: number;
  pending_confirmation: number;
  courier_pending: number;
  delivered_revenue: number;
  custom_pending: number;
}

/** Aggregate dashboard figures (api.admin_order_stats; staff-gated). */
export async function adminOrderStats(actorId: string): Promise<AdminOrderStats> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("admin_order_stats", { p_actor: actorId });
  if (error) throwOrderError(error);
  const r = data as RawAdminOrderStats;
  return {
    totalOrders: r.total_orders,
    todayOrders: r.today_orders,
    pendingPayments: r.pending_payments,
    pendingConfirmation: r.pending_confirmation,
    courierPending: r.courier_pending,
    deliveredRevenue: r.delivered_revenue,
    customPending: r.custom_pending,
  };
}

interface RawOrderRecord {
  id: string;
  order_no: string;
  user_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  ship_district: string;
  ship_zone: string;
  ship_address: string;
  ship_area: string | null;
  subtotal: number;
  discount: number;
  shipping_fee: number;
  total: number;
  payment_method: PaymentMethod;
  status: OrderStatus;
  coupon_code: string | null;
  version: number;
  placed_at: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapOrderRecord(o: RawOrderRecord): OrderRecord {
  return {
    id: o.id,
    orderNo: o.order_no,
    userId: o.user_id,
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    customerEmail: o.customer_email,
    shipDistrict: o.ship_district,
    shipZone: o.ship_zone,
    shipAddress: o.ship_address,
    shipArea: o.ship_area,
    subtotal: o.subtotal,
    discount: o.discount,
    shippingFee: o.shipping_fee,
    total: o.total,
    paymentMethod: o.payment_method,
    status: o.status,
    couponCode: o.coupon_code,
    version: o.version,
    placedAt: o.placed_at,
    confirmedAt: o.confirmed_at,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

interface RawDetailItem {
  id: string;
  product_id: string;
  variant_size: string | null;
  name: string;
  image: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
  custom_measurements: Record<string, unknown> | null;
}

/**
 * Coerce a raw jsonb measurements value into a clean label→value map. The insert
 * path already guarantees string values; this is defensive against nulls/empties
 * so the UI can treat `null` as "no measurements".
 */
function normalizeRawMeasures(m: unknown): CustomMeasurements | null {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

interface RawPaymentDetail {
  id: string;
  method: PaymentMethod;
  amount: number;
  sender_number: string | null;
  trx_id: string | null;
  status: PaymentStatus;
  verified_by: string | null;
  verified_at: string | null;
  reject_reason: string | null;
  created_at: string;
  trx_id_duplicate: boolean | null;
}

interface RawScreenshot {
  id: string;
  storage_path: string;
  created_at: string;
}

interface RawHistoryEntry {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
}

interface RawOrderDetail {
  order: RawOrderRecord;
  items: RawDetailItem[] | null;
  payment: RawPaymentDetail | null;
  screenshots: RawScreenshot[] | null;
  history: RawHistoryEntry[] | null;
}

function mapDetailItem(i: RawDetailItem): OrderDetailItem {
  return {
    id: i.id,
    productId: i.product_id,
    variantSize: i.variant_size,
    name: i.name,
    image: i.image,
    unitPrice: i.unit_price,
    qty: i.qty,
    lineTotal: i.line_total,
    customMeasurements: normalizeRawMeasures(i.custom_measurements),
  };
}

function mapPaymentDetail(p: RawPaymentDetail): OrderPaymentDetail {
  return {
    id: p.id,
    method: p.method,
    amount: p.amount,
    senderNumber: p.sender_number,
    trxId: p.trx_id,
    status: p.status,
    verifiedBy: p.verified_by,
    verifiedAt: p.verified_at,
    rejectReason: p.reject_reason,
    createdAt: p.created_at,
    trxIdDuplicate: p.trx_id_duplicate ?? false,
  };
}

function mapScreenshot(s: RawScreenshot): OrderScreenshot {
  return { id: s.id, storagePath: s.storage_path, createdAt: s.created_at };
}

function mapHistoryEntry(h: RawHistoryEntry): OrderHistoryEntry {
  return {
    fromStatus: h.from_status,
    toStatus: h.to_status,
    actorId: h.actor_id,
    reason: h.reason,
    createdAt: h.created_at,
  };
}

export async function getOrderDetail(orderId: string, actorId: string): Promise<OrderDetail> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("get_order_detail", { p_order_id: orderId, p_actor: actorId });
  if (error) throwOrderError(error);
  const raw = data as RawOrderDetail;
  return {
    order: mapOrderRecord(raw.order),
    items: (raw.items ?? []).map(mapDetailItem),
    payment: raw.payment ? mapPaymentDetail(raw.payment) : null,
    screenshots: (raw.screenshots ?? []).map(mapScreenshot),
    history: (raw.history ?? []).map(mapHistoryEntry),
  };
}

// ── Transitions ──────────────────────────────────────────────────────────────

interface RawTransitionResult {
  order_id: string;
  order_no: string;
  status: OrderStatus;
  version: number;
  noop: boolean;
}

function mapTransitionResult(r: RawTransitionResult): OrderTransitionResult {
  return {
    orderId: r.order_id,
    orderNo: r.order_no,
    status: r.status,
    version: r.version,
    noop: r.noop ?? false,
  };
}

export interface TransitionArgs {
  orderId: string;
  toStatus: OrderStatus;
  actorId: string;
  reason?: string;
  expectedVersion?: number;
  restock?: boolean;
}

export async function transitionOrder(args: TransitionArgs): Promise<OrderTransitionResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("transition_order", {
    p_order_id: args.orderId,
    p_to_status: args.toStatus,
    p_actor: args.actorId,
    p_reason: args.reason ?? null,
    p_expected_version: args.expectedVersion ?? null,
    p_restock: args.restock ?? false,
  });
  if (error) throwOrderError(error);
  return mapTransitionResult(data as RawTransitionResult);
}

export async function verifyPayment(
  orderId: string,
  actorId: string,
): Promise<OrderTransitionResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("verify_payment", { p_order_id: orderId, p_actor: actorId });
  if (error) throwOrderError(error);
  return mapTransitionResult(data as RawTransitionResult);
}

export async function rejectPayment(
  orderId: string,
  reason: string,
  actorId: string,
): Promise<OrderTransitionResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("reject_payment", { p_order_id: orderId, p_reason: reason, p_actor: actorId });
  if (error) throwOrderError(error);
  return mapTransitionResult(data as RawTransitionResult);
}

export async function confirmCod(orderId: string, actorId: string): Promise<OrderTransitionResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("confirm_cod", { p_order_id: orderId, p_actor: actorId });
  if (error) throwOrderError(error);
  return mapTransitionResult(data as RawTransitionResult);
}

export async function cancelOrder(
  orderId: string,
  actorId: string,
  reason?: string,
): Promise<OrderTransitionResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("cancel_order", { p_order_id: orderId, p_actor: actorId, p_reason: reason ?? null });
  if (error) throwOrderError(error);
  return mapTransitionResult(data as RawTransitionResult);
}

export async function returnOrder(
  orderId: string,
  actorId: string,
  restock: boolean,
  reason?: string,
): Promise<OrderTransitionResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("return_order", {
    p_order_id: orderId,
    p_actor: actorId,
    p_restock: restock,
    p_reason: reason ?? null,
  });
  if (error) throwOrderError(error);
  return mapTransitionResult(data as RawTransitionResult);
}

// ── Customer-facing reads (owner-scoped / guest-token) ───────────────────────

interface RawMyListItem {
  id: string;
  order_no: string;
  status: OrderStatus;
  total: number;
  payment_method: PaymentMethod;
  placed_at: string;
  item_count: number;
  first_item: { name: string; image: string | null } | null;
  item_names: string[] | null;
}

function mapMyListItem(r: RawMyListItem): MyOrderListItem {
  return {
    id: r.id,
    orderNo: r.order_no,
    status: r.status,
    total: r.total,
    paymentMethod: r.payment_method,
    placedAt: r.placed_at,
    itemCount: r.item_count,
    firstItem: r.first_item,
    itemNames: r.item_names ?? [],
  };
}

/** The authenticated user's own orders (api.list_my_orders). */
export async function listMyOrders(
  actorId: string,
  limit = 20,
  offset = 0,
): Promise<MyOrdersResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("list_my_orders", { p_actor: actorId, p_limit: limit, p_offset: offset });
  if (error) throwOrderError(error);
  const raw = (data ?? { orders: [], total: 0 }) as {
    orders: RawMyListItem[] | null;
    total: number;
  };
  return { orders: (raw.orders ?? []).map(mapMyListItem), total: raw.total ?? 0 };
}

interface RawMyLine {
  name: string;
  image: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
  variant_size: string | null;
  custom_measurements: Record<string, unknown> | null;
  product_slug: string | null;
  sku: string | null;
}

function mapMyLine(l: RawMyLine): MyOrderLine {
  return {
    name: l.name,
    image: l.image,
    unitPrice: l.unit_price,
    qty: l.qty,
    lineTotal: l.line_total,
    variantSize: l.variant_size,
    customMeasurements: normalizeRawMeasures(l.custom_measurements),
    productSlug: l.product_slug ?? null,
    sku: l.sku ?? null,
  };
}

interface RawMyHistory {
  to_status: OrderStatus;
  created_at: string;
}

function mapMyHistory(h: RawMyHistory): MyOrderHistoryEntry {
  return { toStatus: h.to_status, createdAt: h.created_at };
}

interface RawCourier {
  provider: string;
  consignment_id: string | null;
  tracking_code: string | null;
  courier_status: string | null;
  booked_at: string | null;
}

function mapCourier(c: RawCourier | null): OrderCourierInfo | null {
  if (!c || !c.provider) return null;
  return {
    provider: c.provider,
    consignmentId: c.consignment_id ?? null,
    trackingCode: c.tracking_code ?? null,
    courierStatus: c.courier_status ?? null,
    bookedAt: c.booked_at ?? null,
  };
}

interface RawMyOrderDetail {
  order: {
    id: string;
    order_no: string;
    status: OrderStatus;
    subtotal: number;
    discount: number;
    shipping_fee: number;
    total: number;
    payment_method: PaymentMethod;
    placed_at: string;
    ship_district: string;
    ship_zone: string;
    ship_address: string;
    ship_area: string | null;
  };
  items: RawMyLine[] | null;
  payment: { method: PaymentMethod; status: PaymentStatus; trx_id: string | null } | null;
  history: RawMyHistory[] | null;
  courier: RawCourier | null;
}

/** Owner-scoped detail for one of the user's orders (api.get_my_order). */
export async function getMyOrder(orderId: string, actorId: string): Promise<MyOrderDetail> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("get_my_order", { p_order_id: orderId, p_actor: actorId });
  if (error) throwOrderError(error);
  const raw = data as RawMyOrderDetail;
  return {
    order: {
      id: raw.order.id,
      orderNo: raw.order.order_no,
      status: raw.order.status,
      subtotal: raw.order.subtotal,
      discount: raw.order.discount,
      shippingFee: raw.order.shipping_fee,
      total: raw.order.total,
      paymentMethod: raw.order.payment_method,
      placedAt: raw.order.placed_at,
      shipDistrict: raw.order.ship_district,
      shipZone: raw.order.ship_zone,
      shipAddress: raw.order.ship_address,
      shipArea: raw.order.ship_area,
    },
    items: (raw.items ?? []).map(mapMyLine),
    payment: raw.payment
      ? { method: raw.payment.method, status: raw.payment.status, trxId: raw.payment.trx_id }
      : null,
    history: (raw.history ?? []).map(mapMyHistory),
    courier: mapCourier(raw.courier),
  };
}

interface RawTrackItem {
  name: string;
  image: string | null;
  qty: number;
  unit_price: number;
  variant_size: string | null;
  custom_measurements: Record<string, unknown> | null;
  product_slug: string | null;
  sku: string | null;
}

interface RawTrackResult {
  order: {
    order_no: string;
    status: OrderStatus;
    total: number;
    payment_method: PaymentMethod;
    placed_at: string;
  };
  items: RawTrackItem[] | null;
  history: RawMyHistory[] | null;
  courier: RawCourier | null;
}

/**
 * Guest tracking by order number + raw token (api.track_order). The DB stores
 * only the sha256 hash (= orders.guest_token_hash), so we hash here identically.
 */
export async function trackOrder(orderNo: string, token: string): Promise<TrackOrderResult> {
  const admin = createAdminSupabaseClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await admin
    .schema("api")
    .rpc("track_order", { p_order_no: orderNo, p_token_hash: tokenHash });
  if (error) throwOrderError(error);
  const raw = data as RawTrackResult;
  return {
    order: {
      orderNo: raw.order.order_no,
      status: raw.order.status,
      total: raw.order.total,
      paymentMethod: raw.order.payment_method,
      placedAt: raw.order.placed_at,
    },
    items: (raw.items ?? []).map((i) => ({
      name: i.name,
      image: i.image,
      qty: i.qty,
      unitPrice: i.unit_price,
      variantSize: i.variant_size,
      customMeasurements: normalizeRawMeasures(i.custom_measurements),
      productSlug: i.product_slug ?? null,
      sku: i.sku ?? null,
    })),
    history: (raw.history ?? []).map(mapMyHistory),
    courier: mapCourier(raw.courier),
  };
}

/**
 * Claim a guest order into the verified user's account (api.claim_guest_order,
 * P7). The raw capability token is hashed exactly like trackOrder — the DB
 * only ever sees the sha256 hex. The RPC verifies the hash, flips ownership
 * atomically (user_id set + guest_token_hash cleared) and writes the
 * order.claimed audit row; a same-user retry is an idempotent success.
 */
export async function claimGuestOrder(
  userId: string,
  orderNo: string,
  token: string,
): Promise<ClaimGuestOrderResult> {
  const admin = createAdminSupabaseClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await admin.schema("api").rpc("claim_guest_order", {
    p_user: userId,
    p_order_no: orderNo,
    p_token_hash: tokenHash,
  });
  if (error) throwOrderError(error);
  const raw = data as {
    order_id: string;
    order_no: string;
    claimed: boolean;
    already_owned: boolean;
  };
  return {
    orderId: raw.order_id,
    orderNo: raw.order_no,
    claimed: raw.claimed === true,
    alreadyOwned: raw.already_owned === true,
  };
}

// ── Courier booking data ─────────────────────────────────────────────────────

/**
 * Fetch the minimal order data needed for courier booking.
 *
 * This is NOT a full order detail — it only returns what the courier adapter
 * and COD computation require. Called by bookCourierFn in courier.api.ts.
 */
export async function getOrderForBooking(
  orderId: string,
  _actorId: string,
): Promise<{
  orderNo: string;
  customerName: string;
  customerPhone: string;
  shipAddress: string;
  shipDistrict: string;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
}> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("orders")
    .select(
      "order_no, customer_name, customer_phone, ship_address, ship_district, total, payment_method, status",
    )
    .eq("id", orderId)
    .single();

  if (error || !data) throw new OrderError("order_not_found");

  const order = data as {
    order_no: string;
    customer_name: string;
    customer_phone: string;
    ship_address: string;
    ship_district: string;
    total: number;
    payment_method: PaymentMethod;
    status: OrderStatus;
  };

  // Order must be in ready_to_ship (or courier_booked for re-attempts)
  if (
    order.status !== "ready_to_ship" &&
    order.status !== "courier_booked" &&
    order.status !== "delivery_failed"
  ) {
    throw new OrderError("invalid_transition");
  }

  // Get payment status
  const { data: payment } = await admin
    .from("order_payments")
    .select("status")
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle();

  return {
    orderNo: order.order_no,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    shipAddress: order.ship_address,
    shipDistrict: order.ship_district,
    total: order.total,
    paymentMethod: order.payment_method,
    paymentStatus: (payment?.status as PaymentStatus) ?? "pending",
  };
}
