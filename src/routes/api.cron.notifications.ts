/**
 * Notification outbox drain — GET /api/cron/notifications
 *
 * A catch-up / retry pass over public.notification_events. The primary send path
 * is the best-effort inline drain in the courier webhook handlers; this endpoint
 * exists so anything the inline drain missed (a transient Resend failure, an event
 * enqueued while email was misconfigured) still goes out.
 *
 * Trigger: Vercel Cron (see vercel.json). Vercel automatically sends
 * `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET env var is set, so
 * this route verifies that bearer with a timing-safe comparison. If CRON_SECRET is
 * unset the endpoint is disabled (503) rather than open. No cache.
 *
 * On the Vercel Hobby plan crons only fire daily — the inline drain is what makes
 * notifications timely; this is the safety net.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/cron/notifications")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const process = (await import("node:process")).default;
        const { timingSafeStringEqual, safeServerLog } =
          await import("@/lib/server/security.server");

        const secret = process.env.CRON_SECRET;
        if (!secret) {
          return json({ ok: false, error: "cron_disabled" }, 503);
        }

        const auth = request.headers.get("authorization") ?? "";
        const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!timingSafeStringEqual(provided, secret)) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        try {
          const { drainNotificationOutbox } = await import("@/lib/server/notifications.server");
          const result = await drainNotificationOutbox({ limit: 50 });
          return json({ ok: true, ...result }, 200);
        } catch (e) {
          safeServerLog("error", "notification cron drain failed", {
            message: e instanceof Error ? e.message : "unknown",
          });
          return json({ ok: false, error: "drain_failed" }, 500);
        }
      },
    },
  },
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
