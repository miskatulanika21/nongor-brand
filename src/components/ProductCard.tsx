import { Link } from "@tanstack/react-router";
import { Heart, Eye } from "lucide-react";
import { type Product } from "@/lib/products";
import { DEFAULT_FOCAL, focalStyle } from "@/lib/image-focal";
import { formatBDT, discountPct } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { StarRating } from "@/components/StarRating";
import { OptimizedImage } from "@/components/OptimizedImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type ProductCardView = "grid" | "list";

type CardBadge = { key: string; label: string; className: string };

function cardBadges(product: Product, discount: number | null): CardBadge[] {
  const lowStock = product.stock > 0 && product.stock <= 5;
  const ordered: CardBadge[] = [
    ...(discount && discount > 0
      ? [
          {
            key: "sale",
            label: `-${discount}%`,
            className: "bg-primary text-primary-foreground hover:bg-primary",
          },
        ]
      : []),
    ...(product.isNew
      ? [{ key: "new", label: "New", className: "bg-gold text-gold-foreground hover:bg-gold" }]
      : []),
    ...(product.isBestSeller
      ? [
          {
            key: "best",
            label: "Best Seller",
            className: "bg-foreground text-background hover:bg-foreground",
          },
        ]
      : []),
    ...(product.customSize
      ? [
          {
            key: "custom",
            label: "Custom Size",
            className: "border-gold/60 bg-card/85 text-foreground backdrop-blur",
          },
        ]
      : []),
    ...(product.isHandmade
      ? [
          {
            key: "handmade",
            label: "Handmade",
            className: "border-gold/60 bg-card/85 text-foreground backdrop-blur",
          },
        ]
      : []),
    ...(lowStock
      ? [
          {
            key: "low",
            label: "Low Stock",
            className: "bg-destructive text-destructive-foreground hover:bg-destructive",
          },
        ]
      : []),
  ];
  return ordered.slice(0, 4);
}

