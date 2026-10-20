/**
 * Ad/analytics click identifiers that never change what the page renders.
 *
 * Vercel's CDN keys dynamic responses on the FULL URL, query string included,
 * so every Facebook/Google ad click (`?fbclid=<unique>`) is a guaranteed cache
 * MISS: a fresh SSR render + database round-trips, at exactly the moment an ad
 * drop sends the most traffic. Stripping these before the cache lookup lets ad
 * clicks share the same cached page as everyone else.
 *
 * The browser's address bar keeps the original URL (the edge REWRITES, it does
 * not redirect), so client-side analytics still read their parameters.
 *
 * Only add keys here that no server code reads; anything that changes the
 * render (e.g. `q`, `category`, `filter`) must never be listed.
 */
const EXACT_KEYS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
]);

export function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return EXACT_KEYS.has(k) || k.startsWith("utm_");
}

/**
 * The URL with tracking parameters removed, or `null` when there were none
 * (so the caller can skip work on the common path).
 */
export function stripTrackingParams(url: URL): URL | null {
  let found = false;
  for (const key of url.searchParams.keys()) {
    if (isTrackingParam(key)) {
      found = true;
      break;
    }
  }
  if (!found) return null;

  const clean = new URL(url.toString());
  for (const key of [...clean.searchParams.keys()]) {
    if (isTrackingParam(key)) clean.searchParams.delete(key);
  }
  return clean;
}
