/**
 * Vercel Routing Middleware (wired via `proxy` in vercel.json).
 *
 * Runs BEFORE the CDN cache, only on the edge-cacheable public pages (the
 * matcher in vercel.json mirrors PUBLIC_CACHEABLE_PREFIXES in
 * headers.server.ts). URLs without ad/analytics click IDs pass straight
 * through. URLs WITH them are served by fetching the clean URL back through
 * the CDN and returning that response:
 *
 *   - Vercel keys the cache on the ORIGINAL request URL — a rewrite does not
 *     change the key (verified on a preview: two distinct ?fbclid= values
 *     both MISSed after the clean page was cached). A self-fetch of the clean
 *     URL is a normal cache lookup, so every ad click shares one cached page.
 *   - The address bar keeps the original URL, so client-side analytics still
 *     read their parameters (a redirect would drop them).
 *   - The clean URL has no tracking params, so the self-fetch passes straight
 *     through this middleware — no recursion.
 *
 * Visitor credentials never ride along into the shared request (Vercel's own
 * guidance for self-fetching cacheable HTML): only Vercel's platform cookies
 * are kept, so protected previews and skew protection keep working. A
 * signed-in shopper landing from an ad gets the anonymous cached page and is
 * personalised on the client, exactly as on any other cached page.
 *
 * Kept dependency-light and relative-imported: Vercel compiles this file on its
 * own, outside Vite, so the `@/` alias is not available here. It is emitted as
 * Node ESM, which requires the explicit `.js` extension on relative imports
 * (TypeScript resolves `./x.js` to `./x.ts`); without it the middleware fails
 * with ERR_MODULE_NOT_FOUND and every matched page 500s.
 */
import { next } from "@vercel/functions";
import { stripTrackingParams } from "./lib/tracking-params.js";

/** Platform cookies only: deployment-protection session + skew protection. */
const PLATFORM_COOKIES = new Set(["_vercel_jwt", "__vdpl"]);

/** Headers describing the ENCODED upstream body; fetch() has already decoded it. */
const BODY_ENCODING_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];

export function forwardableHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  headers.delete("authorization");
  headers.delete("host");
  const cookie = incoming.get("cookie");
  headers.delete("cookie");
  if (cookie) {
    const kept = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => PLATFORM_COOKIES.has(part.split("=")[0] ?? ""));
    if (kept.length > 0) headers.set("cookie", kept.join("; "));
  }
  return headers;
}

export default async function proxy(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const clean = stripTrackingParams(new URL(request.url));
  if (!clean) return next();

  try {
    const upstream = await fetch(clean, {
      method: request.method,
      headers: forwardableHeaders(request.headers),
      redirect: "manual",
    });
    const headers = new Headers(upstream.headers);
    for (const h of BODY_ENCODING_HEADERS) headers.delete(h);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    // Self-fetch failed: fall back to a normal (uncached) render of the
    // original URL rather than failing the ad click.
    return next();
  }
}