export function ProductCard({
  product,
  onQuickView,
  view = "grid",
}: {
  product: Product;
  onQuickView?: (p: Product) => void;
  view?: ProductCardView;
}) {
  const { toggleWishlist, isWishlisted, addToCart } = useStore();
  const wished = isWishlisted(product.id);
  const outOfStock = product.stock <= 0;
  const discount = discountPct(product.price, product.salePrice);
  const badges = cardBadges(product, discount);

  const hasReadySizes = Boolean(product.sizeStock && Object.keys(product.sizeStock).length > 0);

  // Primary action: only "Add to Bag" adds from the card; every selection-required
  // action navigates straight to the product detail page (Quick View has no selectors).
  let actionLabel: string;
  let isAddToBag = false;
  if (product.customSize && hasReadySizes) actionLabel = "View Details";
  else if (product.customSize) actionLabel = "Custom Fit";
  else if (hasReadySizes) actionLabel = "Choose Size";
  else {
    actionLabel = "Add to Bag";
    isAddToBag = true;
  }

  const wishlistButton = (
    <button
      onClick={() => {
        toggleWishlist(product.id);
        toast(wished ? "Removed from wishlist" : "Added to wishlist");
      }}
      aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={wished}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card/90 text-foreground shadow-soft backdrop-blur transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Heart className={cn("h-4 w-4", wished && "fill-primary text-primary")} />
    </button>
  );

  const primaryAction = isAddToBag ? (
    <Button
      size="sm"
      className="w-full"
      disabled={outOfStock}
      onClick={() => {
        addToCart({
          productId: product.id,
          name: product.name,
          image: product.image,
          price: product.salePrice ?? product.price,
          qty: 1,
        });
        toast.success("Added to bag");
      }}
    >
      {outOfStock ? "Sold out" : actionLabel}
    </Button>
  ) : outOfStock ? (
    <Button size="sm" className="w-full" disabled>
      Sold out
    </Button>
  ) : (
    <Button size="sm" className="w-full" asChild>
      <Link to="/product/$slug" params={{ slug: product.slug }}>
        {actionLabel}
      </Link>
    </Button>
  );

  if (view === "list") {
    return (
      <div className="group relative flex gap-3 overflow-hidden rounded-xl border border-border bg-card p-3 transition-all duration-300 hover:shadow-card sm:gap-4 sm:p-4">
        <div className="relative w-28 shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-40">
          <Link to="/product/$slug" params={{ slug: product.slug }}>
            <OptimizedImage
              src={product.image}
              alt={product.name}
              loading="lazy"
              width={400}
              height={500}
              widths={[256, 384, 640]}
              sizes="(max-width: 1024px) 50vw, 25vw"
              style={focalStyle(product.imageFocal ?? DEFAULT_FOCAL)}
              className="aspect-[4/5] h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </Link>
          {outOfStock && (
            <div className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[1px]">
              <span className="rounded-full bg-foreground/85 px-3 py-1 text-[0.6rem] font-medium uppercase tracking-widest text-background">
                Sold out
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <span className="eyebrow text-[0.6rem] text-muted-foreground">{product.category}</span>
            {wishlistButton}
          </div>
          <Link
            to="/product/$slug"
            params={{ slug: product.slug }}
            className="line-clamp-2 font-display text-base leading-snug text-foreground transition-colors hover:text-primary sm:text-lg"
          >
            {product.name}
          </Link>
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <Badge
                  key={b.key}
                  variant={b.key === "custom" || b.key === "handmade" ? "outline" : "default"}
                  className={cn("max-w-full truncate text-[0.65rem]", b.className)}
                >
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
          <StarRating rating={product.rating} count={product.reviewCount} />
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-primary">
                {formatBDT(product.salePrice ?? product.price)}
              </span>
              {product.salePrice && (
                <span className="text-sm text-muted-foreground line-through">
                  {formatBDT(product.price)}
                </span>
              )}
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {onQuickView && !outOfStock && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => onQuickView(product)}
                >
                  <Eye className="h-4 w-4" /> Quick view
                </Button>
              )}
              <div className="min-w-0 flex-1 sm:w-36 sm:flex-none">{primaryAction}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-300 hover:shadow-card">
      <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
        <Link to="/product/$slug" params={{ slug: product.slug }}>
          <OptimizedImage
            src={product.image}
            alt={product.name}
            loading="lazy"
            width={800}
            height={1000}
            widths={[256, 384, 640]}
            sizes="(max-width: 640px) 40vw, 320px"
            style={focalStyle(product.imageFocal ?? DEFAULT_FOCAL)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </Link>

        <div className="absolute left-2.5 top-2.5 flex max-w-[calc(100%-3.25rem)] flex-col items-start gap-1.5">
          {badges.map((b) => (
            <Badge
              key={b.key}
              variant={b.key === "custom" || b.key === "handmade" ? "outline" : "default"}
              className={cn("max-w-full truncate", b.className)}
            >
              {b.label}
            </Badge>
          ))}
        </div>

        <div className="absolute right-2.5 top-2.5">{wishlistButton}</div>

        {outOfStock && (
          <div className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[1px]">
            <span className="rounded-full bg-foreground/85 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-background">
              Sold out
            </span>
          </div>
        )}

        {onQuickView && !outOfStock && (
          <div className="absolute inset-x-2.5 bottom-2.5 flex gap-2 opacity-100 transition-all duration-300 group-focus-within:opacity-100 lg:translate-y-3 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 gap-1.5 bg-card/95 backdrop-blur focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onQuickView(product)}
            >
              <Eye className="h-4 w-4" /> Quick view
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <span className="eyebrow text-[0.6rem] text-muted-foreground">{product.category}</span>
        <Link
          to="/product/$slug"
          params={{ slug: product.slug }}
          className="line-clamp-2 font-display text-lg leading-snug text-foreground transition-colors hover:text-primary"
        >
          {product.name}
        </Link>
        <StarRating rating={product.rating} count={product.reviewCount} />
        <div className="mt-auto flex flex-col gap-2.5 pt-2">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-primary">
              {formatBDT(product.salePrice ?? product.price)}
            </span>
            {product.salePrice && (
              <span className="text-sm text-muted-foreground line-through">
                {formatBDT(product.price)}
              </span>
            )}
          </div>
          {primaryAction}
        </div>
      </div>
    </div>
  );
}
