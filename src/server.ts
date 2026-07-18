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
        const secured = withSecurityHeaders(normalized, isProduction(), nonce || undefined);
        return cacheable ? withPublicCache(secured) : secured;
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
