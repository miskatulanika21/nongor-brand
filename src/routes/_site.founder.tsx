/**
 * /founder — the dedicated founder page.
 *
 * Content is CMS-backed (owner-only, `founder.manage`): the loader reads the
 * published document and the sections below render it. When the read fails the
 * built-in FOUNDER_FALLBACK copy is used, so the page is never blank. The
 * LAYOUT is fixed in code — an owner edits words, images and list items, never
 * the design.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import founderPortrait from "@/assets/founder-portrait.webp";
import founderLifestyle from "@/assets/founder-lifestyle.webp";
import logo from "@/assets/nongorr-logo-transparent.webp";
import { absUrl } from "@/lib/site-config";
import { getFounderProfile } from "@/lib/founder.api";
import { FOUNDER_FALLBACK, type FounderContent, type FounderIconKey } from "@/lib/founder-shared";
import {
  Quote,
  Sparkles,
  HandHeart,
  ShieldCheck,
  Ruler,
  Flower2,
  MessageCircle,
  Instagram,
  Facebook,
  Mail,
  ArrowRight,
  Anchor,
  Scissors,
  PackageCheck,
  Compass,
  Gem,
  Heart,
  Hammer,
  Handshake,
  Sprout,
} from "lucide-react";

/** Closed icon registry — mirrors FOUNDER_ICON_KEYS. */
const ICONS: Record<FounderIconKey, React.ElementType> = {
  sparkles: Sparkles,
  anchor: Anchor,
  scissors: Scissors,
  ruler: Ruler,
  compass: Compass,
  handHeart: HandHeart,
  shield: ShieldCheck,
  gem: Gem,
  heart: Heart,
  hammer: Hammer,
  handshake: Handshake,
  sprout: Sprout,
  flower: Flower2,
  package: PackageCheck,
};

export const Route = createFileRoute("/_site/founder")({
  loader: () => getFounderProfile(),
  head: ({ loaderData }) => {
    const c = (loaderData as FounderContent | null) ?? FOUNDER_FALLBACK;
    const image = absUrl(c.hero.portraitUrl ?? founderPortrait);
    return {
      meta: [
        { title: c.seo.title },
        { name: "description", content: c.seo.description },
        { property: "og:title", content: c.seo.title },
        { property: "og:description", content: c.seo.description },
        { property: "og:url", content: absUrl("/founder") },
        { property: "og:type", content: "profile" },
        { property: "og:image", content: image },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: absUrl("/founder") }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            url: absUrl("/founder"),
            mainEntity: {
              "@type": "Person",
              name: c.name,
              jobTitle: c.role,
              image,
              nationality: "Bangladeshi",
              worksFor: { "@type": "Organization", name: BRAND.name, url: absUrl("/") },
              // Her own profiles identify the PERSON; the brand accounts do not.
              sameAs: [c.connect.facebookUrl, c.connect.instagramUrl].filter(Boolean),
            },
          }),
        },
      ],
    };
  },
  component: FounderPage,
});

function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

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
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Founder page sections"
      className="site-sticky-under-header sticky z-20 border-b border-border bg-background/85 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => {
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

