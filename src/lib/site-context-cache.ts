/**
 * Client-side memo of the /_site layout context (session summary + public
 * settings). The layout's beforeLoad re-runs on EVERY in-site navigation and
 * each run costs two server-function round-trips, which is what made page
 * transitions feel like full reloads — so on the client we reuse the last
 * result for a short TTL instead of refetching per click.
 *
 * SSR is untouched: on the server there is no module persistence per request
 * worth reusing, and every document load must reflect the real session, so the
 * cache is client-only. Auth transitions (login/logout) call bustSiteContext()
 * so the header flips immediately rather than after the TTL.
 */
let cached: { at: number; value: unknown } | null = null;
const TTL_MS = 60_000;

export function getCachedSiteContext<T>(): T | null {
  if (typeof window === "undefined" || !cached) return null;
  return Date.now() - cached.at < TTL_MS ? (cached.value as T) : null;
}

export function setCachedSiteContext(value: unknown) {
  if (typeof window !== "undefined") cached = { at: Date.now(), value };
}

/** Call after any successful login/logout so the next navigation refetches. */
export function bustSiteContext() {
  cached = null;
}
