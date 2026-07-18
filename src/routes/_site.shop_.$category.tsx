import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { listProductCards } from "@/lib/catalog.api";
import {
  CATEGORY_SEO,
  categoryPath,
  isCategorySlug,
  matchesCategory,
  type CategorySlug,
} from "@/lib/categories";
import { ProductGrid } from "@/components/ProductGrid";
import { NotFoundPage } from "@/components/NotFoundPage";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { absUrl } from "@/lib/site-config";

// ============================================================================
// Category landing pages — /shop/kurti, /shop/saree, ...
//
// The trailing underscore in the filename ("shop_") opts this route OUT of
// nesting under /shop, so /shop keeps rendering as a plain leaf route rather
// than becoming a layout with an outlet.
//
// This page is deliberately NOT the filter UI. It is a stable, crawlable page
// per category with unique copy and its own schema; /shop?category=… remains
// the interactive filtered view and canonicalises here.
// ============================================================================

export const Route = createFileRoute("/_site/shop_/$category")({
  loader: async ({ params }) => {
    if (!isCategorySlug(params.category)) throw notFound();
    const all = await listProductCards();
    const slug = params.category;
    return { slug, products: all.filter((p) => matchesCategory(p, slug)) };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const seo = CATEGORY_SEO[loaderData.slug];
    const url = absUrl(categoryPath(loaderData.slug));
    return {
      meta: [
        { title: seo.title },
        { name: "description", content: seo.description },
        { property: "og:title", content: seo.title },
        { property: "og:description", content: seo.description },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: seo.heading,
            url,
            description: seo.description,
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: loaderData.products.length,
              itemListElement: loaderData.products.slice(0, 20).map((p, i) => ({
                "@type": "ListItem",
                position: i + 1,
                name: p.name,
                url: absUrl(`/product/${p.slug}`),
              })),
            },
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: absUrl("/") },
              { "@type": "ListItem", position: 2, name: "Shop", item: absUrl("/shop") },
              { "@type": "ListItem", position: 3, name: seo.heading, item: url },
            ],
          }),
        },
      ],
    };
  },
  notFoundComponent: NotFoundPage,
  component: CategoryPage,
});

function CategoryPage() {
  const { slug, products } = Route.useLoaderData();
  const seo = CATEGORY_SEO[slug as CategorySlug];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/">Home</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/shop">Shop</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{seo.heading}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="mb-8 max-w-2xl">
        <h1 className="font-display text-3xl text-foreground sm:text-4xl">{seo.heading}</h1>
        <p className="mt-3 text-muted-foreground">{seo.intro}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? "piece" : "pieces"} available
        </p>
      </header>

      {products.length > 0 ? (
        <ProductGrid products={products} />
      ) : (
        <p className="py-12 text-center text-muted-foreground">
          Nothing in this collection right now — new pieces land regularly.
        </p>
      )}

      <div className="mt-10 flex justify-center">
        <Button variant="outline" asChild>
          <Link to="/shop" search={{ category: slug } as never}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Refine with filters
          </Link>
        </Button>
      </div>
    </div>
  );
}
