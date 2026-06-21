import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero } from "@/components/PageHero";
import { listProductCards } from "@/lib/catalog.api";
import { ProductGrid } from "@/components/ProductGrid";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { ArrowRight } from "lucide-react";

const TITLE = "Eid 2026 Fashion Guide: Eid Clothes & Dresses for Women";
const DESC =
  "Your Eid 2026 lookbook — handcrafted kurtis, jamdani sarees and custom-fit dresses. Shop premium Eid clothes and dresses for women, made in Bangladesh by Nongorr.";
// Stable public OG image (head() runs outside React, so no catalog hook here).
const OG_IMAGE = "/assets/products/kurti.jpg";

export const Route = createFileRoute("/_site/eid-style-guide")({
  head: () => ({
    meta: [
      { title: `${TITLE} · Nongorr` },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: "/eid-style-guide" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: "/eid-style-guide" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESC,
          image: OG_IMAGE,
          author: { "@type": "Organization", name: BRAND.name },
          publisher: { "@type": "Organization", name: BRAND.name },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "/" },
            { "@type": "ListItem", position: 2, name: "Eid Style Guide", item: "/eid-style-guide" },
          ],
        }),
      },
    ],
  }),
  loader: () => listProductCards(),
  component: EidGuide,
});

const SECTIONS = [
  {
    h: "1. Handcrafted kurtis for everyday Eid elegance",
    p: "The kurti remains the heart of Eid dressing for women in Bangladesh. For Eid 2026, think breathable handloom cotton in jewel tones, delicate hand-embroidery at the neckline, and silhouettes cut for movement through long days of visiting family. A well-made kurti carries you from morning prayers to evening gatherings without a single change.",
  },
  {
    h: "2. Jamdani & silk sarees for the main celebration",
    p: "When the occasion calls for something unforgettable, a jamdani or soft-silk saree is the timeless choice. This season's palette leans into deep maroon, emerald and antique gold — colours that photograph beautifully and honour heritage. Pair with minimal gold jewellery to let the weave speak.",
  },
  {
    h: "3. Three piece sets for an effortless complete look",
    p: "If you want a coordinated outfit without the styling effort, a three piece set is the easiest win. Stitched or unstitched, these sets take the guesswork out of matching and are perfect for gifting during Eid.",
  },
  {
    h: "4. Custom-size tailoring: the Nongorr difference",
    p: "Eid clothes should fit you — not the other way around. Our custom-size service lets you enter your exact measurements so your kurti or dress is made to order in 5–10 days. It's the detail that turns a beautiful outfit into your outfit.",
  },
];

function EidGuide() {
  const products = Route.useLoaderData();
  const eidPicks = products
    .filter((p) => ["kurti", "saree", "three-piece"].includes(p.type))
    .slice(0, 8);

  return (
    <div>
      <PageHero
        eyebrow="Eid 2026 Lookbook"
        title="Eid Clothes & Dresses: The 2026 Style Guide"
        description="A premium edit of handcrafted Eid fashion for women — kurtis, sarees, three piece sets and custom-fit dresses."
      />

      <article className="mx-auto max-w-3xl space-y-10 px-4 py-12 sm:px-6">
        <p className="text-base leading-relaxed text-muted-foreground">
          Eid is a season of togetherness, tradition and quiet glamour. The right outfit balances
          comfort with celebration — pieces that feel personal, are made to last, and carry the
          warmth of Bangladeshi craft. This guide walks you through the Eid 2026 trends we love and
          the{" "}
          <Link to="/shop" className="text-primary underline-offset-4 hover:underline">
            handcrafted pieces
          </Link>{" "}
          ready to make them yours.
        </p>

        {SECTIONS.map((s) => (
          <section key={s.h} className="space-y-3">
            <h2 className="font-display text-2xl text-foreground">{s.h}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.p}</p>
          </section>
        ))}

        <section className="rounded-2xl border border-gold/30 bg-gold/5 p-6">
          <h2 className="font-display text-2xl text-foreground">Quick Eid styling checklist</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Choose breathable fabrics for daytime visiting and richer weaves for evening.</li>
            <li>Order custom-size pieces early — tailoring takes 5–10 days.</li>
            <li>Stick to a 2–3 colour palette across your Eid outfits for cohesive photos.</li>
            <li>
              Read our{" "}
              <Link to="/size-guide" className="text-primary underline-offset-4 hover:underline">
                size guide
              </Link>{" "}
              and{" "}
              <Link
                to="/delivery-policy"
                className="text-primary underline-offset-4 hover:underline"
              >
                delivery policy
              </Link>{" "}
              before ordering.
            </li>
          </ul>
        </section>
      </article>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="font-display text-3xl text-foreground">Shop the Eid edit</h2>
          <Button variant="ghost" asChild>
            <Link to="/shop">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <ProductGrid products={eidPicks} />
      </section>
    </div>
  );
}
