import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { absUrl } from "@/lib/site-config";

// Robots is served dynamically so the Sitemap directive always points at the
// configured production URL (VITE_SITE_URL or the nongorr.com default).
// Disallow rules cover all non-public surfaces; route-level noindex meta
// provides defense-in-depth.
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => {
        const body = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /admin",
          "Disallow: /admin/",
          "Disallow: /account",
          "Disallow: /account/",
          "Disallow: /cart",
          "Disallow: /checkout",
          "Disallow: /login",
          "Disallow: /orders",
          "Disallow: /orders/",
          "Disallow: /wishlist",
          "Disallow: /track",
          "Disallow: /order-success",
          "",
          `Sitemap: ${absUrl("/sitemap.xml")}`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
