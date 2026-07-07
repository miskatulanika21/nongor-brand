/**
 * SteadFast webhook endpoint — POST /api/webhook/steadfast
 *
 * Receives delivery status updates from SteadFast Courier.
 *
 * Security:
 *   - Validates X-Webhook-Secret header against STEADFAST_WEBHOOK_SECRET env
 *   - If the env is not set, webhook processing is DISABLED (returns 503)
 *   - Body limit: 64KB
 *   - Rate limited per IP (courierWebhook)
 *   - Idempotent via webhook_events dedup
 *   - Generic 200 response (never leaks internal state)
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/webhook/steadfast")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // Dynamic imports to keep the bundle lean
        const process = (await import("node:process")).default;
        const { safeServerLog } = await import("@/lib/server/security.server");
        const { checkRateLimit, rateLimitMessage } = await import("@/lib/server/rate-limit.server");

        // ── Rate limit ──────────────────────────────────────────────────
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const rl = await checkRateLimit("courierWebhook", [ip]);
        if (!rl.allowed) {
          return new Response(JSON.stringify({ message: rateLimitMessage() }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rl.retryAfterSec),
            },
          });
        }

        // ── Webhook secret check ────────────────────────────────────────
        const secret = process.env.STEADFAST_WEBHOOK_SECRET;
        if (!secret) {
          safeServerLog("warn", "SteadFast webhook disabled — STEADFAST_WEBHOOK_SECRET not set");
          return new Response(JSON.stringify({ message: "Webhook processing disabled" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        const providedSecret = request.headers.get("x-webhook-secret") ?? "";
        if (providedSecret !== secret) {
          safeServerLog("warn", "SteadFast webhook: invalid secret");
          return new Response(JSON.stringify({ message: "OK" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ── Body limit ──────────────────────────────────────────────────
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 65536) {
          return new Response(JSON.stringify({ message: "OK" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ── Parse body ──────────────────────────────────────────────────
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(JSON.stringify({ message: "OK" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ── Process ─────────────────────────────────────────────────────
        try {
          const { recordWebhookEvent, findShipmentByConsignment, updateShipmentStatus } =
            await import("@/lib/server/courier.server");
          const { mapCourierStatusToInternal } = await import("@/lib/courier-shared");

          // SteadFast sends: { consignment_id, status, invoice, ... }
          const consignmentId = String(body.consignment_id ?? "");
          const rawStatus = String(body.status ?? "");
          const eventId = `steadfast-${consignmentId}-${rawStatus}-${Date.now()}`;

          // Idempotent event recording
          const { isNew } = await recordWebhookEvent("steadfast", eventId, body);
          if (!isNew) {
            return new Response(JSON.stringify({ message: "OK" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Find the shipment
          if (consignmentId) {
            const shipment = await findShipmentByConsignment("steadfast", consignmentId);
            if (shipment) {
              const internalStatus = mapCourierStatusToInternal("steadfast", rawStatus);
              if (internalStatus) {
                await updateShipmentStatus(shipment.id, internalStatus, body, "webhook");
              }
            }
          }

          safeServerLog("info", "SteadFast webhook processed", {
            consignmentId,
            status: rawStatus,
          });
        } catch (err) {
          safeServerLog("error", "SteadFast webhook processing error", {
            error: err instanceof Error ? err.message : "unknown",
          });
        }

        // Always return 200 (never leak state)
        return new Response(JSON.stringify({ message: "OK" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
