/**
 * SteadFast Courier adapter.
 *
 * Base URL from STEADFAST_BASE_URL env (default: portal.packzy.com/api/v1).
 * Auth via Api-Key + Secret-Key headers from env.
 *
 * Endpoints:
 *   POST /create_order         — book a parcel
 *   GET  /status_by_cid/{cid}  — check status by consignment ID
 *
 * SteadFast does not support programmatic cancellation. (It DOES support
 * POST /create_return_request — not wired up here yet.)
 */
import process from "node:process";
import type {
  CourierAdapter,
  CourierBookingRequest,
  CourierBookingResult,
  CourierReturnResult,
  CourierStatusResult,
} from "./types";

// portal.steadfast.com.bd does not exist (NXDOMAIN) — the API is served from
// packzy.com. Every booking against the old host died at DNS resolution.
const DEFAULT_BASE_URL = "https://portal.packzy.com/api/v1";
const TIMEOUT_MS = 10_000;

function getConfig() {
  const apiKey = process.env.STEADFAST_API_KEY;
  const secretKey = process.env.STEADFAST_SECRET_KEY;
  const baseUrl = (process.env.STEADFAST_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey || !secretKey) {
    throw new Error(
      "SteadFast credentials not configured: STEADFAST_API_KEY / STEADFAST_SECRET_KEY",
    );
  }

  return { apiKey, secretKey, baseUrl };
}

async function steadfastFetch(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { apiKey, secretKey, baseUrl } = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Api-Key": apiKey,
        "Secret-Key": secretKey,
        ...options.headers,
      },
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── Reconciliation reads ─────────────────────────────────────────────────────
//
// These are NOT part of the CourierAdapter interface: they are SteadFast-only
// money reads, and inventing a cross-provider abstraction from a single
// implementation is how the invented vocabularies got in last time. Pathao's
// equivalents settle differently; when they are wired, the shared shape can be
// extracted from two real cases instead of guessed from one.

/** Shared defensive read — SteadFast answers non-JSON on auth failure. */
async function steadfastRead(path: string): Promise<{ ok: boolean; body: unknown }> {
  try {
    const resp = await steadfastFetch(path);
    const text = await resp.text();
    try {
      return { ok: resp.ok, body: JSON.parse(text) };
    } catch {
      return { ok: false, body: { error: text.slice(0, 500), httpStatus: resp.status } };
    }
  } catch (err) {
    return { ok: false, body: { error: err instanceof Error ? err.message : "Unknown error" } };
  }
}

/**
 * GET /get_balance → { status: 200, current_balance: number }
 *
 * The merchant's collected-but-unsettled COD float. Read-only.
 */
export async function steadfastGetBalance(): Promise<{
  success: boolean;
  balance: number | null;
  error?: string;
}> {
  const { ok, body } = await steadfastRead("/get_balance");
  const parsed = body as { current_balance?: number; error?: string } | null;
  if (ok && typeof parsed?.current_balance === "number") {
    return { success: true, balance: parsed.current_balance };
  }
  return {
    success: false,
    balance: null,
    error: parsed?.error ?? "Could not read SteadFast balance",
  };
}

/** GET /payments — settlement batches SteadFast has paid out to the merchant. */
export async function steadfastListPayments(): Promise<{
  success: boolean;
  payments: unknown[];
  error?: string;
}> {
  const { ok, body } = await steadfastRead("/payments");
  if (!ok) {
    const parsed = body as { error?: string } | null;
    return { success: false, payments: [], error: parsed?.error ?? "Could not read payments" };
  }
  // The endpoint has been observed returning either a bare array or a wrapped
  // { data: [...] }; accept both rather than depending on an undocumented shape.
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown[] })?.data)
      ? ((body as { data: unknown[] }).data ?? [])
      : [];
  return { success: true, payments: list };
}

/**
 * GET /payments/{id} — one settlement batch WITH its consignments.
 *
 * This is the reconciliation payload: it ties each consignment to the fee taken
 * and the amount actually paid out, which is what courier_fee / net_receivable /
 * settlement_reference are meant to hold.
 */
