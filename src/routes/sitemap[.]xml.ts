import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { PRODUCTS } from "@/lib/products";
import { absUrl } from "@/lib/site-config";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const paths = [
          "/",
          "/shop",
          "/about",
          "/contact",
          "/faq",
          "/eid-style-guide",
          "/size-guide",
          "/custom-size-policy",
          "/delivery-policy",
          "/return-policy",
          "/privacy-policy",
          "/terms",
          "/authenticity-policy",
          "/payment-policy",
          "/cookie-policy",
          ...PRODUCTS.map((p) => `/product/${p.slug}`),
        ];
        // Private / utility routes (cart, checkout, login, account, admin,
        // orders, track, order-success, wishlist) are intentionally excluded
        // and also carry route-level noindex,nofollow meta.
        const urls = paths
          .map((p) => `  <url><loc>${absUrl(p)}</loc><changefreq>weekly</changefreq></url>`)
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
