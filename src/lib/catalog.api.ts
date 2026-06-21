/**
 * Catalog API — createServerFn handlers callable from route loaders / client.
 *
 * Lives OUTSIDE server/ so routes can import it; handler() bodies run only on
 * the server via RPC. The server-only repository is imported INSIDE the handler
 * closures so it never enters the client bundle (same pattern as auth.api.ts).
 *
 * Read split (bounded payloads):
 *   - listProductCards     → grids / filters / search / home (lean cards)
 *   - getProductDetail     → product detail page (full record)
 *   - getProductCardsByCodes → wishlist resolution by legacy code
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listProductCards = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchProductCards } = await import("@/lib/server/catalog.server");
  return fetchProductCards();
});

export const getProductDetail = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const { fetchProductDetail } = await import("@/lib/server/catalog.server");
    return fetchProductDetail(data.slug);
  });

export const getProductCardsByCodes = createServerFn({ method: "GET" })
  .validator(z.object({ codes: z.array(z.string().min(1).max(64)).max(500) }))
  .handler(async ({ data }) => {
    const { fetchProductCardsByCodes } = await import("@/lib/server/catalog.server");
    return fetchProductCardsByCodes(data.codes);
  });
