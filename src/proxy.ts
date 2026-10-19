/**
 * Vercel Routing Middleware (wired via `proxy` in vercel.json).
 *
 * Runs BEFORE the CDN cache, only on the edge-cacheable public pages (the
 * matcher in vercel.json mirrors PUBLIC_CACHEABLE_PREFIXES in
 * headers.server.ts). When a URL carries ad/analytics click IDs, rewrite it to
 * the clean URL so the cached page is reused instead of re-rendered.
 *
 * Kept dependency-light and relative-imported: Vercel bundles this file on its
 * own, outside Vite, so the `@/` alias is not available here.
 */
import { next, rewrite } from "@vercel/functions";
import { stripTrackingParams } from "./lib/tracking-params";

export default function proxy(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const clean = stripTrackingParams(new URL(request.url));
  return clean ? rewrite(clean) : next();
}
