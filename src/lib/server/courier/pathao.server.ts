/**
 * Pathao Courier adapter.
 *
 * Base URL from PATHAO_BASE_URL / PATHAO_SANDBOX_BASE_URL env.
 * Auth: OAuth2 client_credentials → Bearer token, cached in-memory with TTL.
 *
 * Uses the 2025+ auto-address payload — full `recipient_address` only,
 * no separate city/zone/area fields.
 *
 * Endpoints:
 *   POST /aladdin/api/v1/issue-token  — get access token
 *   GET  /aladdin/api/v1/stores       — list merchant stores
 *   POST /aladdin/api/v1/orders       — create order
 *   GET  /aladdin/api/v1/orders/{id}  — check status
 */
import process from "node:process";
import type {
  CourierAdapter,
  CourierBookingRequest,
  CourierBookingResult,
  CourierStatusResult,
} from "./types";

const TIMEOUT_MS = 15_000;

// ── Token cache ──────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Date.now() ms
}

let tokenCache: TokenCache | null = null;

function getConfig(sandbox: boolean) {
  if (sandbox) {
    return {
      baseUrl: (
        process.env.PATHAO_SANDBOX_BASE_URL || "https://courier-api-sandbox.pathao.com"
      ).replace(/\/+$/, ""),
      clientId: process.env.PATHAO_SANDBOX_CLIENT_ID || "",
      clientSecret: process.env.PATHAO_SANDBOX_CLIENT_SECRET || "",
      username: process.env.PATHAO_SANDBOX_USERNAME,
      password: process.env.PATHAO_SANDBOX_PASSWORD,
    };
  }
  return {
    baseUrl: (process.env.PATHAO_BASE_URL || "https://api-hermes.pathao.com").replace(/\/+$/, ""),
    clientId: process.env.PATHAO_CLIENT_ID || "",
    clientSecret: process.env.PATHAO_CLIENT_SECRET || "",
    // Production uses the SAME password grant as sandbox — these are the merchant
    // panel login credentials, not a separate API user. See getAccessToken.
    username: process.env.PATHAO_USERNAME,
    password: process.env.PATHAO_PASSWORD,
  };
}

function isSandbox(): boolean {
  // Check if sandbox is enabled. In production, this would come from
  // courier_providers.sandbox_enabled, but env-level override takes precedence.
  return process.env.PATHAO_SANDBOX_ENABLED === "true";
}

/**
 * Store ids are issued per environment — a production store_id does not exist in
 * sandbox (verified: prod store 410847 is absent from the sandbox store list).
 * Sending the wrong one books against a stranger's store or fails outright, so
 * sandbox reads its own id and never silently falls back to the production one.
 */
function getStoreId(): string {
  const sandbox = isSandbox();
  const storeId = sandbox ? process.env.PATHAO_SANDBOX_STORE_ID : process.env.PATHAO_STORE_ID;
  if (!storeId) {
    const varName = sandbox ? "PATHAO_SANDBOX_STORE_ID" : "PATHAO_STORE_ID";
    throw new Error(
      `${varName} is not configured. Set it in env or fetch it via the /stores endpoint. ` +
        `Store ids are environment-specific — do not reuse the production id in sandbox.`,
    );
  }
  return storeId;
}

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s safety margin)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const config = getConfig(isSandbox());
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Pathao credentials not configured: PATHAO_CLIENT_ID / PATHAO_CLIENT_SECRET");
  }
  // The docs are unambiguous: "Must use grant type password for issue token api."
  // There is no client_credentials grant — sending one fails auth outright, so
  // username/password are required in production, not just sandbox.
  if (!config.username || !config.password) {
    throw new Error(
      "Pathao credentials not configured: PATHAO_USERNAME / PATHAO_PASSWORD " +
        "(the merchant panel login — Pathao's issue-token API only supports the password grant).",
    );
  }

  const body: Record<string, string> = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "password",
    username: config.username,
    password: config.password,
  };

  const resp = await fetch(`${config.baseUrl}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Pathao token request failed: HTTP ${resp.status} — ${errBody}`);
  }

  const data = await resp.json();
  const accessToken = data.access_token || data.token;
  if (!accessToken) {
    throw new Error("Pathao token response missing access_token");
  }

  // Cache with TTL. Always trust the response: the docs say expires_in is
  // 432000, but sandbox actually returned 7776000 (90d) when measured on
  // 2026-07-17 — so don't hard-code either. The 1h fallback applies only if the
  // field is absent, and stays short so a wrong guess self-heals.
  const expiresIn = (data.expires_in || 3600) * 1000;
  tokenCache = { accessToken, expiresAt: Date.now() + expiresIn };

  return accessToken;
}

