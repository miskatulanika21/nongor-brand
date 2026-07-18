import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { absUrl } from "@/lib/site-config";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Server-only repository: RLS returns active products only.
        const { fetchProductCards } = await import("@/lib/server/catalog.server");
        const { CATEGORY_FILTERS, categoryPath } = await import("@/lib/categories");
        const products = await fetchProductCards();
        const paths = [
          "/",
          "/shop",
          // Category landing pages. The /shop?category=… filter views are
          // deliberately absent — they canonicalise to these paths.
          ...CATEGORY_FILTERS.map((c) => categoryPath(c.slug)),
          "/about",
          "/founder",
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
          ...products.map((p) => `/product/${p.slug}`),
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
