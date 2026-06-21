import { Link } from "@tanstack/react-router";
import { ArrowRight, Ruler, HandHeart, Truck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImg from "@/assets/products/kurti.jpg";
import logo from "@/assets/nongorr-logo-transparent.png";

const trustBadges = [
  { icon: HandHeart, label: "Handmade with care" },
  { icon: Ruler, label: "Custom sizing available" },
  { icon: Truck, label: "Nationwide delivery" },
];

const floatingCards = [
  { icon: Ruler, title: "Custom Fit", sub: "Made to measure" },
  { icon: HandHeart, title: "Handmade", sub: "Artisan crafted" },
  { icon: Sparkles, title: "New Arrivals", sub: "Festive 2026" },
];

export function HeroSection() {
  return (
    <section className="relative bg-background">
      {/* Soft ivory watercolour texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 12% 8%, oklch(0.93 0.03 75 / 0.6) 0%, transparent 60%)," +
            "radial-gradient(55% 45% at 92% 18%, oklch(0.7 0.1 80 / 0.18) 0%, transparent 55%)," +
            "radial-gradient(70% 60% at 85% 95%, oklch(0.36 0.115 18 / 0.10) 0%, transparent 60%)",
        }}
      />
      {/* Maroon fabric wave/ribbon inspired by the logo */}
      <svg
        aria-hidden
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        className="pointer-events-none absolute -bottom-2 left-0 h-40 w-full text-primary/10"
      >
        <path
          fill="currentColor"
          d="M0,160 C240,260 480,60 720,140 C960,220 1200,80 1440,160 L1440,320 L0,320 Z"
        />
      </svg>

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:py-24">
        {/* LEFT — editorial copy */}
        <div className="order-1 max-w-xl space-y-6 text-center lg:text-left">
          <span className="eyebrow animate-fade-in">Handmade Clothing from Bangladesh</span>
          <h1 className="font-display text-4xl leading-[1.05] text-foreground animate-fade-in sm:text-5xl lg:text-6xl">
            Handcrafted Kurti, <span className="text-primary">Tailored for Her</span>
          </h1>
          <div className="ornament-divider mx-auto w-44 lg:mx-0" />
          <p className="mx-auto max-w-md text-base leading-relaxed text-muted-foreground animate-fade-in lg:mx-0">
            Discover premium Bangladeshi kurti, custom-size tailoring, saree, girls dress and beauty
            essentials — crafted with care, styled with elegance.
          </p>

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <Link to="/shop" search={{ filter: "new-arrivals" } as never}>
                Shop New Arrivals <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
              <Link to="/size-guide">Explore Custom Fit</Link>
            </Button>
          </div>

          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-1 lg:justify-start">
            {trustBadges.map((b) => (
              <li
                key={b.label}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <b.icon className="h-4 w-4 text-gold" /> {b.label}
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT — premium product visual card */}
        <div className="hero-perspective relative order-2 mx-auto w-full max-w-md lg:max-w-none">
          {/* Anchor / logo watermark */}
          <img
            src={logo}
            alt=""
            aria-hidden
            className="pointer-events-none absolute -right-4 -top-6 z-0 h-28 w-28 opacity-[0.06] sm:h-36 sm:w-36"
          />

          <div className="hero-tilt relative z-10 overflow-hidden rounded-[2rem] border border-gold/30 bg-card shadow-card animate-scale-in">
            <div className="relative aspect-[4/5] w-full">
              <img
                src={heroImg}
                alt="Nongorr handcrafted maroon kurti — signature edit"
                width={800}
                height={1000}
                loading="eager"
                fetchPriority="high"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/40 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-card/85 p-4 backdrop-blur">
                <p className="eyebrow text-[0.6rem]">Signature Edit</p>
                <p className="mt-1 font-display text-xl text-foreground">Maroon Handloom Kurti</p>
                <p className="text-sm text-muted-foreground">Embroidered · Custom-size ready</p>
              </div>
            </div>
          </div>

          {/* Floating cards — normal grid up to lg; float outside only from xl where room exists */}
          <div className="z-20 mt-4 grid grid-cols-3 gap-2.5 xl:absolute xl:-left-6 xl:bottom-10 xl:mt-0 xl:w-44 xl:grid-cols-1 xl:gap-3">
            {floatingCards.map((c) => (
              <div
                key={c.title}
                className="flex items-center gap-2.5 rounded-2xl border border-border bg-card/90 p-2.5 shadow-soft backdrop-blur lg:p-3"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-primary">
                  <c.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-display text-base leading-tight text-foreground">
                    {c.title}
                  </p>
                  <p className="truncate text-[0.7rem] text-muted-foreground">{c.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
