import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import founderPortrait from "@/assets/founder-portrait.webp";
import founderLifestyle from "@/assets/founder-lifestyle.webp";
import logo from "@/assets/nongorr-logo-transparent.webp";
import sizeChart from "@/assets/size-chart.webp";
import { absUrl } from "@/lib/site-config";
import {
  Quote,
  Ruler,
  Sparkles,
  HandHeart,
  ShieldCheck,
  Flower2,
  Gem,
  Heart,
  Hammer,
  Handshake,
  Sprout,
  MessageCircle,
} from "lucide-react";

export const Route = createFileRoute("/_site/about")({
  head: () => ({
    meta: [
      { title: "About Nongorr · Rooted in Craft, Made for Her" },
      {
        name: "description",
        content:
          "Nongorr is a premium Bangladeshi women's boutique by Miskatul Afrin Anika — craftsmanship, custom-fit clothing and feminine elegance.",
      },
      { property: "og:title", content: "About Nongorr · Rooted in Craft, Made for Her" },
      {
        property: "og:description",
        content:
          "Meet founder Miskatul Afrin Anika and the story behind Nongorr — a premium women's boutique rooted in Bangladeshi craft.",
      },
      { property: "og:url", content: absUrl("/about") },
      { property: "og:type", content: "website" },
      { property: "og:image", content: absUrl(founderPortrait) },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: absUrl(founderPortrait) },
    ],
    links: [{ rel: "canonical", href: absUrl("/about") }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: "About Nongorr",
          url: absUrl("/about"),
          about: {
            "@type": "Organization",
            name: "Nongorr",
            description:
              "Premium Bangladeshi women's boutique offering custom-fit kurti, saree, three piece and more.",
            founder: { "@type": "Person", name: "Miskatul Afrin Anika" },
          },
        }),
      },
    ],
  }),
  component: About,
});

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hello Nongorr! I'd love to know more about your collection.",
)}`;

const ABOUT_SECTIONS = [
  { id: "founder", label: "Founder" },
  { id: "story", label: "Story" },
  { id: "craft", label: "Craft" },
  { id: "values", label: "Values" },
  { id: "promise", label: "Promise" },
];

function AboutNav() {
  const [active, setActive] = useState(ABOUT_SECTIONS[0].id);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    ABOUT_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="About page sections"
      className="site-sticky-under-header sticky z-20 border-b border-border bg-background/85 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ABOUT_SECTIONS.map((s) => {
          const isActive = active === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all",
                isActive
                  ? "border-primary bg-primary text-primary-foreground underline underline-offset-4 shadow-soft"
                  : "border-border bg-card text-muted-foreground hover:border-gold/40 hover:text-foreground",
              )}
            >
              {s.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function About() {
  return (
    <div className="overflow-x-clip">
      {/* 1 — HERO */}
      <section className="relative isolate border-b border-border bg-secondary/30">
        {/* watercolor + logo watermark */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.6]"
          style={{
            background:
              "radial-gradient(60% 50% at 18% 12%, color-mix(in oklab, var(--color-gold) 18%, transparent) 0%, transparent 60%), radial-gradient(55% 45% at 85% 90%, color-mix(in oklab, var(--color-primary) 12%, transparent) 0%, transparent 60%)",
          }}
        />
        <img
          aria-hidden
          src={logo}
          alt=""
          className="pointer-events-none absolute -right-10 top-1/2 -z-10 hidden w-[34rem] max-w-none -translate-y-1/2 opacity-[0.05] md:block"
        />
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28 animate-fade-in">
          <img
            src={logo}
            alt="Nongorr"
            width={72}
            height={72}
            className="mx-auto h-16 w-16 object-contain"
          />
          <span className="eyebrow mt-6 block">Our Story</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-6xl text-balance">
            Rooted in Craft, Made for Her
          </h1>
          <div className="ornament-divider mx-auto mt-5 w-48" />
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Nongorr is a premium women's boutique founded by{" "}
            <span className="text-foreground">Miskatul Afrin Anika</span>, created to celebrate
            Bangladeshi craftsmanship, custom-fit clothing, and timeless feminine elegance.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link to="/shop">Shop Collection</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/custom-size-policy">Explore Custom Size</Link>
            </Button>
          </div>
        </div>
      </section>

      <AboutNav />

      {/* 2 — MEET THE FOUNDER */}
      <section id="founder" className="mx-auto max-w-6xl scroll-mt-36 px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* photo card */}
          <div className="relative mx-auto w-full max-w-md animate-fade-in">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/10 via-gold/15 to-transparent"
            />
            <div className="overflow-hidden rounded-3xl border border-gold/40 bg-card p-2 shadow-card">
              <img
                src={founderPortrait}
                alt="Miskatul Afrin Anika, founder of Nongorr, in a maroon and gold saree"
                width={1024}
                height={1280}
                loading="lazy"
                className="aspect-[4/5] w-full rounded-[1.4rem] object-cover object-top"
              />
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold/40 bg-card px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] text-primary shadow-soft">
              Founder &amp; Creative Lead
            </div>
          </div>

          {/* copy */}
          <div className="space-y-5">
            <span className="eyebrow">Meet the Founder</span>
            <h2 className="font-display text-4xl text-foreground sm:text-5xl">
              Miskatul Afrin Anika
            </h2>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-gold">
              Founder &amp; Creative Lead of Nongorr
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Miskatul Afrin Anika founded Nongorr with a simple dream: to create clothing that
              feels personal, graceful, and meaningful. With a love for Bangladeshi craft, soft
              feminine styling, and thoughtful details, she built Nongorr as a premium boutique for
              women who value elegance, comfort, and trust.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              From handcrafted kurtis to future collections of saree, three piece, girls dress,
              cosmetics, makeup, and serum, Nongorr is growing into a women-focused fashion and
              beauty destination.
            </p>
            {/* quote card */}
            <figure className="relative mt-6 rounded-3xl border border-gold/30 bg-secondary/40 p-7 shadow-soft">
              <Quote className="absolute -top-3 left-6 h-9 w-9 fill-gold text-gold" aria-hidden />
              <blockquote className="font-display text-2xl leading-snug text-primary">
                “Every piece should feel thoughtful — not just worn, but loved.”
              </blockquote>
              <figcaption className="mt-3 text-sm text-muted-foreground">
                — Miskatul Afrin Anika
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* 3 — OUR STORY */}
      <section id="story" className="scroll-mt-36 bg-secondary/30 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div className="space-y-5">
            <span className="eyebrow">Our Story</span>
            <h2 className="font-display text-4xl text-foreground sm:text-5xl text-balance">
              A Boutique Born from Bangladeshi Elegance
            </h2>
            <div className="ornament-divider w-40 justify-start" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Nongorr began with a love for handmade fashion and the beauty of traditional details.
              The anchor in our identity represents strength, belonging, and trust, while the
              flowing maroon fabric reflects the grace of Bangladeshi women's wear.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              From the first kurti to every future collection, our goal is simple: to make women
              feel confident, comfortable, and beautifully themselves.
            </p>
          </div>
          <div className="relative mx-auto grid w-full max-w-md place-items-center">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 rounded-[2.5rem] bg-gradient-to-br from-gold/15 via-primary/5 to-transparent"
            />
            <div className="grid aspect-square w-full place-items-center rounded-[2.5rem] border border-gold/30 bg-card p-12 shadow-card">
              <img
                src={logo}
                alt="The Nongorr anchor emblem"
                width={320}
                height={320}
                loading="lazy"
                className="w-full max-w-[18rem] object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 4 — BEHIND THE BRAND / LIFESTYLE */}
      <section id="craft" className="mx-auto max-w-6xl scroll-mt-36 px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="relative order-2 mx-auto w-full max-w-md lg:order-1">
            <div className="overflow-hidden rounded-[2rem] border border-gold/30 bg-card p-2 shadow-card">
              <img
                src={founderLifestyle}
                alt="Anika in a maroon outfit on a flower-decorated garden swing at golden hour"
                width={1024}
                height={1280}
                loading="lazy"
                className="aspect-[4/5] w-full rounded-[1.6rem] object-cover"
              />
            </div>
            <p className="mt-5 text-center font-display text-xl italic text-primary/80">
              “A personal love for colour, culture, and quiet elegance.”
            </p>
          </div>
          <div className="order-1 space-y-5 lg:order-2">
            <span className="eyebrow">Behind the Brand</span>
            <h2 className="font-display text-4xl text-foreground sm:text-5xl text-balance">
              Inspired by Colour, Craft &amp; Everyday Grace
            </h2>
            <div className="ornament-divider w-40 justify-start" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              For Anika, Nongorr is more than fashion — it is a feeling of comfort, culture, and
              confidence. Every colour, fabric, and detail is chosen with the hope that women feel
              beautiful, comfortable, and connected to their own style.
            </p>
          </div>
        </div>
      </section>

      {/* 5 — WHAT MAKES NONGORR DIFFERENT */}
      <section className="bg-secondary/30 py-20">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <span className="eyebrow">The Nongorr Difference</span>
          <h2 className="mt-3 font-display text-4xl text-foreground sm:text-5xl">
            What Makes Nongorr Different
          </h2>
          <div className="ornament-divider mx-auto mt-4 w-48" />
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                i: Ruler,
                t: "Custom-Fit Kurti",
                d: "Ready sizes and custom measurements for better comfort.",
              },
              {
                i: HandHeart,
                t: "Handmade Cultural Touch",
                d: "Inspired by Bangladeshi craft, embroidery, and timeless styling.",
              },
              {
                i: Sparkles,
                t: "Women-Focused Collections",
                d: "Kurti now, with saree, three piece, girls dress, cosmetics, makeup, and serum coming soon.",
              },
              {
                i: ShieldCheck,
                t: "Personal Care & Trust",
                d: "Manual bKash support, WhatsApp help, careful packaging, and customer-focused service.",
              },
            ].map((c) => (
              <div
                key={c.t}
                className="group rounded-3xl border border-border bg-card p-7 text-left shadow-soft transition-all hover:-translate-y-1 hover:border-gold/50 hover:shadow-card"
              >
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-primary transition-colors group-hover:bg-gold/25">
                  <c.i className="h-6 w-6" />
                </div>
                <h3 className="mt-5 font-display text-2xl text-foreground">{c.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6 — CRAFT & MEASUREMENT */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="rounded-3xl border border-gold/30 bg-card p-4 shadow-card sm:p-6">
            <img
              src={sizeChart}
              alt="Nongorr kurti measurement guide showing bust, waist, hip, shoulder, sleeve and length"
              width={1122}
              height={1402}
              loading="lazy"
              className="mx-auto w-full max-w-sm rounded-2xl object-contain"
            />
          </div>
          <div className="space-y-5">
            <span className="eyebrow">Craft &amp; Measurement</span>
            <h2 className="font-display text-4xl text-foreground sm:text-5xl text-balance">
              Designed with Fit, Detail &amp; Care
            </h2>
            <div className="ornament-divider w-40 justify-start" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              At Nongorr, fit matters. Our custom-size option helps customers order kurtis that feel
              more personal and comfortable. Every detail — from fabric choice to measurement
              guidance — is designed to make online shopping easier and more trustworthy.
            </p>
            <ul className="grid grid-cols-2 gap-3 pt-2">
              {["Bust", "Waist", "Hip", "Shoulder", "Sleeve", "Kurti Length"].map((m, i) => (
                <li
                  key={m}
                  className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[0.7rem] font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  {m}
                </li>
              ))}
            </ul>
            <Button variant="outline" asChild className="mt-2">
              <Link to="/size-guide">View Size Guide</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 7 — BRAND VALUES */}
      <section id="values" className="scroll-mt-36 bg-secondary/30 py-20">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <span className="eyebrow">What We Stand For</span>
          <h2 className="mt-3 font-display text-4xl text-foreground sm:text-5xl">
            Our Brand Values
          </h2>
          <div className="ornament-divider mx-auto mt-4 w-48" />
          <div className="mt-12 grid gap-5 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { i: Gem, t: "Elegance", d: "Timeless, refined femininity." },
              { i: Heart, t: "Comfort", d: "Pieces made to feel as good as they look." },
              { i: Hammer, t: "Craftsmanship", d: "Honouring Bangladeshi handwork." },
              { i: Handshake, t: "Trust", d: "Honest service, every order." },
              { i: Sprout, t: "Growth", d: "Always evolving for her." },
            ].map((v) => (
              <div
                key={v.t}
                className="rounded-3xl border border-border bg-card p-6 shadow-soft transition-transform hover:-translate-y-1"
              >
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold/15 text-primary">
                  <v.i className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-xl text-foreground">{v.t}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8 — FUTURE VISION */}
      <section
        id="promise"
        className="mx-auto max-w-4xl scroll-mt-36 px-4 py-20 text-center sm:px-6"
      >
        <span className="eyebrow">Our Vision</span>
        <h2 className="mt-3 font-display text-4xl text-foreground sm:text-5xl text-balance">
          More Than Clothing — A Women's Lifestyle Brand
        </h2>
        <div className="ornament-divider mx-auto mt-4 w-48" />
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Nongorr is starting with kurti, but our vision is bigger. We are slowly building a
          women-focused shopping experience where customers can discover saree, three piece, girls
          dress, cosmetics, makeup, serum, and everyday beauty essentials — all in one premium,
          trusted space.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {["Kurti", "Saree", "Three Piece", "Girls Dress", "Cosmetics", "Makeup", "Serum"].map(
            (p, i) => (
              <span
                key={p}
                className={`rounded-full border px-5 py-2 text-sm font-medium ${
                  i === 0
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-gold/40 bg-card text-foreground"
                }`}
              >
                {p}
                {i !== 0 && (
                  <span className="ml-2 text-[0.65rem] uppercase tracking-wide text-gold">
                    soon
                  </span>
                )}
              </span>
            ),
          )}
        </div>
      </section>

      {/* 9 — FINAL CTA */}
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
          <Flower2 className="mx-auto h-10 w-10 text-gold" aria-hidden />
          <h2 className="mt-4 font-display text-4xl text-primary-foreground sm:text-5xl">
            Discover Pieces Made with Care
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/80">
            Explore our latest kurtis or reach out — we'd love to help you find your fit.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" variant="secondary" asChild>
              <Link to="/shop">Shop New Arrivals</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-gold/60 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              asChild
            >
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Chat on WhatsApp
              </a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
