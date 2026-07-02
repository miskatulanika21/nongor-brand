import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { type Product, requiresSelection } from "@/lib/products";
import { ProductCard, type ProductCardView } from "@/components/ProductCard";
import { OptimizedImage } from "@/components/OptimizedImage";
import { cn } from "@/lib/utils";
import { ProductGridSkeleton } from "@/components/skeletons";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/StarRating";
import { formatBDT, discountPct } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

export function ProductGrid({
  products,
  isLoading = false,
  skeletonCount = 8,
  view = "grid",
}: {
  products: Product[];
  isLoading?: boolean;
  skeletonCount?: number;
  view?: ProductCardView;
}) {
  const [quick, setQuick] = useState<Product | null>(null);
  const { addToCart } = useStore();

  if (isLoading) {
    return <ProductGridSkeleton count={skeletonCount} />;
  }

  return (
    <>
      <div
        className={cn(
          view === "list"
            ? "flex flex-col gap-3 sm:gap-4"
            : "grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4",
        )}
      >
        {products.map((p) => (
          <ProductCard key={p.id} product={p} view={view} onQuickView={setQuick} />
        ))}
      </div>

      <Dialog open={!!quick} onOpenChange={(o) => !o && setQuick(null)}>
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          {quick && (
            <div className="grid gap-0 sm:grid-cols-2">
              <div className="aspect-[4/5] bg-secondary">
                <OptimizedImage
                  src={quick.image}
                  alt={quick.name}
                  widths={[384, 640]}
                  sizes="(max-width: 640px) 100vw, 384px"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-col gap-3 p-6">
                <Badge variant="outline" className="w-fit border-gold/60">
                  {quick.category}
                </Badge>
                <h3 className="font-display text-2xl text-foreground">{quick.name}</h3>
                <StarRating rating={quick.rating} count={quick.reviewCount} />
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-primary">
                    {formatBDT(quick.salePrice ?? quick.price)}
                  </span>
                  {quick.salePrice && (
                    <>
                      <span className="text-muted-foreground line-through">
                        {formatBDT(quick.price)}
                      </span>
                      <Badge className="bg-primary text-primary-foreground">
                        -{discountPct(quick.price, quick.salePrice)}%
                      </Badge>
                    </>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{quick.description}</p>
                <div className="mt-auto flex flex-col gap-2 pt-3">
                  {requiresSelection(quick) ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        This piece needs a size or custom-fit choice. Continue to details to select.
                      </p>
                      <Button asChild>
                        <Link
                          to="/product/$slug"
                          params={{ slug: quick.slug }}
                          onClick={() => setQuick(null)}
                        >
                          Choose size & options
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() => {
                          addToCart({
                            productId: quick.id,
                            name: quick.name,
                            image: quick.image,
                            price: quick.salePrice ?? quick.price,
                            qty: 1,
                          });
                          toast.success("Added to bag");
                          setQuick(null);
                        }}
                      >
                        Add to bag
                      </Button>
                      <Button variant="outline" asChild>
                        <Link
                          to="/product/$slug"
                          params={{ slug: quick.slug }}
                          onClick={() => setQuick(null)}
                        >
                          View full details
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
