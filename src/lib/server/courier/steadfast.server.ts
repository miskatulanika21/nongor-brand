/**
 * SteadFast Courier adapter.
 *
 * Base URL from STEADFAST_BASE_URL env (default: portal.steadfast.com.bd/api/v1).
 * Auth via Api-Key + Secret-Key headers from env.
 *
 * Endpoints:
 *   POST /create_order         — book a parcel
 *   GET  /status_by_cid/{cid}  — check status by consignment ID
 *
 * SteadFast does not support programmatic cancellation.
 */
import process from "node:process";
import type {
  CourierAdapter,
  CourierBookingRequest,
  CourierBookingResult,
  CourierStatusResult,
} from "./types";

const DEFAULT_BASE_URL = "https://portal.steadfast.com.bd/api/v1";
const TIMEOUT_MS = 10_000;

function getConfig() {
  const apiKey = process.env.STEADFAST_API_KEY;
  const secretKey = process.env.STEADFAST_SECRET_KEY;
  const baseUrl = (process.env.STEADFAST_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey || !secretKey) {
    throw new Error("SteadFast credentials not configured: STEADFAST_API_KEY / STEADFAST_SECRET_KEY");
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
        return {
          success: true,
          consignmentId: String(body.consignment?.consignment_id ?? ""),
          trackingCode: String(body.consignment?.tracking_code ?? body.consignment?.consignment_id ?? ""),
          rawResponse: body,
        };
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
    const resp = await steadfastFetch(`/status_by_cid/${encodeURIComponent(consignmentId)}`);
    const body = await resp.json();

    return {
      consignmentId,
      status: body?.delivery_status ?? "unknown",
      updatedAt: body?.updated_at ?? null,
      rawResponse: body,
    };
  },

  // SteadFast does not support API-based cancellation.
  async cancel() {
    return { success: false, error: "SteadFast does not support API cancellation" };
  },
};
