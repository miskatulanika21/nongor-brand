import { Link } from "@tanstack/react-router";
import { PRIMARY_CATEGORIES, categoryPath, type NavCategory } from "@/lib/categories";
import { OptimizedImage } from "@/components/OptimizedImage";
import kurtiImg from "@/assets/products/kurti.webp";
import sareeImg from "@/assets/products/saree.webp";
import threePieceImg from "@/assets/products/three-piece.webp";
import girlsImg from "@/assets/products/girls-dress.webp";
import cosmeticsImg from "@/assets/products/cosmetics.webp";
import serumImg from "@/assets/products/serum.webp";

/** Explicit, unique image per card so no fallback is repeated. */
const IMAGE_BY_LABEL: Record<string, string> = {
  Kurti: kurtiImg,
  Saree: sareeImg,
  "Three Piece": threePieceImg,
  "Girls Dress": girlsImg,
  Cosmetics: cosmeticsImg,
  "New Arrivals": serumImg,
};

/**
 * Physical categories link to their own crawlable landing page; discovery
 * entries (New Arrivals) stay filter views of /shop, since they aren't
 * categories and have no standalone page.
 */
function linkFor(c: NavCategory): { to: string; search?: Record<string, string> } {
  if (c.category) return { to: categoryPath(c.category) };
  if (c.filter) return { to: "/shop", search: { filter: c.filter } };
  return { to: "/shop" };
}

export function CategoryStrip() {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <span className="eyebrow">Shop by Category</span>
          <h2 className="font-display text-2xl text-foreground sm:text-3xl">Find your edit</h2>
        </div>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {PRIMARY_CATEGORIES.map((c) => (
          <Link
            key={c.label}
            {...(linkFor(c) as { to: string })}
            className="gold-sweep group relative aspect-[3/4] w-36 shrink-0 snap-start overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-card active:scale-[.98] sm:w-auto"
          >
            <OptimizedImage
              src={IMAGE_BY_LABEL[c.label] ?? kurtiImg}
              alt={c.label}
              loading="lazy"
              widths={[256, 384]}
              sizes="(max-width: 640px) 144px, (max-width: 1024px) 33vw, 16vw"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/15 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 z-[2] p-3 text-center font-display text-lg leading-tight text-primary-foreground">
              {c.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
