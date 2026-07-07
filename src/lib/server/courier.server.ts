/**
 * Courier booking orchestration — the server-side repository layer.
 *
 * All DB access goes through service-role RPCs. External courier API calls
 * happen BETWEEN committed DB writes (no open transaction during network I/O).
 *
 * The .server.ts suffix keeps this off the client.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { getCourierAdapter, CourierConfigError } from "./courier/index";
import type { CourierBookingRequest } from "./courier/types";
import { computeCodAmount } from "@/lib/courier-shared";
import type { PaymentMethod } from "@/lib/checkout-shared";
import type { PaymentStatus } from "@/lib/orders-shared";
import { safeServerLog } from "./security.server";

// ── Error class ──────────────────────────────────────────────────────────────

export class CourierError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CourierError";
  }
}

// ── Helper: call an RPC and unwrap ───────────────────────────────────────────

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc(fn, params);
  if (error) {
    safeServerLog("error", `RPC ${fn} failed`, { code: error.code, message: error.message });
    // Try to extract our stable error code from the message
    const match = error.message?.match(/^(\w[\w.]+)$/);
    throw new CourierError(match?.[1] ?? error.code ?? "rpc_error", error.message);
  }
  return data as T;
}

// ── Booking flow (3-phase) ───────────────────────────────────────────────────

export interface BookShipmentParams {
  actorId: string;
  orderId: string;
  provider: string;
  /** Required for manual provider. */
  trackingCode?: string;
  note?: string;
  /** Order data needed for COD computation + courier payload. */
  order: {
    orderNo: string;
    customerName: string;
    customerPhone: string;
    shipAddress: string;
    shipDistrict: string;
    total: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
  };
}

export interface BookShipmentResult {
  shipmentId: string;
  success: boolean;
  consignmentId: string | null;
  trackingCode: string | null;
  error?: string;
}

/**
 * 3-phase booking:
 *   Phase 1: create_shipment_attempt → pending row (committed)
 *   Phase 2: call external courier API (no open transaction)
 *   Phase 3: mark success or failure (committed)
 */
export async function bookShipment(params: BookShipmentParams): Promise<BookShipmentResult> {
  const { actorId, orderId, provider, trackingCode, note, order } = params;

  // Validate manual requires tracking code
  if (provider === "manual") {
    const trimmed = trackingCode?.trim();
    if (!trimmed || trimmed.length < 2) {
      throw new CourierError(
        "manual_tracking_required",
        "Manual shipments require a tracking code (min 2 chars).",
      );
    }
  }

  // Block booking if bKash/Nagad not verified
  if (order.paymentMethod !== "cod" && order.paymentStatus !== "verified") {
    throw new CourierError(
      "payment_not_verified",
      "Payment must be verified before booking a courier.",
    );
  }

  // Compute COD amount from amount due
  const { mode, codAmount } = computeCodAmount(
    order.paymentMethod,
    order.paymentStatus,
    order.total,
  );

  // Get adapter (validates env credentials)
  let adapter;
  try {
    adapter = getCourierAdapter(provider);
  } catch (err) {
    if (err instanceof CourierConfigError) {
      throw new CourierError("provider_not_configured", err.message);
    }
    throw err;
  }

  // Build canonical request hash for idempotency
  const requestPayload = JSON.stringify({
    orderId,
    provider,
    codAmount,
    ts: Math.floor(Date.now() / 60000),
  });
  const hashBuffer = new TextEncoder().encode(requestPayload);
  const hashArray = await crypto.subtle.digest("SHA-256", hashBuffer);
  const requestHash = Array.from(new Uint8Array(hashArray))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // ── Phase 1: create pending attempt (committed, no lock held) ──────────
  let shipmentId: string;
  try {
    const result = await rpc<{ shipment_id: string }>("create_shipment_attempt", {
      p_actor: actorId,
      p_order_id: orderId,
      p_provider: provider,
      p_collection_mode: mode,
      p_cod_amount: codAmount,
      p_request_hash: requestHash,
    });
    shipmentId = result.shipment_id;
  } catch (err) {
    if (err instanceof CourierError) throw err;
    // Unique index violation = double booking
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("uq_active_forward_shipment") || msg.includes("duplicate")) {
      throw new CourierError("double_booking");
    }
    throw err;
  }

  // ── Phase 2: call external courier API (no open transaction) ───────────
  const bookingReq: CourierBookingRequest = {
    orderNo: order.orderNo,
    recipientName: order.customerName,
    recipientPhone: order.customerPhone,
    recipientAddress: order.shipAddress,
    district: order.shipDistrict,
    codAmount,
    note,
  };

  const result = await adapter.book(bookingReq);

  // For manual: use the admin-provided tracking code
  const finalTrackingCode =
    provider === "manual" ? (trackingCode?.trim() ?? null) : result.trackingCode;

  // ── Phase 3: record outcome (committed) ────────────────────────────────
  if (result.success || provider === "manual") {
    await rpc<void>("mark_shipment_booking_success", {
      p_shipment_id: shipmentId,
      p_consignment_id: result.consignmentId,
      p_tracking_code: finalTrackingCode,
      p_raw_response: result.rawResponse ?? null,
    });
    return {
      shipmentId,
      success: true,
      consignmentId: result.consignmentId,
      trackingCode: finalTrackingCode,
    };
  } else {
    await rpc<void>("fail_shipment_booking", {
      p_shipment_id: shipmentId,
      p_error: result.error ?? "Unknown booking error",
    });
    return {
      shipmentId,
      success: false,
      consignmentId: null,
      trackingCode: null,
      error: result.error,
    };
  }
}

