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
 * CSP tightening (Stage 7 / P1): the ENFORCED policy still carries
 * `script-src 'unsafe-inline'` (hydration must not break). Alongside it we emit a
 * STRICT `Content-Security-Policy-Report-Only` that drops `'unsafe-inline'` in
 * favour of a per-request `'nonce-…'` + `'strict-dynamic'`; TanStack stamps the
 * same nonce onto the scripts it injects, so only genuinely-unexpected inline
 * script executes a violation report (collected at /api/csp-report). Once prod
 * traffic shows the Report-Only policy clean, set CSP_ENFORCE_STRICT=true to
 * promote the strict policy to enforced and retire `'unsafe-inline'`.
 *
 * The .server.ts suffix keeps this off the client bundle.
 */
import process from "node:process";
import { setResponseHeaders } from "@tanstack/react-start/server";

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

  // Vercel Web Analytics + Speed Insights: on Vercel the script is served
  // same-origin (/_vercel/…), but dev/preview load it from this host and the
  // insights beacon can post here too — allow it so RUM isn't CSP-blocked.
  const vercelAnalytics = "https://va.vercel-scripts.com";

  // Sentry ingest (only when error monitoring is configured).
  const sentry = process.env.VITE_SENTRY_DSN ? "https://*.sentry.io" : null;
  const connectSrc = [
    "'self'",
    supabaseOrigin,
    supabaseWs,
    upstashOrigin,
    vercelAnalytics,
    sentry,
  ].filter(Boolean);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Hydration + ld+json inline scripts; Vercel analytics/speed-insights.
    `script-src 'self' 'unsafe-inline' ${vercelAnalytics}`,
    // Tailwind inline styles + Google Fonts stylesheet.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(" ")}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Build the STRICT CSP — nonce + strict-dynamic, no `script-src 'unsafe-inline'`.
 * `strict-dynamic` lets a nonced script load further scripts (e.g. the Vercel
 * analytics injector) without each needing its own nonce, and makes host-source
 * allowlists redundant for scripts, so we drop the analytics host from script-src.
 * style-src keeps `'unsafe-inline'` for now (Tailwind emits inline styles; nonce-ing
 * styles is a separate, more invasive step). Emitted Report-Only until proven.
 *
 * `upgrade-insecure-requests` is a no-op in a Report-Only policy — the browser
 * both ignores it AND logs a console warning about it — so it is only included
 * when this policy will be enforced (`reportOnly: false`). The permissive
 * enforced policy (`buildCsp`) always carries it.
 */
function buildStrictCsp(nonce: string, { reportOnly }: { reportOnly: boolean }): string {
  const supabaseOrigin = originOf(process.env.VITE_SUPABASE_URL);
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^http/, "ws") : null;
  const upstashOrigin = originOf(process.env.UPSTASH_REDIS_REST_URL);
  const vercelAnalytics = "https://va.vercel-scripts.com";
  // Sentry ingest (only when error monitoring is configured).
  const sentry = process.env.VITE_SENTRY_DSN ? "https://*.sentry.io" : null;
  const connectSrc = [
    "'self'",
    supabaseOrigin,
    supabaseWs,
    upstashOrigin,
    vercelAnalytics,
    sentry,
  ].filter(Boolean);

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(" ")}`,
    "report-uri /api/csp-report",
  ];
  // Only meaningful (and warning-free) once this policy is enforced.
  if (!reportOnly) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Return a NEW Response carrying the security headers.
 *
 * Why not mutate in place: some runtimes hand back a Response whose `headers`
 * are guarded/immutable, so an in-place `headers.set(...)` can throw or be a
 * silent no-op — shipping the response without its security headers. We instead
 * clone the header list into a fresh, writable `Headers`, add our headers, and
 * rebuild the Response. This must NOT swallow failures: a throw here should
 * surface (the server entry's outer catch renders a safe error page) rather than
 * quietly emit an unprotected response.
 *
 * Everything else is preserved exactly:
 *   - status + statusText (so redirects keep their 3xx + Location)
 *   - body, including a streaming ReadableStream (passed through, not buffered)
 *   - all existing headers, including multiple Set-Cookie entries
 *
 * Adds CSP only to HTML responses; the lighter headers apply to all. HSTS only
 * in production (assumes HTTPS termination at the edge).
 */
export function withSecurityHeaders(response: Response, isProd: boolean, nonce?: string): Response {
  // `new Headers(response.headers)` copies the full header list, preserving
  // every Set-Cookie entry (undici/Bun keep them as a list, not a merged value).
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  if (isProd) {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    // Once the strict policy is proven clean in prod, CSP_ENFORCE_STRICT=true
    // promotes it to the enforced header (dropping script-src 'unsafe-inline');
    // until then it rides as Report-Only alongside the permissive enforced one.
    const enforceStrict = nonce && process.env.CSP_ENFORCE_STRICT === "true";
    if (enforceStrict) {
      headers.set("Content-Security-Policy", buildStrictCsp(nonce, { reportOnly: false }));
    } else {
      headers.set("Content-Security-Policy", buildCsp());
      if (nonce) {
        headers.set(
          "Content-Security-Policy-Report-Only",
          buildStrictCsp(nonce, { reportOnly: true }),
        );
      }
    }
  }

  // Passing `response.body` transfers the (possibly streaming) body without
  // reading it; null bodies (e.g. 204/redirects) stay null.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function setNoCacheHeaders(): void {
  try {
    setResponseHeaders({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
    } as unknown as Headers);
  } catch {
    // Ignore error if called outside request context (e.g. in test environments)
  }
}
