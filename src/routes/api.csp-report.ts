/**
 * CSP violation collector — POST /api/csp-report
 *
 * Receives Content-Security-Policy-Report-Only violation reports from browsers
 * (report-uri). During the Stage-7 CSP tightening watch period this is how we
 * see whether the strict nonce policy would break anything before flipping
 * CSP_ENFORCE_STRICT=true. It only logs (rate-limited, size-capped, no PII, no
 * state change) and always returns 204.
 *
 * Body shape is `{ "csp-report": { "blocked-uri", "violated-directive", ... } }`
 * (report-uri) — we log a trimmed subset, never the full document context.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { safeServerLog } = await import("@/lib/server/security.server");
        const { checkRateLimit } = await import("@/lib/server/rate-limit.server");

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        // Reuse a generous existing bucket; a noisy browser must not flood logs.
        const rl = await checkRateLimit("courierWebhook", [`csp:${ip}`]);
        if (!rl.allowed) return new Response(null, { status: 204 });

        // Cap the read body; reports are tiny.
        if (Number(request.headers.get("content-length") ?? "0") > 16384) {
          return new Response(null, { status: 204 });
        }
        const raw = await request.text();
        if (raw.length > 16384) return new Response(null, { status: 204 });

        try {
          const parsed = JSON.parse(raw) as { "csp-report"?: Record<string, unknown> };
          const r = parsed["csp-report"] ?? {};
          safeServerLog("warn", "CSP violation (report-only)", {
            directive: String(r["violated-directive"] ?? r["effective-directive"] ?? "unknown"),
            blocked: String(r["blocked-uri"] ?? "unknown").slice(0, 200),
          });
        } catch {
          // Ignore malformed reports.
        }

        return new Response(null, { status: 204 });
      },
    },
  },
});
