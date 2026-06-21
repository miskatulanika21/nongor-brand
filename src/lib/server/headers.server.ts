/**
 * Production security headers.
 *
 * Applied to every SSR/HTML response by the server entry. CSP is intentionally
 * scoped: it allows the app's own origin, the configured Supabase project
 * (auth + REST + realtime), Google Fonts, and an optional Upstash endpoint —
 * never a blanket `*`. Inline scripts/styles are permitted because TanStack
 * Start injects hydration scripts and Tailwind emits inline styles; tightening
 * to nonces is a future hardening step that must not break hydration now.
 *
 * The .server.ts suffix keeps this off the client bundle.
 */
import process from "node:process";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Build the Content-Security-Policy value for the current configuration. */
function buildCsp(): string {
  const supabaseOrigin = originOf(process.env.VITE_SUPABASE_URL);
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^http/, "ws") : null;
  const upstashOrigin = originOf(process.env.UPSTASH_REDIS_REST_URL);

  const connectSrc = ["'self'", supabaseOrigin, supabaseWs, upstashOrigin].filter(Boolean);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Hydration + ld+json inline scripts.
    "script-src 'self' 'unsafe-inline'",
    // Tailwind inline styles + Google Fonts stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(" ")}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Apply security headers to a response in place. Adds CSP only to HTML
 * responses; the lighter headers apply to all. HSTS only in production HTTPS.
 */
export function applySecurityHeaders(response: Response, isProd: boolean): void {
  const headers = response.headers;

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  if (isProd) {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    headers.set("Content-Security-Policy", buildCsp());
  }
}
