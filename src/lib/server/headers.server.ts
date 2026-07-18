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
 * CSP tightening (Stage 7 / P1): the default ENFORCED policy still carries
 * `script-src 'unsafe-inline'` (hydration must not break). Alongside it we emit a
 * hardened `Content-Security-Policy-Report-Only` that drops `'unsafe-inline'`.
 * Setting CSP_ENFORCE_STRICT=true promotes the hardened policy to enforced.
 *
 * There are TWO hardened policies, because how a response is SERVED decides what
 * can secure it:
 *
 *   buildStrictCsp — nonce + `'strict-dynamic'`, for uncacheable pages. TanStack
 *     stamps the same per-request nonce onto every script it injects.
 *
 *   buildHashCsp   — a `'sha256-…'` per inline script, for pages served from the
 *     shared edge cache. Those are rendered NONCE-FREE on purpose: a nonce
 *     replayed across cached hits is not a secret and secures nothing. Hashes are
 *     derived from the body, so policy and body cache together as one unit.
 *
 * A response that has neither (e.g. hash extraction found nothing) keeps the
 * permissive policy — see csp-hash.server.ts for why this fails open.
 *
 * Historical note: before the hashed policy existed, cached public pages had no
 * nonce and so silently fell through to the permissive policy. CSP_ENFORCE_STRICT
 * appeared to harden the site while leaving the entire storefront — `/`, `/shop`,
 * `/product/*` — on `'unsafe-inline'`, and those pages never emitted a
 * Report-Only header to reveal it.
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

// Vercel Web Analytics + Speed Insights: on Vercel the script is served
// same-origin (/_vercel/…), but dev/preview load it from this host and the
// insights beacon can post here too — allow it so RUM isn't CSP-blocked.
const VERCEL_ANALYTICS = "https://va.vercel-scripts.com";

/**
 * The `connect-src` allowlist, shared by all three policies (permissive,
 * strict-nonce, hashed). Read from env on every call so a test or a redeploy
 * that changes the Supabase/Upstash/Sentry configuration is reflected.
 */
function buildConnectSrc(): string[] {
  const supabaseOrigin = originOf(process.env.VITE_SUPABASE_URL);
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^http/, "ws") : null;
  const upstashOrigin = originOf(process.env.UPSTASH_REDIS_REST_URL);
  // Sentry ingest (only when error monitoring is configured).
  const sentry = process.env.VITE_SENTRY_DSN ? "https://*.sentry.io" : null;
  return ["'self'", supabaseOrigin, supabaseWs, upstashOrigin, VERCEL_ANALYTICS, sentry].filter(
    Boolean,
  ) as string[];
}

