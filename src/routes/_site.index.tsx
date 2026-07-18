import { createFileRoute, Link } from "@tanstack/react-router";
import { listProductCards } from "@/lib/catalog.api";
import { categoryPath } from "@/lib/categories";
import { DEFAULT_FOCAL, focalStyle } from "@/lib/image-focal";
import { getActiveBanners } from "@/lib/banners.api";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeading } from "@/components/SectionHeading";
import { HeroSection } from "@/components/site/HeroSection";
import { CategoryStrip } from "@/components/site/CategoryStrip";
import { TrustMarquee } from "@/components/site/TrustMarquee";
import { HowToOrder } from "@/components/site/HowToOrder";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/StarRating";
import { BRAND } from "@/lib/brand";
import { absUrl } from "@/lib/site-config";
import { Truck, ShieldCheck, Ruler, HandHeart, ArrowRight, Instagram, Quote } from "lucide-react";
import founderPortrait from "@/assets/founder-portrait.webp";
import founderLifestyle from "@/assets/founder-lifestyle.webp";

export const Route = createFileRoute("/_site/")({
  head: () => ({
    meta: [
      { title: "Nongorr — Premium Bangladeshi Women's Boutique" },
      {
        name: "description",
        content:
          "Handcrafted kurti, custom-size tailoring, saree, girls dress and beauty essentials — premium boutique fashion from Bangladesh.",
      },
      { property: "og:title", content: "Nongorr — Premium Bangladeshi Women's Boutique" },
      {
        property: "og:description",
        content:
          "Handcrafted kurti, custom-size tailoring, saree, girls dress and beauty essentials — premium boutique fashion from Bangladesh.",
      },
      { property: "og:url", content: absUrl("/") },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Nongorr — Premium Bangladeshi Women's Boutique" },
      {
        name: "twitter:description",
        content:
          "Handcrafted kurti, custom-size tailoring & beauty essentials, handmade in Bangladesh.",
      },
    ],
    links: [{ rel: "canonical", href: absUrl("/") }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: BRAND.name,
          description:
            "Premium Bangladeshi women's online boutique for handmade kurti, custom-size tailoring, saree, three piece, girls dress and beauty essentials.",
          slogan: BRAND.tagline,
          email: BRAND.email,
          telephone: BRAND.phone,
          url: absUrl("/"),
          sameAs: [BRAND.instagram, BRAND.facebook].filter(Boolean),
          areaServed: {
            "@type": "Country",
            name: "Bangladesh",
          },
        }),
      },
    ],
  }),
  loader: async () => {
    const [products, banners] = await Promise.all([listProductCards(), getActiveBanners()]);
    return { products, banners };
  },
  component: Home,
});

