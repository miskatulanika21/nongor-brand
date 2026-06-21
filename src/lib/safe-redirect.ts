/**
 * Canonical internal-redirect safety check.
 *
 * Single source of truth for "is this string safe to use as a same-origin
 * redirect target". Used by both client-safe route files (auth.callback,
 * auth.confirm) and server-only role-aware destination resolution
 * (login-destination.server.ts).
 *
 * No server-only imports — safe for browser bundles.
 */

/** Destinations that would cause an immediate redirect loop. */
const LOOP_DESTINATIONS = new Set(["/login", "/admin/login"]);

/**
 * Returns true if `path` is a safe, same-origin, non-looping internal path.
 *
 * Rejects:
 *   - Empty/non-string values
 *   - Absolute URLs (https://..., http://...)
 *   - Protocol-relative URLs (//evil.com)
 *   - Backslash-based bypasses (\evil.com, /\evil.com)
 *   - Encoded and double-encoded protocol-relative bypasses (%2F%2F..., %5C%5C...)
 *   - javascript:, data:, and other non-http(s) schemes
 *   - Newline/control-character injection
 *   - Loop-causing destinations (/login, /admin/login)
 *
 * Only allows internal paths starting with exactly one `/`.
 */
export function isSafeRedirect(path: string | null | undefined): path is string {
  if (!path || typeof path !== "string") return false;
  if (path.length > 2048) return false;

  // Reject control characters / newlines before any decoding (header/URL injection).
  // eslint-disable-next-line no-control-regex -- detecting control chars is the intent
  if (/[\x00-\x1f\x7f]/.test(path)) return false;

  // Decode repeatedly (bounded) to catch double/triple-encoded bypasses like
  // %2F%2Fevil.com or %252F%252Fevil.com. Stop once decoding stabilizes.
  let decoded = path;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false;
    }
    if (next === decoded) break;
    decoded = next;
  }

  // eslint-disable-next-line no-control-regex -- detecting control chars is the intent
  if (/[\x00-\x1f\x7f]/.test(decoded)) return false;

  // Must start with exactly one "/". Reject "//", "/\", and bare "\".
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return false;
  if (decoded.includes("\\")) return false;

  // Reject dangerous schemes that could appear after normalization tricks.
  const lower = decoded.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return false;
  }

  // Confirm it parses as a same-origin relative reference — catches any
  // remaining authority-changing tricks the checks above didn't anticipate.
  try {
    const url = new URL(decoded, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return false;
  } catch {
    return false;
  }

  // Block known loop-causing destinations (query string ignored).
  const pathOnly = decoded.split("?")[0].replace(/\/+$/, "") || "/";
  if (LOOP_DESTINATIONS.has(pathOnly)) return false;

  return true;
}

/** Strip the query string and any trailing slash for canonical comparisons. */
export function pathOnly(destination: string): string {
  return destination.split("?")[0].replace(/\/+$/, "") || "/";
}
