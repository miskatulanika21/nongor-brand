/**
 * SteadFast webhook endpoint — POST /api/webhook/steadfast
 *
 * Receives delivery status updates from SteadFast Courier.
 *
 * Auth: SteadFast sends `Authorization: Bearer {token}`, where the token is the
 * "Auth Token(Bearer)" you enter alongside the Callback Url at
 * steadfast.com.bd/user/webhook/add. It does NOT send X-Webhook-Secret — checking
 * for that header rejected 100% of real events.
 *
 * Payloads (per the panel's Response Documentation) come in two shapes,
 * discriminated by notification_type:
 *   delivery_status — { consignment_id, invoice, cod_amount, status,
 *                       delivery_charge, tracking_message, updated_at }
 *   tracking_update — { consignment_id, invoice, tracking_message, updated_at }
 *                     ...carrying NO status field.
 *
 * Security:
 *   - Validates the Bearer token against STEADFAST_WEBHOOK_SECRET env
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
        const secret = process.env.STEADFAST_WEBHOOK_SECRET;
        if (!secret) {
          safeServerLog("warn", "SteadFast webhook disabled — STEADFAST_WEBHOOK_SECRET not set");
          return new Response(JSON.stringify({ message: "Webhook processing disabled" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        // SteadFast authenticates with `Authorization: Bearer {token}`.
        const { extractBearerToken } = await import("@/lib/courier-shared");
        const providedSecret = extractBearerToken(request.headers.get("authorization"));
        if (!timingSafeStringEqual(providedSecret, secret)) {
          safeServerLog("warn", "SteadFast webhook: invalid bearer token");
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
            recordShipmentEvent,
          } = await import("@/lib/server/courier.server");

          // Stable idempotency key = SHA-256 of the raw body (no clock), so a
          // byte-identical provider retry is deduped instead of reprocessed.
          const eventId = await webhookEventId("steadfast", rawText);
          const { isNew } = await recordWebhookEvent("steadfast", eventId, body);
          if (isNew) {
            let procError: string | null = null;
            try {
              const consignmentId = String(body.consignment_id ?? "");
              const notificationType = String(body.notification_type ?? "delivery_status");
              if (consignmentId) {
                const shipment = await findShipmentByConsignment("steadfast", consignmentId);
                if (shipment) {
                  if (notificationType === "tracking_update") {
                    // Carries a human tracking_message and NO status. It belongs on
                    // the timeline, but must not touch courier_status — appending it
                    // via update_shipment_status would overwrite a real "delivered"
                    // with "tracking_update".
                    await recordShipmentEvent(shipment.id, "tracking_update", body, "webhook");
                  } else {
                    const internalStatus = mapCourierStatusToInternal(
                      "steadfast",
                      String(body.status ?? ""),
                    );
                    if (internalStatus) {
                      await updateShipmentStatus(shipment.id, internalStatus, body, "webhook");
                    }
                  }
                }
              }
            } catch (err) {
              procError = err instanceof Error ? err.message : "unknown";
            }
            await markWebhookEventProcessed("steadfast", eventId, procError);
            safeServerLog(procError ? "error" : "info", "SteadFast webhook processed", {
              error: procError ?? "none",
            });
          }
        } catch (err) {
          safeServerLog("error", "SteadFast webhook error", {
            error: err instanceof Error ? err.message : "unknown",
          });
        }

        // Always return 200 (never leak state)
        return okResponse();
      },
    },
  },
});
