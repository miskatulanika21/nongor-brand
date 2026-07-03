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
 */
type Entry<T> = { at: number; value: T };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function cachedPublic<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
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
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}
