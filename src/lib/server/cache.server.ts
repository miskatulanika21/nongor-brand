/**
 * Cache and response header security.
 *
 * Ensures authenticated or cookie-refreshing responses are never publicly cached.
 * Apply to every response carrying Set-Cookie or authenticated data.
 */

/**
 * Set no-cache headers on a Headers object for authenticated responses.
 * Merges Vary values safely rather than overwriting.
 */
export function addNoCacheHeaders(headers: Headers): void {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");

  // Merge Vary: Cookie without overwriting existing Vary values
  const existing = headers.get("Vary");
  if (existing) {
    const parts = existing.split(",").map((s) => s.trim().toLowerCase());
    if (!parts.includes("cookie")) {
      headers.set("Vary", `${existing}, Cookie`);
    }
  } else {
    headers.set("Vary", "Cookie");
  }
}

/**
 * Apply no-cache headers to a Response object (returns a new Response
 * with the same body and updated headers).
 */
export function withNoCacheHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  addNoCacheHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
