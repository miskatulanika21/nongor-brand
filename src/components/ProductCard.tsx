import { Link } from "@tanstack/react-router";
import { Heart, Eye } from "lucide-react";
import { type Product } from "@/lib/products";
import { DEFAULT_FOCAL, focalStyle } from "@/lib/image-focal";
import { formatBDT, discountPct } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { StarRating } from "@/components/StarRating";
import { OptimizedImage } from "@/components/OptimizedImage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type ProductCardView = "grid" | "list";

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
  const isList = view === "list";
  const hasReadySizes = Boolean(product.sizeStock && Object.keys(product.sizeStock).length > 0);

  // One merchandising highlight; attributes and availability are plain text.
  // Nothing covers the garment, including on touch devices and sold-out items.
  const highlight = outOfStock
    ? "Sold out"
    : discount
      ? `${discount}% off`
      : product.isNew
        ? "New"
        : product.isBestSeller
          ? "Best Seller"
          : null;
  const attributes = [product.customSize && "Custom size", product.isHandmade && "Handmade"]
    .filter(Boolean)
    .join(" · ");
  const lowStock = !outOfStock && product.stock <= 5;

  // Selection-required actions go to the detail page; Quick View has no selectors.
  let actionLabel: string;
  let isAddToBag = false;
  if (product.customSize && hasReadySizes) actionLabel = "View Details";
  else if (product.customSize) actionLabel = "Custom Fit";
  else if (hasReadySizes) actionLabel = "Choose Size";
  else {
    actionLabel = "Add to Bag";
    isAddToBag = true;
  }

  const primaryAction = isAddToBag ? (
    <Button
      size="sm"
      className="min-h-11 w-full whitespace-normal px-2"
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
    <Button size="sm" className="min-h-11 w-full" disabled>
      Sold out
    </Button>
  ) : (
    <Button size="sm" className="min-h-11 w-full whitespace-normal px-2" asChild>
      <Link to="/product/$slug" params={{ slug: product.slug }}>
        {actionLabel}
      </Link>
    </Button>
  );

  const utilityActions = (
    <div className="flex min-h-11 items-center justify-end border-b border-border/70">
      {onQuickView && !outOfStock && (
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 min-w-0 flex-1 gap-1.5 rounded-none px-1 text-xs"
          onClick={() => onQuickView(product)}
        >
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" /> Quick view
        </Button>
      )}
      <button
        type="button"
        onClick={() => {
          toggleWishlist(product.id);
          toast(wished ? "Removed from wishlist" : "Added to wishlist");
        }}
        aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
        aria-pressed={wished}
        className="grid h-11 w-11 shrink-0 place-items-center text-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Heart
          className={cn("h-4 w-4", wished && "fill-primary text-primary")}
          aria-hidden="true"
        />
      </button>
    </div>
  );

  return (
    <div
      data-testid="product-card"
      className={cn(
        "group relative flex min-w-0 overflow-hidden rounded-xl border border-border bg-card transition-shadow duration-300 hover:shadow-card",
        isList ? "gap-3 p-3 sm:gap-4 sm:p-4" : "flex-col",
      )}
    >
      <div className={cn(isList && "w-24 shrink-0 sm:w-40")}>
        <Link
          to="/product/$slug"
          params={{ slug: product.slug }}
          className={cn(
            "block aspect-[4/5] overflow-hidden bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            isList && "rounded-lg",
          )}
        >
          <OptimizedImage
            src={product.image}
            alt={product.name}
            loading="lazy"
            width={800}
            height={1000}
            widths={[256, 384, 640]}
            sizes={isList ? "(max-width: 640px) 96px, 160px" : "(max-width: 640px) 50vw, 320px"}
            style={focalStyle(product.imageFocal ?? DEFAULT_FOCAL)}
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
          />
        </Link>
        {!isList && utilityActions}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", !isList && "p-2.5 sm:p-3.5")}>
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="eyebrow break-words text-[0.6rem] text-muted-foreground">
            {product.category}
          </span>
          {highlight && (
            <span
              className={cn(
                "text-[0.65rem] font-semibold leading-5",
                outOfStock ? "text-muted-foreground" : "text-primary",
              )}
            >
              {highlight}
            </span>
          )}
        </div>
        <Link
          to="/product/$slug"
          params={{ slug: product.slug }}
          className="line-clamp-2 break-words font-display text-lg leading-relaxed text-foreground transition-colors hover:text-primary"
        >
          {product.name}
        </Link>
        {attributes && (
          <p className="text-xs leading-relaxed text-muted-foreground">{attributes}</p>
        )}
        {product.reviewCount > 0 && (
          <StarRating rating={product.rating} count={product.reviewCount} />
        )}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          {lowStock && <p className="text-xs font-medium text-primary">Low stock</p>}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span data-testid="product-price" className="text-base font-semibold text-primary">
              {formatBDT(product.salePrice ?? product.price)}
            </span>
            {product.salePrice != null && product.salePrice < product.price && (
              <span className="text-xs text-muted-foreground line-through">
                {formatBDT(product.price)}
              </span>
            )}
          </div>
          <div className={cn(isList && "flex flex-wrap items-center justify-end gap-2")}>
            {isList && <div className="w-full sm:w-44">{utilityActions}</div>}
            <div className={cn(isList && "w-full sm:w-36")}>{primaryAction}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