// ── Status updates ───────────────────────────────────────────────────────────

export async function updateShipmentStatus(
  shipmentId: string,
  status: string,
  rawPayload: unknown,
  source: string,
): Promise<{ orderTransitioned: boolean }> {
  const result = await rpc<{ order_transitioned: boolean }>("update_shipment_status", {
    p_shipment_id: shipmentId,
    p_status: status,
    p_raw_payload: rawPayload,
    p_source: source,
  });
  return { orderTransitioned: result.order_transitioned };
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelShipment(
  actorId: string,
  shipmentId: string,
  reason?: string,
): Promise<void> {
  await rpc<void>("cancel_shipment", {
    p_actor: actorId,
    p_shipment_id: shipmentId,
    p_reason: reason ?? null,
  });
}

// ── Stale recovery ───────────────────────────────────────────────────────────

export async function resolveStaleAttempt(actorId: string, shipmentId: string): Promise<void> {
  await rpc<void>("resolve_stale_attempt", {
    p_actor: actorId,
    p_shipment_id: shipmentId,
  });
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listShipments(actorId: string, orderId: string): Promise<unknown[]> {
  return rpc<unknown[]>("list_shipments", {
    p_actor: actorId,
    p_order_id: orderId,
  });
}

// ── Poll (manual refresh from courier API) ───────────────────────────────────

export async function pollShipmentStatus(
  actorId: string,
  shipmentId: string,
): Promise<{ status: string }> {
  // Fetch shipment to get provider + consignment_id
  const admin = createAdminSupabaseClient();
  const { data: ship, error } = await admin
    .from("shipments")
    .select("provider, consignment_id, booking_status")
    .eq("id", shipmentId)
    .single();

  if (error || !ship) throw new CourierError("shipment_not_found");
  if (ship.booking_status !== "success") throw new CourierError("invalid_booking_state");
  if (!ship.consignment_id) throw new CourierError("shipment_not_found", "No consignment ID");

  const adapter = getCourierAdapter(ship.provider);
  const result = await adapter.checkStatus(ship.consignment_id);

  // Record the polled status
  await rpc<unknown>("update_shipment_status", {
    p_shipment_id: shipmentId,
    p_status: result.status,
    p_raw_payload: result.rawResponse ?? null,
    p_source: "poll",
  });

  return { status: result.status };
}

// ── Webhook event recording ──────────────────────────────────────────────────

export async function recordWebhookEvent(
  provider: string,
  eventId: string,
  payload: unknown,
): Promise<{ isNew: boolean }> {
  const result = await rpc<{ is_new: boolean }>("record_webhook_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_payload: payload,
  });
  return { isNew: result.is_new };
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export async function updateReconciliation(
  actorId: string,
  shipmentId: string,
  data: {
    courierFee?: number;
    returnFee?: number;
    codCollectedAt?: string;
    codSettledAt?: string;
    settlementRef?: string;
  },
): Promise<void> {
  await rpc<void>("update_shipment_reconciliation", {
    p_actor: actorId,
    p_shipment_id: shipmentId,
    p_courier_fee: data.courierFee ?? null,
    p_return_fee: data.returnFee ?? null,
    p_cod_collected_at: data.codCollectedAt ?? null,
    p_cod_settled_at: data.codSettledAt ?? null,
    p_settlement_ref: data.settlementRef ?? null,
  });
}

// ── Providers ────────────────────────────────────────────────────────────────

export async function listCourierProviders(actorId: string): Promise<unknown> {
  return rpc<unknown>("list_courier_providers", { p_actor: actorId });
}

// ── Find shipment by consignment ID (for webhook processing) ─────────────────

export async function findShipmentByConsignment(
  provider: string,
  consignmentId: string,
): Promise<{ id: string; orderId: string } | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("shipments")
    .select("id, order_id")
    .eq("provider", provider)
    .eq("consignment_id", consignmentId)
    .eq("booking_status", "success")
    .is("cancelled_at", null)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, orderId: data.order_id };
}