/** Build the Content-Security-Policy value for the current configuration. */
function buildCsp(): string {
  const vercelAnalytics = VERCEL_ANALYTICS;
  const connectSrc = buildConnectSrc();

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
 * Build the STRICT CSP — nonce + strict-dynamic, for pages that are NOT edge
 * cached (a nonce cannot be reused across cached hits; those use buildHashCsp).
 *
 * `'unsafe-inline'` is still listed but is NOT in force: per CSP3 a browser that
 * understands nonces ignores it entirely. It is retained purely as a fallback
 * for CSP1/CSP2-only browsers, which ignore the nonce instead — the standard
 * backwards-compatible strict-CSP recipe, not a hole.
 *
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
  const connectSrc = buildConnectSrc();

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
 * Build the HASHED CSP — for edge-cached public pages, which are rendered
 * nonce-free (a nonce replayed from cache is not a secret, so it buys nothing).
 * Each inline script is allowed by its own `'sha256-…'`; see csp-hash.server.ts
 * for why `'strict-dynamic'` is deliberately NOT used on this path.
 *
 * `'self'` stays in `script-src` to cover the parser-inserted external bundle.
 * Critically there is no `'unsafe-inline'`: per CSP3, once a hash-source is
 * present `'unsafe-inline'` would be ignored anyway, so including it would be
 * pure noise — and its absence is the entire point of this policy.
 *
 * The result is a pure function of the response body, so it caches with that
 * body and the two can never drift apart.
 */
function buildHashCsp(scriptHashes: string[], { reportOnly }: { reportOnly: boolean }): string {
  const connectSrc = buildConnectSrc();

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' ${scriptHashes.join(" ")} ${VERCEL_ANALYTICS}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(" ")}`,
    "report-uri /api/csp-report",
  ];
  // A no-op in Report-Only (browsers ignore it AND warn about it).
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
export function withSecurityHeaders(
  response: Response,
  isProd: boolean,
  nonce?: string,
  scriptHashes?: string[],
): Response {
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
    // Two hardened policies, picked by how this response is served:
    //   - nonced       → uncacheable/authenticated pages (strict-dynamic)
    //   - hashed       → edge-cached public pages (per-script sha256)
    // Whichever applies rides as Report-Only until CSP_ENFORCE_STRICT=true
    // promotes it to enforced, retiring script-src 'unsafe-inline'.
    //
    // A response with NEITHER a nonce nor hashes cannot be hardened, so it keeps
    // the permissive policy. That is the fail-open path described in
    // csp-hash.server.ts: emitting a hash policy we could not build would block
    // every script on a page that is then cached and served to everyone.
    const strictRequested = process.env.CSP_ENFORCE_STRICT === "true";
    const hardened = nonce
      ? (reportOnly: boolean) => buildStrictCsp(nonce, { reportOnly })
      : scriptHashes?.length
        ? (reportOnly: boolean) => buildHashCsp(scriptHashes, { reportOnly })
        : null;

    if (hardened && strictRequested) {
      headers.set("Content-Security-Policy", hardened(false));
    } else {
      headers.set("Content-Security-Policy", buildCsp());
      if (hardened) {
        headers.set("Content-Security-Policy-Report-Only", hardened(true));
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

// ── Public edge caching ──────────────────────────────────────────────────────
// The framework defaults SSR HTML to `no-store`, so every visit re-renders on
// the server (slow TTFB, worse on cold starts). The pages below are IDENTICAL
// for every anonymous visitor, so they are safe to serve from a shared edge
// cache. Three independent guards keep per-user data out of that cache:
//   1. an ALLOWLIST of public paths (a new private route is never cached by
//      accident — denylists fail open, allowlists fail closed);
//   2. the request must carry NO Supabase auth cookie (authenticated visitors
//      always get a fresh, uncached render — see server.ts);
//   3. the response must be a plain 200 HTML page that sets no cookie.

const PUBLIC_CACHEABLE_PREFIXES = ["/shop", "/product", "/about", "/size-guide", "/new-arrivals"];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_CACHEABLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** A Supabase session lives in `sb-<ref>-auth-token[.<chunk>]`; its presence = logged in. */
function hasAuthCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie");
  return cookie != null && /(?:^|;\s*)sb-[^=;]*-auth-token/i.test(cookie);
}

/**
 * True when a request may be served from a shared edge cache: a GET/HEAD for a
 * public page by an anonymous visitor. Authenticated requests are NEVER
 * cacheable, so one user's response can never populate the shared cache.
 */
export function isPublicCacheableRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (hasAuthCookie(request)) return false;
  try {
    return isPublicPath(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Promote a public response to a shared edge cache — applied only to
 * {@link isPublicCacheableRequest} responses, and only when the response itself
 * is a plain 200 HTML page that sets no cookie (so nothing per-user is stored).
 * `stale-while-revalidate` keeps every hit instant while the edge refreshes in
 * the background; the short `s-maxage` bounds how long a catalog edit takes to
 * appear. Replaces the framework's `no-store` trio.
 */
export function withPublicCache(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (
    response.status !== 200 ||
    !contentType.includes("text/html") ||
    response.headers.has("set-cookie")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=86400");
  headers.delete("Pragma");
  headers.delete("Expires");
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