const reviews = [
  {
    name: "Sharmin R.",
    text: "My custom-size kurti fit like it was made just for me. Absolutely premium quality.",
    rating: 5,
  },
  {
    name: "Farzana H.",
    text: "The jamdani saree took my breath away. Nongorr's handwork is unmatched.",
    rating: 5,
  },
  {
    name: "Ayesha M.",
    text: "Fast delivery, beautiful packaging and the serum is now my daily must-have.",
    rating: 5,
  },
];

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ViewAll({
  to,
  search,
  label = "View all",
}: {
  to: string;
  search?: Record<string, string>;
  label?: string;
}) {
  return (
    <Button variant="ghost" asChild>
      <Link to={to as never} search={search as never}>
        {label} <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function Home() {
  const { products, banners } = Route.useLoaderData();
  const newArrivals = products.filter((p) => p.isNew).slice(0, 4);
  const bestSellers = products.filter((p) => p.isBestSeller).slice(0, 4);
  const customFitFavourites = products
    .filter((product) => product.type === "kurti" && product.isHandmade)
    .slice(0, 4);
  const beauty = products
    .filter((p) => ["cosmetics", "makeup", "serum"].includes(p.type))
    .slice(0, 4);

  // Curated social showcase (not a live Instagram feed).
  const social = products.slice(0, 6);

  return (
    <div>
      <HeroSection banner={banners[0] ?? null} />

      <TrustMarquee />

      <CategoryStrip />

      <div className="mx-auto max-w-7xl space-y-20 px-4 py-20 sm:px-6">
        {/* How to order */}
        <HowToOrder />

        {/* New arrivals */}
        <section>
          <SectionHeading
            align="left"
            eyebrow="Just In"
            title="New Arrivals"
            description="The latest additions to the Nongorr atelier."
            action={<ViewAll to="/shop" search={{ filter: "new-arrivals" }} />}
          />
          <ProductGrid products={newArrivals} />
        </section>

        {/* Best sellers */}
        <section>
          <SectionHeading
            align="left"
            eyebrow="Loved by You"
            title="Best Sellers"
            description="The pieces our customers reach for again and again."
            action={<ViewAll to="/shop" search={{ filter: "best-sellers" }} />}
          />
          <ProductGrid products={bestSellers} />
        </section>

        {/* Custom size highlight */}
        <section className="overflow-hidden rounded-3xl bg-gradient-hero">
          <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-2">
            <div className="space-y-4 text-primary-foreground">
              <span className="eyebrow">Made to Measure</span>
              <h2 className="font-display text-4xl">
                Custom-size kurti, tailored to your exact fit.
              </h2>
              <p className="max-w-md text-sm text-primary-foreground/80">
                Share six simple measurements — bust, waist, hip, shoulder, sleeve and length — and
                our tailors craft a kurti that fits you perfectly.
              </p>
              <Button size="lg" variant="secondary" asChild>
                <Link to="/size-guide">Learn how to measure</Link>
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {["Bust", "Waist", "Hip", "Shoulder", "Sleeve", "Length"].map((m, i) => (
                <div
                  key={m}
                  className="rounded-xl bg-background/10 p-4 text-center text-primary-foreground backdrop-blur"
                >
                  <span className="block font-display text-2xl text-gold">{i + 1}</span>
                  <span className="text-xs uppercase tracking-wider">{m}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Custom-Fit Favourites — handmade kurti only (up to 4, no fillers) */}
        {customFitFavourites.length > 0 && (
          <section>
            <SectionHeading
              align="left"
              eyebrow="Made to Measure"
              title="Custom-Fit Favourites"
              description="Handmade kurti, ready to be tailored to your exact measurements."
              action={<ViewAll to={categoryPath("kurti")} />}
            />
            <ProductGrid products={customFitFavourites} />
            <div className="mt-8 flex justify-center">
              <Button variant="outline" asChild>
                <Link to="/size-guide">
                  <Ruler className="h-4 w-4" /> See the custom-fit guide
                </Link>
              </Button>
            </div>
          </section>
        )}

        {/* Beauty teaser */}
        <section className="rounded-3xl border border-gold/30 bg-secondary/50 p-8 sm:p-12">
          <SectionHeading
            align="left"
            eyebrow="Coming to Bloom"
            title="Beauty & Self-Care"
            description="Lipsticks, serums and skincare — curated for radiant, confident you."
            action={<ViewAll to={categoryPath("cosmetics")} label="Explore beauty" />}
          />
          <ProductGrid products={beauty} />
        </section>

        {/* Brand story — curated founder/lifestyle assets */}
        <section className="grid items-center gap-8 lg:grid-cols-2">
          <div className="space-y-4">
            <span className="eyebrow">Our Story</span>
            <h2 className="font-display text-4xl text-foreground">
              Anchored in heritage, styled for today.
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Nongorr began as a small founder-led boutique with a love for Bangladeshi craft,
              custom-fit clothing, and thoughtful women's fashion. From handloom kurti to
              custom-size tailoring, every piece carries the warmth of Bangladeshi craft and the
              polish of modern design.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We're a small, family-run boutique — which means real care in every stitch and every
              parcel.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" asChild>
                <Link to="/about">
                  Read our full story <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/founder">
                  Meet the founder <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <img
              src={founderPortrait}
              alt="Nongorr founder — the woman behind the boutique"
              loading="lazy"
              className="aspect-[3/4] w-full rounded-2xl border border-gold/30 object-cover shadow-soft"
            />
            <img
              src={founderLifestyle}
              alt="Nongorr founder at work — handcrafting and styling each piece"
              loading="lazy"
              className="mt-8 aspect-[3/4] w-full rounded-2xl border border-gold/30 object-cover shadow-soft"
            />
          </div>
        </section>

        {/* Reviews */}
        <section>
          <SectionHeading eyebrow="Kind Words" title="What our customers say" />
          <div className="no-scrollbar -mx-4 flex snap-x gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {reviews.map((r) => (
              <figure
                key={r.name}
                className="relative w-[85%] shrink-0 snap-start rounded-2xl border border-border bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-card sm:w-auto"
              >
                <Quote className="h-7 w-7 text-gold/50" aria-hidden />
                <StarRating rating={r.rating} />
                <blockquote className="mt-3 text-sm leading-relaxed text-foreground">
                  “{r.text}”
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/15 font-display text-sm font-semibold text-primary">
                    {initials(r.name)}
                  </span>
                  <span className="font-display text-lg text-primary">{r.name}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Curated social showcase (not a live feed) */}
        <section className="text-center">
          <SectionHeading
            eyebrow="Follow Along"
            title="@nongorr on Instagram"
            description="A curated look at our boutique. Follow us for new drops and styling inspiration."
          />
          <div className="flex flex-wrap items-start justify-center gap-5">
            {social.map((p, i) => (
              <a
                key={p.id}
                href={BRAND.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View Nongorr on Instagram"
                className={`group block w-40 rounded-sm border border-border bg-card p-2 pb-8 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-card ${
                  i % 2 === 0 ? "-rotate-2" : "rotate-2"
                } hover:rotate-0`}
              >
                <div className="relative aspect-square overflow-hidden rounded-sm">
                  <img
                    src={p.image}
                    alt={`${p.name} styled by Nongorr`}
                    loading="lazy"
                    style={focalStyle(p.imageFocal ?? DEFAULT_FOCAL)}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-card/80 text-primary opacity-0 backdrop-blur transition group-hover:opacity-100">
                    <Instagram className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 truncate text-center font-display text-base text-foreground">
                  {p.name}
                </p>
              </a>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <Button variant="outline" asChild>
              <a href={BRAND.instagram} target="_blank" rel="noopener noreferrer">
                <Instagram className="h-4 w-4" /> Follow @nongorr
              </a>
            </Button>
          </div>
        </section>
      </div>

      {/* Trust strip */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            { icon: Truck, title: "Nationwide Delivery", desc: "Fast courier across Bangladesh" },
            {
              icon: ShieldCheck,
              title: "Secure bKash Payment",
              desc: "Manual bKash, verified by us",
            },
            {
              icon: Ruler,
              title: "Custom Size Tailoring",
              desc: "Kurti made to your measurements",
            },
            { icon: HandHeart, title: "Handmade with Care", desc: "Crafted by local artisans" },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold/15 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-lg text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