/** Clear cached token (used on 401 to force refresh). */
function clearTokenCache(): void {
  tokenCache = null;
}

async function pathaoFetch(
  path: string,
  options: RequestInit & { retry401?: boolean } = {},
): Promise<Response> {
  const config = getConfig(isSandbox());
  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    // Auto-refresh on 401 (once)
    if (resp.status === 401 && options.retry401 !== false) {
      clearTokenCache();
      return pathaoFetch(path, { ...options, retry401: false });
    }

    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export const pathaoAdapter: CourierAdapter = {
  provider: "pathao",

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    try {
      const storeId = getStoreId();
      const resp = await pathaoFetch("/aladdin/api/v1/orders", {
        method: "POST",
        body: JSON.stringify({
          store_id: Number(storeId),
          merchant_order_id: req.orderNo,
          recipient_name: req.recipientName,
          recipient_phone: req.recipientPhone,
          recipient_address: req.recipientAddress,
          // Auto-address: do NOT send recipient_city/zone/area
          delivery_type: Number(req.serviceType) || 48,
          item_type: 2, // parcel
          item_quantity: 1,
          item_weight: String(req.weight ?? 0.5),
          amount_to_collect: req.codAmount,
          special_instruction: req.note ?? "",
          item_description: `Nongorr order ${req.orderNo}`,
        }),
      });

      const body = await resp.json();

      if (resp.ok && body?.type === "success") {
        const consignmentId = String(body.data?.consignment_id ?? "");
        // A success without a consignment id is unusable — treat it as a failure
        // so the order is not flipped to courier_booked with nothing to track.
        if (!consignmentId) {
          return {
            success: false,
            consignmentId: null,
            trackingCode: null,
            rawResponse: body,
            error: "Pathao returned success but no consignment id",
          };
        }
        return {
          success: true,
          consignmentId,
          trackingCode: consignmentId,
          rawResponse: body,
        };
      }

      // Pathao error format: { message, type, code, errors }
      const errMsg =
        body?.message || body?.errors
          ? `Pathao: ${body.message || ""} ${JSON.stringify(body.errors || {})}`
          : `Pathao API error: HTTP ${resp.status}`;

      return {
        success: false,
        consignmentId: null,
        trackingCode: null,
        rawResponse: body,
        error: errMsg,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        consignmentId: null,
        trackingCode: null,
        error: message.includes("abort")
          ? "Pathao API timeout (15s)"
          : `Pathao API error: ${message}`,
      };
    }
  },

  async checkStatus(consignmentId: string): Promise<CourierStatusResult> {
    // "Get Order Short Info" is /orders/{cid}/info — there is no bare GET
    // /orders/{cid}, so the old path could only ever have 404'd.
    //
    // Parse defensively for the same reason as the SteadFast adapter: a gateway
    // error or an expired-token HTML page is not JSON, and a status poll must
    // never throw into the caller.
    let body: unknown = null;
    try {
      const resp = await pathaoFetch(
        `/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`,
      );
      const text = await resp.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 500), httpStatus: resp.status };
      }
    } catch (err) {
      body = { error: err instanceof Error ? err.message : "Unknown error" };
    }

    const data = (body as { data?: Record<string, unknown> } | null)?.data;
    return {
      consignmentId,
      // Doc returns both order_status ("Pending") and order_status_slug; either
      // spelling resolves via mapCourierStatusToInternal. An unresolvable poll
      // yields "unknown", which maps to null (recorded, no transition).
      status: (data?.order_status_slug as string) ?? (data?.order_status as string) ?? "unknown",
      updatedAt: (data?.updated_at as string) ?? null,
      rawResponse: body,
    };
  },

  // Pathao does not expose a public cancel API.
  async cancel() {
    return { success: false, error: "Pathao does not support API cancellation" };
  },
};
