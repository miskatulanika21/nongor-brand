import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import founderPortrait from "@/assets/founder-portrait.webp";
import logo from "@/assets/nongorr-logo-transparent.webp";
import sizeChart from "@/assets/size-chart.webp";
import { absUrl } from "@/lib/site-config";
import type { PublicSettings } from "@/lib/settings.schema";
import {
  ArrowRight,
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
            alternateName: "নোঙর",
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
  // The owner can set a brand mark in admin Settings; it overrides the bundled
  // asset here. The _site layout has already fetched public settings for this
  // navigation, so reading them costs no extra request, and an unset logo
  // falls back to the build-time import — no network, no broken image.
  const { publicSettings } = useRouteContext({ from: "/_site" }) as {
    publicSettings: PublicSettings | null;
  };
  const logoSrc = publicSettings?.logo_url || logo;

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
          src={logoSrc}
          alt=""
          className="pointer-events-none absolute -right-10 top-1/2 -z-10 hidden w-[34rem] max-w-none -translate-y-1/2 opacity-[0.05] md:block"
        />
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28 animate-fade-in">
          <img
            src={logoSrc}
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
            <Link
              to="/founder"
              className="text-foreground underline decoration-gold/60 underline-offset-4 transition-colors hover:text-primary"
            >
              Miskatul Afrin Anika
            </Link>
            , created to celebrate Bangladeshi craftsmanship, custom-fit clothing, and timeless
            feminine elegance.
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
              <Link
                to="/founder"
                className="underline decoration-gold/50 underline-offset-8 transition-colors hover:text-primary"
              >
                Miskatul Afrin Anika
              </Link>
            </h2>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-gold">
              Founder &amp; Creative Lead of Nongorr
            </p>
            {/* Teaser only — her full story, letter, journey and quote live on
                /founder so the two pages never repeat each other. */}
            <p className="text-sm leading-relaxed text-muted-foreground">
              Anika started Nongorr for the nakshi kantha — the layered, hand-stitched quilts
              Bengali women spent months making, and that fewer families pass down each year. She
              runs the boutique from Sreenagar in Munshiganj while completing a Computer Science and
              Engineering degree at BRAC University.
            </p>
            <Button asChild className="mt-2">
              <Link to="/founder">
                Read her full story <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
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
              Nongorr began with the nakshi kantha. For generations, women across Bengal layered
              worn sarees and joined them with a running stitch, drawing the thread from the sarees'
              own borders, until a quilt held an entire life in it. That patience is going out of
              use. This boutique is one attempt to keep it working.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The name comes from <span lang="bn">নোঙর</span> — Bengali for anchor. It stands for
              steadiness and belonging; the flowing maroon fabric for the grace of Bangladeshi
              women's wear. From the first kurti onward the goal has stayed simple — clothing made
              with real care, for women who intend to keep it.
            </p>
          </div>
          <div className="relative mx-auto grid w-full max-w-md place-items-center">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 rounded-[2.5rem] bg-gradient-to-br from-gold/15 via-primary/5 to-transparent"
            />
            <div className="grid aspect-square w-full place-items-center rounded-[2.5rem] border border-gold/30 bg-card p-12 shadow-card">
              <img
                src={logoSrc}
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

      {/* The former "Behind the Brand" lifestyle block moved to /founder — it
          repeated that page's photo, caption and copy verbatim. The `craft`
          anchor now points at the genuine craft & measurement section below. */}

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
      <section id="craft" className="mx-auto max-w-6xl scroll-mt-36 px-4 py-20 sm:px-6">
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
      {/* -mb-20 cancels the footer's site-wide mt-20 (see /founder). */}
      <section className="-mb-20 bg-gradient-hero">
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
