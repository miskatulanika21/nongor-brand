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

// ── Adapter ──────────────────────────────────────────────────────────────────

export const steadfastAdapter: CourierAdapter = {
  provider: "steadfast",

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    try {
      const resp = await steadfastFetch("/create_order", {
        method: "POST",
        body: JSON.stringify({
          invoice: req.orderNo,
          recipient_name: req.recipientName,
          recipient_phone: req.recipientPhone,
          recipient_address: req.recipientAddress,
          cod_amount: req.codAmount,
          note: req.note ?? "",
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
};
