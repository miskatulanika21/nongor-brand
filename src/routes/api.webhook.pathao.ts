/**
 * Pathao webhook endpoint — POST /api/webhook/pathao
 *
 * Receives delivery status updates from Pathao Courier.
 *
 * Security:
 *   - Validates X-Webhook-Secret header against PATHAO_WEBHOOK_SECRET env
 *   - If the env is not set, webhook processing is DISABLED (returns 503)
 *   - Body limit: 64KB
 *   - Rate limited per IP (courierWebhook)
 *   - Idempotent via webhook_events dedup
 *   - Generic 200 response (never leaks internal state)
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/webhook/pathao")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
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
        const secret = process.env.PATHAO_WEBHOOK_SECRET;
        if (!secret) {
          safeServerLog("warn", "Pathao webhook disabled — PATHAO_WEBHOOK_SECRET not set");
          return new Response(JSON.stringify({ message: "Webhook processing disabled" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        const providedSecret = request.headers.get("x-webhook-secret") ?? "";
        if (providedSecret !== secret) {
          safeServerLog("warn", "Pathao webhook: invalid secret");
          return new Response(JSON.stringify({ message: "OK" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const okResponse = () =>
          new Response(JSON.stringify({ message: "OK" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });

        // ── Body limit ──────────────────────────────────────────────────
        // content-length is only a cheap fast-path reject (it can be absent or
        // spoofed); the real cap is enforced on the actually-read body text.
        if (Number(request.headers.get("content-length") ?? "0") > 65536) {
          return okResponse();
        }
        const rawText = await request.text();
        if (rawText.length > 65536) {
          return okResponse();
        }

        // ── Parse body ──────────────────────────────────────────────────
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          return okResponse();
        }

        // ── Idempotent processing ───────────────────────────────────────
        try {
          const { webhookEventId, mapCourierStatusToInternal } =
            await import("@/lib/courier-shared");
          const {
            recordWebhookEvent,
            markWebhookEventProcessed,
            findShipmentByConsignment,
            updateShipmentStatus,
          } = await import("@/lib/server/courier.server");

          // Stable idempotency key = SHA-256 of the raw body (no clock), so a
          // byte-identical provider retry is deduped instead of reprocessed.
          const eventId = await webhookEventId("pathao", rawText);
          const { isNew } = await recordWebhookEvent("pathao", eventId, body);
          if (isNew) {
            let procError: string | null = null;
            try {
              // Pathao sends: { consignment_id, order_status, ... }
              const consignmentId = String(body.consignment_id ?? "");
              const rawStatus = String(body.order_status ?? body.status ?? "");
              if (consignmentId) {
                const shipment = await findShipmentByConsignment("pathao", consignmentId);
                if (shipment) {
                  const internalStatus = mapCourierStatusToInternal("pathao", rawStatus);
                  if (internalStatus) {
                    await updateShipmentStatus(shipment.id, internalStatus, body, "webhook");
                  }
                }
              }
            } catch (err) {
              procError = err instanceof Error ? err.message : "unknown";
            }
            await markWebhookEventProcessed("pathao", eventId, procError);
            safeServerLog(procError ? "error" : "info", "Pathao webhook processed", {
              error: procError ?? "none",
            });
          }
        } catch (err) {
          safeServerLog("error", "Pathao webhook error", {
            error: err instanceof Error ? err.message : "unknown",
          });
        }

        // Always return 200 (never leak state)
        return okResponse();
      },
    },
  },
});