export async function steadfastGetPayment(paymentId: string): Promise<{
  success: boolean;
  payment: unknown | null;
  error?: string;
}> {
  const { ok, body } = await steadfastRead(`/payments/${encodeURIComponent(paymentId)}`);
  if (!ok) {
    const parsed = body as { error?: string } | null;
    return { success: false, payment: null, error: parsed?.error ?? "Could not read payment" };
  }
  return { success: true, payment: (body as { data?: unknown })?.data ?? body };
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export const steadfastAdapter: CourierAdapter = {
  provider: "steadfast",

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    try {
      // delivery_type is numeric and accepts ONLY 0 (home) or 1 (hub pickup).
      // serviceType is free-form per-provider config, so anything that is not
      // exactly 0 or 1 is dropped rather than POSTed — a mis-seeded row (the
      // column shipped holding the invented value 'normal') must degrade to
      // SteadFast's own default, never break the booking.
      const deliveryType = Number(req.serviceType);
      const hasDeliveryType = req.serviceType != null && (deliveryType === 0 || deliveryType === 1);

      const resp = await steadfastFetch("/create_order", {
        method: "POST",
        body: JSON.stringify({
          invoice: req.orderNo,
          recipient_name: req.recipientName,
          recipient_phone: req.recipientPhone,
          recipient_address: req.recipientAddress,
          cod_amount: req.codAmount,
          note: req.note ?? "",
          // Optional fields — omitted entirely when absent. SteadFast validates
          // recipient_email as an email, so an empty string would be rejected.
          ...(req.recipientEmail ? { recipient_email: req.recipientEmail } : {}),
          ...(req.itemDescription ? { item_description: req.itemDescription } : {}),
          ...(hasDeliveryType ? { delivery_type: deliveryType } : {}),
        }),
      });

      const body = await resp.json();

      if (resp.ok && body?.status === 200) {
        const consignmentId = String(body.consignment?.consignment_id ?? "");
        const trackingCode = String(
          body.consignment?.tracking_code ?? body.consignment?.consignment_id ?? "",
        );
        // Guard against a "success" response that carries no usable reference —
        // booking it would flip the order to courier_booked with nothing to track.
        if (!consignmentId && !trackingCode) {
          return {
            success: false,
            consignmentId: null,
            trackingCode: null,
            rawResponse: body,
            error: "SteadFast returned success but no consignment id / tracking code",
          };
        }
        return { success: true, consignmentId, trackingCode, rawResponse: body };
      }

      return {
        success: false,
        consignmentId: null,
        trackingCode: null,
        rawResponse: body,
        error: body?.message || `SteadFast API error: HTTP ${resp.status}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        consignmentId: null,
        trackingCode: null,
        error: message.includes("abort")
          ? "SteadFast API timeout (10s)"
          : `SteadFast API error: ${message}`,
      };
    }
  },

  async checkStatus(consignmentId: string): Promise<CourierStatusResult> {
    // SteadFast does not always answer with JSON: an unauthorised or unknown
    // consignment returns the bare text "Unauthorized Access" (verified live).
    // resp.json() throws a SyntaxError on that, so read text and parse
    // defensively — a status poll must never throw into the caller.
    let body: unknown = null;
    try {
      const resp = await steadfastFetch(`/status_by_cid/${encodeURIComponent(consignmentId)}`);
      const text = await resp.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 500), httpStatus: resp.status };
      }
    } catch (err) {
      body = { error: err instanceof Error ? err.message : "Unknown error" };
    }

    const parsed = body as { delivery_status?: string; updated_at?: string } | null;
    return {
      consignmentId,
      // "unknown" is itself a documented SteadFast status, and mapCourierStatus-
      // ToInternal maps it to a non-transitioning event — so a failed poll is
      // recorded, never mistaken for a delivery outcome.
      status: parsed?.delivery_status ?? "unknown",
      updatedAt: parsed?.updated_at ?? null,
      rawResponse: body,
    };
  },

  // SteadFast does not support API-based cancellation.
  async cancel() {
    return { success: false, error: "SteadFast does not support API cancellation" };
  },

  /**
   * POST /create_return_request — ask SteadFast to collect the parcel back.
   *
   * Accepts consignment_id OR invoice OR tracking_code; we always hold the
   * consignment id, so that is what we send. Documented response is the return
   * request row: { id, user_id, consignment_id, reason, status, … } where
   * status ∈ pending|approved|processing|completed|cancelled.
   *
   * Parses defensively for the same reason as checkStatus: this endpoint also
   * answers "Unauthorized Access" as bare text, and a return request must never
   * throw into the booking orchestrator.
   */
  async createReturn(consignmentId: string, reason?: string): Promise<CourierReturnResult> {
    let body: unknown = null;
    let httpOk = false;
    try {
      const resp = await steadfastFetch("/create_return_request", {
        method: "POST",
        body: JSON.stringify({
          consignment_id: consignmentId,
          ...(reason ? { reason } : {}),
        }),
      });
      httpOk = resp.ok;
      const text = await resp.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 500), httpStatus: resp.status };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        returnRequestId: null,
        status: null,
        error: message.includes("abort")
          ? "SteadFast return request timeout (10s)"
          : `SteadFast return request error: ${message}`,
      };
    }

    const parsed = body as { id?: number | string; status?: string; message?: string } | null;
    // The documented response carries the return-request row directly (no
    // {status:200} envelope like create_order), so success is judged on HTTP
    // plus the presence of an id.
    if (httpOk && parsed?.id != null) {
      return {
        success: true,
        returnRequestId: String(parsed.id),
        status: parsed.status ?? "pending",
        rawResponse: body,
      };
    }

    return {
      success: false,
      returnRequestId: null,
      status: null,
      rawResponse: body,
      error: parsed?.message || "SteadFast rejected the return request",
    };
  },
};
