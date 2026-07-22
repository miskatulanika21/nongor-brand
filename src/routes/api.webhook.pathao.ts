/**
 * Pathao webhook endpoint — POST /api/webhook/pathao
 *
 * Receives delivery status updates from Pathao Courier.
 *
 * Auth: Pathao sends `X-PATHAO-Signature` containing the secret you entered when
 * registering the webhook. It does NOT send X-Webhook-Secret — checking for that
 * header rejected 100% of real events.
 *
 * Registration: clicking "Add Webhook" in the merchant panel first probes this
 * URL with { event: "webhook_integration" }. Pathao only accepts the URL if we
 * answer HTTP 202 AND echo the header X-Pathao-Merchant-Webhook-Integration-Secret
 * with their fixed constant. Without that handshake the URL cannot be registered
 * at all, so no event ever arrives.
 *
 * Payload: the status travels in `event` as a dotted-kebab slug (e.g.
 * "order.delivered") — order_status/status are absent. See courier-shared.ts for
 * the full 24-event vocabulary.
 *
 * Security:
 *   - Validates X-PATHAO-Signature against PATHAO_WEBHOOK_SECRET env
 *   - If the env is not set, webhook processing is DISABLED (returns 503).
 *     Set the env BEFORE clicking "Add Webhook", or registration will fail.
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
        const { safeServerLog, timingSafeStringEqual } =
          await import("@/lib/server/security.server");
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

        // ── Registration handshake ──────────────────────────────────────
        // Must precede the signature check: Pathao's probe carries no signature,
        // so authenticating it first would fail every registration attempt. The
        // echoed value is a published constant, so answering reveals nothing —
        // and a caller who forges this still cannot deliver events, since real
        // events are signature-checked below.
        const { isPathaoIntegrationProbe, PATHAO_INTEGRATION_SECRET } =
          await import("@/lib/courier-shared");
        if (isPathaoIntegrationProbe(body)) {
          safeServerLog("info", "Pathao webhook: registration handshake");
          return new Response(JSON.stringify({ message: "Webhook integration successful" }), {
            status: 202,
            headers: {
              "Content-Type": "application/json",
              "X-Pathao-Merchant-Webhook-Integration-Secret": PATHAO_INTEGRATION_SECRET,
            },
          });
        }

        // ── Signature check ─────────────────────────────────────────────
        const providedSecret = request.headers.get("x-pathao-signature") ?? "";
        if (!timingSafeStringEqual(providedSecret, secret)) {
          safeServerLog("warn", "Pathao webhook: invalid signature");
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
              // Pathao sends: { consignment_id, merchant_order_id, updated_at,
              //                 timestamp, store_id, event, delivery_fee }
              // The status is `event` ("order.delivered"). The old code read
              // order_status/status — neither exists on the payload, so rawStatus
              // was always "" and no shipment ever transitioned.
              const consignmentId = String(body.consignment_id ?? "");
              const rawStatus = String(body.event ?? "");
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

            // Best-effort: push any freshly-enqueued customer notification now, so
            // shipment emails go out within seconds instead of waiting for the
            // daily cron catch-up. Never blocks the webhook's 200 response.
            if (!procError) {
              const { drainNotificationsBestEffort } =
                await import("@/lib/server/notifications.server");
              await drainNotificationsBestEffort();
            }
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