function FounderPage() {
  const loaded = Route.useLoaderData();
  const c: FounderContent = loaded ?? FOUNDER_FALLBACK;

  // Unset image fields fall back to the bundled brand assets.
  const portrait = c.hero.portraitUrl ?? founderPortrait;
  const lifestyle = c.craft.imageUrl ?? founderLifestyle;

  const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
    c.connect.whatsappMessage,
  )}`;

  // Only advertise sections that actually have content.
  const sections = [
    { id: "letter", label: c.letter.eyebrow },
    ...(c.philosophy.items.length ? [{ id: "philosophy", label: c.philosophy.eyebrow }] : []),
    ...(c.journey.items.length ? [{ id: "journey", label: c.journey.eyebrow }] : []),
    { id: "craft", label: c.craft.eyebrow },
    { id: "connect", label: c.connect.eyebrow },
  ];

  return (
    <div className="overflow-x-clip">
      {/* 1 — HERO */}
      <section className="relative isolate border-b border-border bg-secondary/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.6]"
          style={{
            background:
              "radial-gradient(58% 48% at 12% 8%, color-mix(in oklab, var(--color-gold) 20%, transparent) 0%, transparent 60%), radial-gradient(55% 45% at 88% 92%, color-mix(in oklab, var(--color-primary) 14%, transparent) 0%, transparent 60%)",
          }}
        />
        <img
          aria-hidden
          src={logo}
          alt=""
          className="pointer-events-none absolute -left-16 top-1/2 -z-10 hidden w-[30rem] max-w-none -translate-y-1/2 opacity-[0.05] lg:block"
        />

        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.85fr_1fr] lg:gap-16">
          <div className="relative mx-auto w-full max-w-sm animate-fade-in lg:max-w-md">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-[2.25rem] bg-gradient-to-br from-primary/12 via-gold/18 to-transparent"
            />
            <div className="overflow-hidden rounded-3xl border border-gold/40 bg-card p-2 shadow-card">
              <img
                src={portrait}
                alt={c.hero.portraitAlt}
                width={1024}
                height={1280}
                fetchPriority="high"
                className="aspect-[4/5] w-full rounded-[1.4rem] object-cover object-top"
              />
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold/40 bg-card px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] text-primary shadow-soft">
              Founder &amp; Creative Lead
            </div>
          </div>

          <div className="mt-6 text-center lg:mt-0 lg:text-left">
            <span className="eyebrow">{c.eyebrow}</span>
            <h1 className="mt-3 font-display text-4xl text-foreground sm:text-6xl text-balance">
              {c.name}
            </h1>
            <div className="ornament-divider mt-5 w-48 lg:justify-start" />
            <p className="mt-4 text-sm font-medium uppercase tracking-[0.18em] text-gold">
              {c.role}
            </p>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground lg:mx-0">
              {c.hero.intro}
            </p>

            {c.hero.stats.length > 0 && (
              <dl className="mx-auto mt-8 grid max-w-md grid-cols-3 gap-3 lg:mx-0 lg:max-w-lg">
                {c.hero.stats.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-gold/25 bg-card px-3 py-4 text-center shadow-soft"
                  >
                    <dt className="text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
                      {s.label}
                    </dt>
                    <dd className="mt-1 font-display text-lg text-foreground">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <Button size="lg" asChild>
                <Link to="/shop">Shop Her Collection</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/about">The Brand Story</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <SectionNav sections={sections} />

      {/* 2 — IN HER WORDS */}
      <section id="letter" className="mx-auto max-w-3xl scroll-mt-36 px-4 py-20 sm:px-6">
        <div className="text-center">
          <span className="eyebrow">{c.letter.eyebrow}</span>
          <h2 className="mt-3 font-display text-4xl text-foreground sm:text-5xl text-balance">
            {c.letter.title}
          </h2>
          <div className="ornament-divider mx-auto mt-4 w-48" />
        </div>

        <figure className="relative mt-12 rounded-[2rem] border border-gold/30 bg-secondary/40 p-8 shadow-card sm:p-12">
          <Quote className="absolute -top-4 left-8 h-10 w-10 fill-gold text-gold" aria-hidden />
          <div className="space-y-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {c.letter.paragraphs.map((p, i) => (
              <p key={i} className={i === c.letter.paragraphs.length - 1 ? "text-foreground" : ""}>
                {p}
              </p>
            ))}
          </div>
          <figcaption className="mt-8 border-t border-gold/25 pt-6">
            <p className="font-display text-3xl italic text-primary">{c.name}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-gold">{c.role}</p>
          </figcaption>
        </figure>
      </section>

      {/* 3 — PHILOSOPHY */}
      {c.philosophy.items.length > 0 && (
        <section id="philosophy" className="scroll-mt-36 bg-secondary/30 py-20">
          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
            <span className="eyebrow">{c.philosophy.eyebrow}</span>
            <h2 className="mt-3 font-display text-4xl text-foreground sm:text-5xl text-balance">
              {c.philosophy.title}
            </h2>
            <div className="ornament-divider mx-auto mt-4 w-48" />
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {c.philosophy.items.map((p) => {
                const Icon = ICONS[p.icon];
                return (
                  <div
                    key={p.title}
                    className="group rounded-3xl border border-border bg-card p-7 text-left shadow-soft transition-all hover:-translate-y-1 hover:border-gold/50 hover:shadow-card"
                  >
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-primary transition-colors group-hover:bg-gold/25">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-5 font-display text-2xl text-foreground">{p.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 4 — JOURNEY */}
      {c.journey.items.length > 0 && (
        <section id="journey" className="mx-auto max-w-4xl scroll-mt-36 px-4 py-20 sm:px-6">
          <div className="text-center">
            <span className="eyebrow">{c.journey.eyebrow}</span>
            <h2 className="mt-3 font-display text-4xl text-foreground sm:text-5xl text-balance">
              {c.journey.title}
            </h2>
            <div className="ornament-divider mx-auto mt-4 w-48" />
          </div>

          <ol className="relative mt-14 space-y-10 border-l border-gold/30 pl-8 sm:pl-12">
            {c.journey.items.map((j) => {
              const Icon = ICONS[j.icon];
              return (
                <li key={j.title} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[2.6rem] grid h-10 w-10 place-items-center rounded-full border border-gold/40 bg-card text-primary shadow-soft sm:-left-[3.85rem]"
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div className="rounded-3xl border border-border bg-card p-6 shadow-soft transition-all hover:border-gold/40 hover:shadow-card sm:p-7">
                    <p className="text-[0.65rem] uppercase tracking-[0.2em] text-gold">
                      {j.chapter}
                    </p>
                    <h3 className="mt-2 font-display text-2xl text-foreground sm:text-3xl">
                      {j.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{j.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* 5 — HER CRAFT */}
      <section id="craft" className="scroll-mt-36 bg-secondary/30 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
          <div className="relative mx-auto w-full max-w-md">
            <div className="overflow-hidden rounded-[2rem] border border-gold/30 bg-card p-2 shadow-card">
              <img
                src={lifestyle}
                alt={c.craft.imageAlt}
                width={1024}
                height={1280}
                loading="lazy"
                className="aspect-[4/5] w-full rounded-[1.6rem] object-cover"
              />
            </div>
            <p className="mt-5 text-center font-display text-xl italic text-primary/80">
              “{c.craft.imageCaption}”
            </p>
          </div>

          <div className="space-y-5">
            <span className="eyebrow">{c.craft.eyebrow}</span>
            <h2 className="font-display text-4xl text-foreground sm:text-5xl text-balance">
              {c.craft.title}
            </h2>
            <div className="ornament-divider w-40 justify-start" />
            <p className="text-sm leading-relaxed text-muted-foreground">{c.craft.body}</p>
            {c.craft.details.length > 0 && (
              <ul className="grid gap-3 pt-1 sm:grid-cols-2">
                {c.craft.details.map((d) => (
                  <li
                    key={d}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                  >
                    <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
                    {d}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" asChild className="mt-2">
              <Link to="/custom-size-policy">
                How Custom Fit Works <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 6 — SIGNATURE QUOTE */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <Flower2 className="mx-auto h-9 w-9 text-gold" aria-hidden />
        <blockquote className="mt-6 font-display text-3xl leading-snug text-primary sm:text-4xl text-balance">
          “{c.quote.text}”
        </blockquote>
        <p className="mt-4 text-xs uppercase tracking-[0.2em] text-gold">— {c.quote.attribution}</p>
      </section>

      {/* 7 — CONNECT */}
      {/* -mb-20 cancels the footer's site-wide mt-20: without it the cream gap
          cuts a pale stripe between this maroon band and the maroon footer. */}
      <section id="connect" className="-mb-20 scroll-mt-36 bg-gradient-hero">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
          <span className="eyebrow text-gold">{c.connect.eyebrow}</span>
          <h2 className="mt-3 font-display text-4xl text-primary-foreground sm:text-5xl text-balance">
            {c.connect.title}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-primary-foreground/80">
            {c.connect.body}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" variant="secondary" asChild>
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Chat on WhatsApp
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-gold/60 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              asChild
            >
              <Link to="/contact">Contact the Boutique</Link>
            </Button>
          </div>

          <div className="mt-10 flex items-center justify-center gap-3">
            {[
              {
                icon: Instagram,
                label: c.connect.instagramUrl ? `${c.name} on Instagram` : "Nongorr on Instagram",
                href: c.connect.instagramUrl ?? BRAND.instagram,
              },
              {
                icon: Facebook,
                label: c.connect.facebookUrl ? `${c.name} on Facebook` : "Nongorr on Facebook",
                href: c.connect.facebookUrl ?? BRAND.facebook,
              },
              { icon: Mail, label: "Email Nongorr", href: `mailto:${BRAND.email}` },
            ].map(({ icon: Icon, label, href }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("mailto:") ? undefined : "_blank"}
                rel="noopener noreferrer"
                aria-label={label}
                className="inline-flex size-11 items-center justify-center rounded-full border border-gold/30 text-primary-foreground/80 transition-all hover:scale-110 hover:border-gold hover:text-gold"
              >
                <Icon className="size-4.5" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
