import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Search, Home } from "lucide-react";
import notFoundIllustration from "@/assets/notfound-illustration.webp";

/**
 * Branded "Page not found" experience used by:
 *   - the root not-found boundary (unknown top-level URLs)
 *   - the /_site splat (unknown URLs under the public shell)
 *   - the product $slug not-found boundary (invalid product slugs)
 *
 * Visual language matches the rest of Nongorr: cream canvas, deep maroon
 * primary, antique-gold accents, Cormorant Garamond display, soft cards.
 * The decorative SVG is inline and purely ornamental (alt=""/aria-hidden).
 */
export function NotFoundPage() {
  return (
    <section aria-labelledby="notfound-title" className="relative isolate overflow-hidden">
      {/* Soft botanical wash, decorative only */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 20%, color-mix(in oklab, var(--gold) 18%, transparent) 0%, transparent 70%), radial-gradient(50% 45% at 90% 85%, color-mix(in oklab, var(--primary) 10%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-12 lg:gap-14 lg:py-28">
        {/* Copy + actions */}
        <div className="animate-fade-in lg:col-span-7">
          <span className="eyebrow text-gold-foreground/70">404 · Nongorr Studio</span>
          <p
            aria-hidden="true"
            className="mt-2 select-none font-display text-[5.5rem] leading-none tracking-tight text-primary/90 sm:text-[7rem] lg:text-[8.5rem]"
          >
            404
          </p>
          <h1
            id="notfound-title"
            className="mt-3 font-display text-3xl text-foreground sm:text-4xl lg:text-5xl"
          >
            This page has drifted away.
          </h1>
          <div className="ornament-divider mt-5 w-40" />
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            The page you’re looking for may have moved, sold out, or no longer exists. Let’s guide
            you back to something beautiful.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="group">
              <Link to="/">
                <Home className="h-4 w-4" />
                Return to Home
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/shop">Explore the Shop</Link>
            </Button>
          </div>

          {/* Helpful links — only real, existing routes */}
          <nav aria-label="Helpful links" className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              to="/shop"
              search={{ filter: "new" }}
              className="text-primary underline-offset-4 hover:underline"
            >
              New Arrivals
            </Link>
            <Link to="/size-guide" className="text-primary underline-offset-4 hover:underline">
              Size Guide
            </Link>
            <Link to="/contact" className="text-primary underline-offset-4 hover:underline">
              Contact
            </Link>
            <Link
              to="/shop"
              className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search Products
            </Link>
          </nav>
        </div>

        {/* Decorative illustration: hanger + dangling ribbon "404" */}
        <div
          aria-hidden="true"
          className="animate-scale-in relative hidden justify-center lg:col-span-5 lg:flex"
        >
          <NotFoundIllustration />
        </div>
      </div>
    </section>
  );
}

/**
 * Editorial fashion illustration of a young woman in an elegant kurti
 * viewing a laptop showing a "404 Page not found" interface. Locally
 * generated, served as an optimized WebP. Purely decorative — alt="" and
 * aria-hidden — with explicit dimensions to prevent layout shift.
 */
function NotFoundIllustration() {
  return (
    <div className="mx-auto aspect-[4/5] w-full max-w-[420px]">
      <img
        src={notFoundIllustration}
        alt=""
        aria-hidden="true"
        width={1024}
        height={1536}
        decoding="async"
        draggable={false}
        className="h-full w-full select-none object-contain"
      />
    </div>
  );
}
