import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { requiresSelection, type Product } from "@/lib/products";
import { listProductCards } from "@/lib/catalog.api";
import { formatBDT } from "@/lib/brand";
import { EmptyState } from "@/components/states";
import { ProductGrid } from "@/components/ProductGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Heart, ShoppingBag, X, Share2, BellOff } from "lucide-react";
import { toast } from "sonner";
import { absUrl } from "@/lib/site-config";

export const Route = createFileRoute("/_site/wishlist")({
  loader: () => listProductCards(),
  head: () => ({
    meta: [
      { title: "Wishlist · Nongorr" },
      {
        name: "description",
        content:
          "Your saved Nongorr favourites. Keep track of kurti, saree, beauty items and shop them when you're ready.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: absUrl("/wishlist") }],
  }),
  component: Wishlist,
});

type SortKey = "recent" | "price-asc" | "price-desc";

function priceOf(p: Product): number {
  return p.salePrice ?? p.price;
}

function Wishlist() {
  const allProducts = Route.useLoaderData();
  const { wishlist, toggleWishlist, addToCart } = useStore();
  const [sort, setSort] = useState<SortKey>("recent");

  // Recently added: use the Store ID order, reversed, mapped back to products.
  const items = useMemo(() => {
    const byId = new Map(allProducts.map((p) => [p.id, p]));
    const recent = [...wishlist]
      .reverse()
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p));
    if (sort === "price-asc") return [...recent].sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === "price-desc") return [...recent].sort((a, b) => priceOf(b) - priceOf(a));
    return recent;
  }, [wishlist, sort, allProducts]);

  const recommendations = useMemo(() => {
    const wished = new Set(wishlist);
    return allProducts
      .filter((p) => !wished.has(p.id))
      .sort(
        (a, b) =>
          Number(Boolean(b.isBestSeller)) - Number(Boolean(a.isBestSeller)) || b.rating - a.rating,
      )
      .slice(0, 4);
  }, [wishlist, allProducts]);

  const moveAllAvailable = () => {
    let moved = 0;
    let needOptions = 0;
    let soldOut = 0;
    for (const p of items) {
      if (p.stock <= 0) {
        soldOut++;
        continue;
      }
      if (requiresSelection(p)) {
        needOptions++;
        continue;
      }
      addToCart({ productId: p.id, name: p.name, image: p.image, price: priceOf(p), qty: 1 });
      toggleWishlist(p.id);
      moved++;
    }
    if (moved === 0) {
      toast.error("No items could be moved. They need options or are sold out.");
      return;
    }
    const parts = [`${moved} item${moved === 1 ? "" : "s"} moved to your bag.`];
    if (needOptions > 0)
      parts.push(`${needOptions} item${needOptions === 1 ? "" : "s"} need options.`);
    if (soldOut > 0) parts.push(`${soldOut} item${soldOut === 1 ? "" : "s"} sold out.`);
    toast.success(parts.join(" "));
  };

  const addOne = (p: Product) => {
    addToCart({ productId: p.id, name: p.name, image: p.image, price: priceOf(p), qty: 1 });
    toast.success("Added to bag");
  };

  if (wishlist.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h1 className="mb-8 font-display text-4xl text-foreground">Your Wishlist</h1>
        <EmptyState
          icon={<Heart className="h-6 w-6" />}
          title="No saved items yet"
          description="Tap the heart on any product to save it for later."
          action={
            <Button asChild className="mt-2">
              <Link to="/shop">Browse products</Link>
            </Button>
          }
        />
        {recommendations.length > 0 && (
          <div className="mt-14">
            <h2 className="mb-6 font-display text-2xl text-foreground">You may like</h2>
            <ProductGrid products={recommendations} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl text-foreground">
          Your Wishlist <span className="text-lg text-muted-foreground">({items.length})</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-44 bg-card" aria-label="Sort wishlist">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently added</SelectItem>
              <SelectItem value="price-asc">Price: low to high</SelectItem>
              <SelectItem value="price-desc">Price: high to low</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={moveAllAvailable}>
            <ShoppingBag className="h-4 w-4" /> Move All Available
          </Button>
          <ShareWishlistDialog products={items} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {items.map((p) => {
          const soldOut = p.stock <= 0;
          const needsOptions = requiresSelection(p);
          return (
            <div
              key={p.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="relative aspect-[4/5] bg-secondary">
                <Link to="/product/$slug" params={{ slug: p.slug }}>
                  <img
                    src={p.image}
                    alt={p.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </Link>
                <button
                  type="button"
                  onClick={() => toggleWishlist(p.id)}
                  aria-label={`Remove ${p.name} from wishlist`}
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-background/90 text-foreground shadow hover:bg-background"
                >
                  <X className="h-4 w-4" />
                </button>
                {soldOut && (
                  <Badge
                    variant="outline"
                    className="absolute left-2 top-2 border-destructive/30 bg-destructive/10 text-destructive"
                  >
                    Sold out
                  </Badge>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <Link
                  to="/product/$slug"
                  params={{ slug: p.slug }}
                  className="line-clamp-2 text-sm font-medium text-foreground hover:text-primary"
                >
                  {p.name}
                </Link>
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-semibold text-primary">{formatBDT(priceOf(p))}</span>
                  {p.salePrice && (
                    <span className="text-xs text-muted-foreground line-through">
                      {formatBDT(p.price)}
                    </span>
                  )}
                </div>

                <div className="mt-auto flex flex-col gap-2 pt-2">
                  {soldOut ? (
                    <Button size="sm" disabled>
                      Sold out
                    </Button>
                  ) : needsOptions ? (
                    <Button size="sm" asChild>
                      <Link to="/product/$slug" params={{ slug: p.slug }}>
                        Choose Options
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => addOne(p)}>
                      <ShoppingBag className="h-4 w-4" /> Add to Bag
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => toggleWishlist(p.id)}>
                    Remove
                  </Button>
                </div>

                {/* Placeholder alerts — no notification system exists */}
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <BellOff className="h-3 w-3" /> Price-drop alerts — coming later
                </p>
                {soldOut && (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <BellOff className="h-3 w-3" /> Back-in-stock alerts — coming later
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {recommendations.length > 0 && (
        <div className="mt-16">
          <h2 className="mb-6 font-display text-2xl text-foreground">You may also like</h2>
          <ProductGrid products={recommendations} />
        </div>
      )}
    </div>
  );
}

function ShareWishlistDialog({ products }: { products: Product[] }) {
  const text = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "https://nongorr.com";
    const lines = products.map((p) => `• ${p.name} — ${base}/product/${p.slug}`);
    return `My Nongorr wishlist:\n${lines.join("\n")}`;
  }, [products]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Wishlist copied to clipboard");
    } catch {
      toast.error("Could not copy the wishlist");
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Share2 className="h-4 w-4" /> Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share your wishlist</DialogTitle>
          <DialogDescription>
            Copy this list to share with friends. This is plain text only — no public wishlist page
            is created.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          readOnly
          value={text}
          rows={Math.min(8, products.length + 1)}
          className="font-mono text-xs"
        />
        <Separator />
        <Button onClick={copy}>Copy to clipboard</Button>
      </DialogContent>
    </Dialog>
  );
}
