/**
 * Process-memory TTL cache for PUBLIC, anonymous reads — SERVER ONLY.
 *
 * The storefront's session-summary, public settings and catalog are identical
 * for every visitor, yet each page render re-queried Supabase for them. This
 * memoizes a zero-arg async loader per key for a short TTL, so a warm
 * serverless instance answers repeat requests from memory instead of the DB.
 *
 * Scope rules (important):
 *   - PUBLIC data only. The cached value is shared across ALL requests hitting
 *     the same warm instance, so never wrap anything user-scoped or secret.
 *   - Correctness bound is the TTL: an admin edit to settings/catalog becomes
 *     visible within `ttlMs` (memory is per-instance, so cross-instance
 *     invalidation isn't possible on serverless — the TTL is the guarantee).
 *
 * In-flight de-dup: concurrent misses on a cold instance share one promise, so
 * a burst of first requests issues a single query rather than one each.
 *
 * Stale-on-error: when a refresh FAILS (Supabase slow, paused, or overloaded in
 * a rush) and this instance still holds a value younger than `maxStaleMs`, the
 * last good value is served instead of an error page — the same
 * "stale-if-error" behaviour CDNs offer, applied one layer down. A shopper sees
 * a catalog that is a few minutes old rather than "This page didn't load".
 */
type Entry<T> = { at: number; value: T };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Default ceiling for serving a stale value after a failed refresh. */
export const DEFAULT_MAX_STALE_MS = 15 * 60_000;

export function cachedPublic<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  maxStaleMs: number = DEFAULT_MAX_STALE_MS,
): () => Promise<T> {
  return async () => {
    const hit = store.get(key) as Entry<T> | undefined;
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const p = (async () => {
      try {
        const value = await loader();
        store.set(key, { at: Date.now(), value });
        return value;
      } catch (error) {
        const stale = store.get(key) as Entry<T> | undefined;
        if (stale && Date.now() - stale.at < maxStaleMs) {
          const { safeServerLog } = await import("./security.server");
          safeServerLog("warn", "Public cache refresh failed; serving stale value", {
            key,
            ageMs: Date.now() - stale.at,
            error: error instanceof Error ? error.message : "unknown",
          });
          return stale.value;
        }
        throw error;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}

/** Test-only: drop every cached entry so cases cannot leak into each other. */
export function __resetPublicCacheForTests(): void {
  store.clear();
  inflight.clear();
}
