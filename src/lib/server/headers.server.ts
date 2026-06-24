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
export function withSecurityHeaders(response: Response, isProd: boolean): Response {
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
    headers.set("Content-Security-Policy", buildCsp());
  }

  // Passing `response.body` transfers the (possibly streaming) body without
  // reading it; null bodies (e.g. 204/redirects) stay null.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Set Cache-Control: private, no-store on the current server response.
 * Safely imports setResponseHeaders from @tanstack/react-start/server.
 */
export function setNoCacheHeaders(): void {
  try {
    const { setResponseHeaders } = require("@tanstack/react-start/server");
  } catch {
    // If require is not defined in ESM, we dynamically import it
    import("@tanstack/react-start/server").then(({ setResponseHeaders }) => {
      setResponseHeaders({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        Expires: "0",
      } as unknown as Headers);
    }).catch(() => {});
    return;
  }
  
  // If require succeeded (e.g. CommonJS context in tests/build), call it
  try {
    const { setResponseHeaders } = require("@tanstack/react-start/server");
    setResponseHeaders({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
    } as unknown as Headers);
  } catch {}
}
