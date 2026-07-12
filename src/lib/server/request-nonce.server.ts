/**
 * Per-request CSP nonce plumbing — SERVER ONLY.
 *
 * A fresh nonce is generated per request in the server entry and stored in an
 * AsyncLocalStorage. Two consumers read it back within the same request:
 *   1. getRouter() (router.tsx) sets `ssr.nonce`, so TanStack tags every script
 *      it injects (hydration state + ld+json) with `nonce="…"` and drops a
 *      `<meta property="csp-nonce">` for client-inserted scripts.
 *   2. withSecurityHeaders() (headers.server.ts) puts the same nonce in the CSP.
 *
 * router.tsx is isomorphic and must not statically import a server module, so
 * this module installs a global accessor that getRouter reads only under an
 * `import.meta.env.SSR` guard (dead-code-eliminated from the client bundle).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

const storage = new AsyncLocalStorage<string>();

/** Global key the isomorphic router reads (server-side only). */
export const NONCE_GLOBAL_KEY = "__nongorr_request_nonce__";

// Install a sync accessor on globalThis so the isomorphic getRouter can read the
// current request's nonce without importing this (.server) module.
(globalThis as Record<string, unknown>)[NONCE_GLOBAL_KEY] = () => storage.getStore();

/** Generate a fresh base64 nonce for a request. */
export function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

/** Run `fn` with `nonce` bound as the current request's nonce. */
export function runWithNonce<T>(nonce: string, fn: () => T): T {
  return storage.run(nonce, fn);
}

/** The current request's nonce, if inside a runWithNonce scope. */
export function getRequestNonce(): string | undefined {
  return storage.getStore();
}
