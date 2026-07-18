import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  withSecurityHeaders,
  isPublicCacheableRequest,
  withPublicCache,
} from "./lib/server/headers.server";
import { generateNonce, runWithNonce } from "./lib/server/request-nonce.server";
import { isProduction, ensureEnvValidated } from "./lib/server/env.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const swallowed = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(swallowed);
  void reportServerError(swallowed, { path: "ssr_swallowed" });
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Secure an edge-cacheable response, hardening its CSP with per-script hashes.
 *
 * These pages are rendered nonce-free (see the fetch handler), so hashes are the
 * only way to drop `script-src 'unsafe-inline'` for them. Computing the hashes
 * means BUFFERING the HTML rather than streaming it: the digest covers the whole
 * body, so the last byte must be known before the header can be written.
 *
 * That trade is deliberate and narrowly scoped:
 *   - it applies ONLY to public, anonymous, cacheable pages;
 *   - those are served from the shared edge cache with a long
 *     `stale-while-revalidate`, so only a cache MISS pays the buffering cost and
 *     revalidation happens in the background, off the user's critical path;
 *   - the authenticated/uncacheable paths keep streaming SSR untouched.
 *
 * Anything that is not a plain 200 HTML page (JSON, redirects, errors) is passed
 * through unbuffered — it is not cacheable by `withPublicCache` anyway.
 */
async function secureCacheableResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !contentType.includes("text/html")) {
    return withSecurityHeaders(response, isProduction());
  }

  const { extractInlineScriptHashes } = await import("./lib/server/csp-hash.server");
  const html = await response.text();
  // May be empty — withSecurityHeaders then keeps the permissive policy rather
  // than emitting a hash policy that would block every script on a CACHED page.
  const scriptHashes = extractInlineScriptHashes(html);

  const rebuilt = new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return withSecurityHeaders(rebuilt, isProduction(), undefined, scriptHashes);
}

/** Best-effort Sentry capture (no-op unless SENTRY_DSN is set); never throws. */
async function reportServerError(error: unknown, context?: Record<string, unknown>): Promise<void> {
  try {
    const { captureServerException } = await import("./lib/server/observability.server");
    await captureServerException(error, context);
  } catch {
    // ignore
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // One CSP nonce per request, shared (via AsyncLocalStorage) between
    // getRouter() — which stamps it onto every script TanStack injects — and
    // withSecurityHeaders() below, which puts the same nonce in the CSP. getRouter
    // runs synchronously inside handler.fetch, i.e. inside this ALS scope.
    // Anonymous public pages are served from a shared edge cache (see
    // headers.server.ts). Such pages render NONCE-FREE — a per-request nonce
    // can't be shared across cached hits, and the enforced CSP allows scripts
    // via 'unsafe-inline' without one. Everything else keeps a fresh nonce.
    const cacheable = isPublicCacheableRequest(request);
    const nonce = cacheable ? "" : generateNonce();
    return runWithNonce(nonce, async () => {
      try {
        ensureEnvValidated();
        const handler = await getServerEntry();
        const response = await handler.fetch(request, env, ctx);
        const normalized = await normalizeCatastrophicSsrResponse(response);
        // Rebuild the response with security headers. We no longer swallow a
        // failure here: instead it falls through to the outer catch, which returns
        // a safe error page that is itself passed through withSecurityHeaders. The
        // intent is that a normal response is never emitted without headers; the
        // error-path rebuild is best-effort and not an absolute guarantee.
        if (cacheable) {
          return withPublicCache(await secureCacheableResponse(normalized));
        }
        return withSecurityHeaders(normalized, isProduction(), nonce);
      } catch (error) {
        console.error(error);
        await reportServerError(error, { path: "ssr_fetch" });
        const errorResponse = new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
        return withSecurityHeaders(errorResponse, isProduction(), nonce);
      }
    });
  },
};
