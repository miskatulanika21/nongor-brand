// ============================================================================
// Site URL config — single source of truth for absolute URLs used in SEO
// metadata, sitemap, robots.txt and OG tags. Reads VITE_SITE_URL when set,
// otherwise falls back to the production domain. Trailing slashes are
// normalised so absUrl() never produces "//path".
// ============================================================================

const RAW_SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://nongorr.com";

export const SITE_URL = RAW_SITE_URL.replace(/\/+$/, "");

/** Build an absolute URL from a path relative to the site root. */
export function absUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return new URL(p, SITE_URL + "/").toString();
}
