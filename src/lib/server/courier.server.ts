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
  // Courier RPCs live in the `api` schema (REVOKE-d from anon/authenticated).
  // The admin client defaults to `public`, so this MUST be schema("api") — the
  // same convention orders.server.ts uses. (Without it every courier call fails
  // with "function public.<fn> not found".)
  const { data, error } = await admin.schema("api").rpc(fn, params);
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
    customerEmail?: string | null;
    shipAddress: string;
    shipDistrict: string;
    total: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
  };
}

/**
 * Translate an order's stored location ids into the courier's own ids.
 *
 * orders.ship_*_id point at bd_* rows; the Pathao ids live on those rows. Both
 * hops are best-effort: any miss returns undefined and the adapter falls back
 * to auto-address, which is exactly the pre-existing behaviour. A location
 * lookup must never block a booking.
 */
async function getPathaoLocationIds(orderId: string): Promise<{
  cityId?: number;
  zoneId?: number;
  areaId?: number;
}> {
  try {
    const admin = createAdminSupabaseClient();
    const { data: order } = await admin
      .from("orders")
      .select("ship_district_id, ship_thana_id, ship_area_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order?.ship_district_id || !order?.ship_thana_id) return {};

    const [{ data: d }, { data: t }, areaRes] = await Promise.all([
      admin
        .from("bd_districts")
        .select("pathao_city_id")
        .eq("id", order.ship_district_id)
        .maybeSingle(),
      admin
        .from("bd_upazilas")
        .select("pathao_zone_id")
        .eq("id", order.ship_thana_id)
        .maybeSingle(),
      order.ship_area_id
        ? admin
            .from("bd_unions")
            .select("pathao_area_id")
            .eq("id", order.ship_area_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // City AND zone are required together — Pathao rejects a zone without its
    // city, and a city alone is no better than auto-address.
    if (!d?.pathao_city_id || !t?.pathao_zone_id) return {};
    return {
      cityId: d.pathao_city_id,
      zoneId: t.pathao_zone_id,
      areaId:
        (areaRes as { data: { pathao_area_id: number | null } | null }).data?.pathao_area_id ??
        undefined,
    };
  } catch (err) {
    safeServerLog("warn", "Could not resolve Pathao location ids; using auto-address", {
      orderId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return {};
  }
}

/**
 * Per-provider booking defaults, read from courier_providers at book time.
 *
 * These columns existed and were seeded since Stage 5 but nothing ever read
 * them, so every Pathao parcel booked at the adapter's hardcoded 0.5 kg
 * regardless of the configured value — and Pathao prices by weight. Reading
 * them here is what makes the admin-facing configuration actually mean
 * something.
 *
 * Failure is non-fatal: a booking must not be blocked because a defaults lookup
 * failed. Falling back to undefined reproduces the previous adapter defaults.
 */
async function getProviderDefaults(
  provider: string,
): Promise<{ weight?: number; serviceType?: string }> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("courier_providers")
      .select("default_weight_kg, default_service_type")
      .eq("id", provider)
      .maybeSingle();

    if (!data) return {};
    // default_weight_kg is numeric → the driver hands it back as a string.
    const weight = data.default_weight_kg == null ? undefined : Number(data.default_weight_kg);
    return {
      weight: weight != null && Number.isFinite(weight) && weight > 0 ? weight : undefined,
      serviceType: data.default_service_type ?? undefined,
    };
  } catch (err) {
    safeServerLog("warn", "Could not read courier provider defaults", {
      provider,
      error: err instanceof Error ? err.message : "unknown",
    });
    return {};
  }
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
  // Provider defaults are read AFTER the pending row is committed so a slow or
  // failing lookup cannot hold a transaction open across the network call.
  const defaults = await getProviderDefaults(provider);
  // Only Pathao consumes these; skip the lookup entirely for other providers.
  const pathaoIds = provider === "pathao" ? await getPathaoLocationIds(orderId) : {};

  const bookingReq: CourierBookingRequest = {
    orderNo: order.orderNo,
    recipientName: order.customerName,
    recipientPhone: order.customerPhone,
    recipientEmail: order.customerEmail ?? undefined,
    recipientAddress: order.shipAddress,
    district: order.shipDistrict,
    codAmount,
    note,
    // Not the product list: item names would leak the customer's purchase to
    // anyone handling the parcel. The order number is enough for the courier to
    // identify it in a damage or loss dispute.
    itemDescription: `Nongorr order ${order.orderNo}`,
    weight: defaults.weight,
    serviceType: defaults.serviceType,
    recipientCityId: pathaoIds.cityId,
    recipientZoneId: pathaoIds.zoneId,
    recipientAreaId: pathaoIds.areaId,
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

/**
 * Append an informational shipment event WITHOUT changing courier_status or the
 * order. For provider notifications that carry progress text but no status of
 * their own — e.g. SteadFast's tracking_update webhook. Using
 * updateShipmentStatus for those would overwrite a real status with a
 * non-status.
 */
export async function recordShipmentEvent(
  shipmentId: string,
  status: string,
  rawPayload: unknown,
  source: string,
): Promise<void> {
  await rpc<{ recorded: boolean }>("record_shipment_event", {
    p_shipment_id: shipmentId,
    p_status: status,
    p_raw_payload: rawPayload,
    p_source: source,
  });
}

// ── Returns ──────────────────────────────────────────────────────────────────

export interface CreateReturnResult {
  shipmentId: string;
  success: boolean;
  returnRequestId: string | null;
  /** True when the courier has no return API and the leg was recorded manually. */
  manual: boolean;
  error?: string;
}

/**
 * Raise a return leg for a delivered/failed forward shipment.
 *
 * Same 3-phase shape as bookShipment — the pending row is committed before any
 * network call, so a hung courier API can never hold a transaction open:
 *   Phase 1: create_return_shipment  → pending return row (committed)
 *   Phase 2: adapter.createReturn()  → external call (no open transaction)
 *   Phase 3: mark success / failure  → committed
 *
 * Providers without a return API (Pathao, manual) are NOT an error: the return
 * leg is recorded so the timeline and reconciliation stay truthful, flagged
 * `manual: true` so the admin knows to raise it in the merchant panel.
 */
export async function createReturnShipment(
  actorId: string,
  parentShipmentId: string,
  reason?: string,
): Promise<CreateReturnResult> {
  // ── Phase 1: create the pending return row (committed) ──────────────────
  const created = await rpc<{
    shipment_id: string;
    provider: string;
    consignment_id: string;
  }>("create_return_shipment", {
    p_actor: actorId,
    p_parent_id: parentShipmentId,
    p_reason: reason ?? null,
  });

  const { shipment_id: shipmentId, provider, consignment_id: consignmentId } = created;

  let adapter;
  try {
    adapter = getCourierAdapter(provider);
  } catch (err) {
    await rpc<void>("fail_shipment_booking", {
      p_shipment_id: shipmentId,
      p_error: err instanceof Error ? err.message : "provider_not_configured",
    });
    throw new CourierError("provider_not_configured");
  }

  // Provider has no return API — record the leg and tell the caller plainly.
  if (typeof adapter.createReturn !== "function") {
    await rpc<void>("mark_shipment_booking_success", {
      p_shipment_id: shipmentId,
      p_consignment_id: consignmentId,
      p_tracking_code: null,
      p_raw_response: { manual: true, reason: "provider has no return API" },
    });
    return { shipmentId, success: true, returnRequestId: null, manual: true };
  }

  // ── Phase 2: external call ─────────────────────────────────────────────
  const result = await adapter.createReturn(consignmentId, reason);

  // ── Phase 3: record the outcome ────────────────────────────────────────
  if (result.success) {
    await rpc<void>("mark_shipment_booking_success", {
      p_shipment_id: shipmentId,
      // The courier's return-request id is this leg's own reference; the parent
      // consignment stays as the consignment so the two legs remain linked.
      p_consignment_id: consignmentId,
      p_tracking_code: result.returnRequestId,
      p_raw_response: result.rawResponse ?? null,
    });
    return {
      shipmentId,
      success: true,
      returnRequestId: result.returnRequestId,
      manual: false,
    };
  }

  await rpc<void>("fail_shipment_booking", {
    p_shipment_id: shipmentId,
    p_error: result.error ?? "Unknown return request error",
  });
  return {
    shipmentId,
    success: false,
    returnRequestId: null,
    manual: false,
    error: result.error,
  };
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

  // Normalize the raw provider status to our canonical internal status BEFORE
  // recording — identical to the webhook path. Passing the raw status (as the
  // old code did) meant update_shipment_status never matched its CASE arms, so a
  // polled 'Delivered'/'In Transit' recorded an inconsistent courier_status and
  // never advanced the order. Unknown statuses are skipped (logged upstream).
  const { mapCourierStatusToInternal } = await import("@/lib/courier-shared");
  const internalStatus = mapCourierStatusToInternal(ship.provider, result.status);
  if (internalStatus) {
    await rpc<unknown>("update_shipment_status", {
      p_shipment_id: shipmentId,
      p_status: internalStatus,
      p_raw_payload: result.rawResponse ?? null,
      p_source: "poll",
    });
  }

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

/**
 * Finalize a recorded webhook event (#9): mark processed on success, or record
 * the error (leaving processed=false) so a failed event is visible/retriable.
 * Best-effort — never throws into the webhook handler's response path.
 */
export async function markWebhookEventProcessed(
  provider: string,
  eventId: string,
  error: string | null,
): Promise<void> {
  try {
    await rpc<void>("set_webhook_event_processed", {
      p_provider: provider,
      p_event_id: eventId,
      p_error: error,
    });
  } catch (err) {
    safeServerLog("error", "Failed to mark webhook event processed", {
      provider,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
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

// ── Courier account reads (COD reconciliation) ───────────────────────────────
//
// Read-only money data pulled from the courier so reconciliation stops being a
// hand-typed exercise. Deliberately NOT auto-written into shipments: these
// numbers decide what the business is owed, so a human confirms them via
// updateReconciliation. The API surfaces them; it does not silently apply them.

export async function getCourierBalance(
  provider: string,
): Promise<{ success: boolean; balance: number | null; error?: string }> {
  if (provider !== "steadfast") {
    return { success: false, balance: null, error: "Balance is only available for SteadFast." };
  }
  // Validates credentials are present and the provider is known.
  getCourierAdapter(provider);
  const { steadfastGetBalance } = await import("./courier/steadfast.server");
  return steadfastGetBalance();
}

export async function listCourierPayments(
  provider: string,
): Promise<{ success: boolean; payments: unknown[]; error?: string }> {
  if (provider !== "steadfast") {
    return { success: false, payments: [], error: "Payments are only available for SteadFast." };
  }
  getCourierAdapter(provider);
  const { steadfastListPayments } = await import("./courier/steadfast.server");
  return steadfastListPayments();
}

export async function getCourierPayment(
  provider: string,
  paymentId: string,
): Promise<{ success: boolean; payment: unknown | null; error?: string }> {
  if (provider !== "steadfast") {
    return { success: false, payment: null, error: "Payments are only available for SteadFast." };
  }
  getCourierAdapter(provider);
  const { steadfastGetPayment } = await import("./courier/steadfast.server");
  return steadfastGetPayment(paymentId);
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
