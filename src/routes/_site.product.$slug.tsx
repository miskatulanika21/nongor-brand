import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import sizeChart from "@/assets/size-chart.webp";
import { NotFoundPage } from "@/components/NotFoundPage";
import { READY_SIZES, GIRLS_SIZES, type Product } from "@/lib/products";
import { getProductDetail, listProductCards } from "@/lib/catalog.api";
import { submitReview } from "@/lib/reviews.api";
import { formatBDT, discountPct, BRAND } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeading } from "@/components/SectionHeading";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Heart,
  MessageCircle,
  Truck,
  RotateCcw,
  ShieldCheck,
  Ruler,
  Video,
  Minus,
  Plus,
  Share2,
  Link2,
  ChevronLeft,
  ChevronRight,
  Star,
  Check,
  Clock,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

interface ReviewItem {
  id: string;
  name: string;
  rating: number;
  date: string;
  text: string;
}

export const Route = createFileRoute("/_site/product/$slug")({
  loader: async ({ params }) => {
    const product = await getProductDetail({ data: { slug: params.slug } });
    if (!product) throw notFound();
    // Lean cards power related products + recently-viewed resolution.
    const cards = await listProductCards();
    return { product, cards };
  },
  head: ({ loaderData, params }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.product.name} · Nongorr` },
          { name: "description", content: loaderData.product.description },
          { property: "og:title", content: `${loaderData.product.name} · Nongorr` },
          { property: "og:description", content: loaderData.product.description },
          { property: "og:image", content: loaderData.product.image },
          { property: "og:url", content: `/product/${params.slug}` },
          { property: "og:type", content: "product" },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:title", content: loaderData.product.name },
          { name: "twitter:description", content: loaderData.product.description },
          { name: "twitter:image", content: loaderData.product.image },
        ]
      : [],
    links: loaderData ? [{ rel: "canonical", href: `/product/${params.slug}` }] : [],
    scripts: loaderData
      ? [
          {
            type: "application/ld+json",
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              name: loaderData.product.name,
              image: loaderData.product.gallery ?? [loaderData.product.image],
              description: loaderData.product.description,
              category: loaderData.product.category,
              brand: { "@type": "Brand", name: BRAND.name },
              aggregateRating: loaderData.product.reviewCount
                ? {
                    "@type": "AggregateRating",
                    ratingValue: loaderData.product.rating,
                    reviewCount: loaderData.product.reviewCount,
                  }
                : undefined,
              offers: {
                "@type": "Offer",
                price: loaderData.product.salePrice ?? loaderData.product.price,
                priceCurrency: "BDT",
                availability:
                  loaderData.product.stock > 0
                    ? "https://schema.org/InStock"
                    : "https://schema.org/OutOfStock",
                url: `/product/${params.slug}`,
              },
            }),
          },
          {
            type: "application/ld+json",
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "/" },
                { "@type": "ListItem", position: 2, name: "Shop", item: "/shop" },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: loaderData.product.category,
                  item: `/shop?category=${encodeURIComponent(loaderData.product.category)}`,
                },
                {
                  "@type": "ListItem",
                  position: 4,
                  name: loaderData.product.name,
                  item: `/product/${params.slug}`,
                },
              ],
            }),
          },
        ]
      : [],
  }),
  notFoundComponent: NotFoundPage,
  errorComponent: () => (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-3xl">Could not load product</h1>
      <Button className="mt-6" asChild>
        <Link to="/shop">Back to shop</Link>
      </Button>
    </div>
  ),
  component: ProductPage,
});

const BODY_FIELDS = ["Bust", "Waist", "Hip", "Shoulder"];
const GARMENT_FIELDS = ["Sleeve", "Kurti Length"];
const MEASURE_FIELDS = [...BODY_FIELDS, ...GARMENT_FIELDS];
const RECENT_KEY = "nongorr:recently-viewed";

function isValidMeasure(v: string | undefined): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function ProductPage() {
  const { product, cards } = Route.useLoaderData();
  const { addToCart, toggleWishlist, isWishlisted } = useStore();
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [size, setSize] = useState<string>("");
  const [isCustom, setIsCustom] = useState(false);
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [attemptedAdd, setAttemptedAdd] = useState(false);
  const [qty, setQty] = useState(1);
  const [localReviews, setLocalReviews] = useState<ReviewItem[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  // Presentation-only gallery: unique images from primary image + gallery.
  const displayGallery = useMemo(
    () => Array.from(new Set([product.image, ...(product.gallery ?? [])].filter(Boolean))),
    [product.image, product.gallery],
  );
  const multiImage = displayGallery.length > 1;

  // Reset all route-local state when navigating to a different product.
  useEffect(() => {
    setActiveImg(0);
    setLightbox(false);
    setSize("");
    setIsCustom(false);
    setMeasures({});
    setAttemptedAdd(false);
    setQty(1);
    setLocalReviews([]);
  }, [product.id]);

  // Keep activeImg within bounds.
  useEffect(() => {
    setActiveImg((i) => (i > displayGallery.length - 1 ? 0 : i));
  }, [displayGallery.length]);

  // Recently viewed (session only, SSR-guarded).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let prior: string[] = [];
    try {
      prior = JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      prior = [];
    }
    setRecentIds(prior.filter((id) => id !== product.id).slice(0, 4));
    const next = [product.id, ...prior.filter((id) => id !== product.id)].slice(0, 8);
    try {
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [product.id]);

  // Lightbox arrow-key navigation (only while open and with multiple images).
  useEffect(() => {
    if (!lightbox || !multiImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")
        setActiveImg((i) => (i - 1 + displayGallery.length) % displayGallery.length);
      if (e.key === "ArrowRight") setActiveImg((i) => (i + 1) % displayGallery.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, multiImage, displayGallery.length]);

  const off = discountPct(product.price, product.salePrice);
  const wished = isWishlisted(product.id);
  const needsSize =
    ["kurti", "girls-dress"].includes(product.type) ||
    (product.type === "three-piece" && !!product.stitched);
  const sizes = product.type === "girls-dress" ? GIRLS_SIZES : READY_SIZES;
  const unitPrice = product.salePrice ?? product.price;
  const customCharge = isCustom ? (product.customSizeCharge ?? 0) : 0;
  const liveTotal = (unitPrice + customCharge) * qty;
  const lowStock = product.stock > 0 && product.stock <= 5;
  const allMeasuresValid = MEASURE_FIELDS.every((f) => isValidMeasure(measures[f]));

  const categorySlug = ["cosmetics", "makeup", "serum"].includes(product.type)
    ? "cosmetics"
    : product.type;

  // Review aggregate: keep real counts, add local reviews on top.
  const displayedReviews = [...localReviews, ...(product.reviews ?? [])];
  const totalReviewCount = product.reviewCount + localReviews.length;
  const updatedAverage =
    totalReviewCount === 0
      ? 0
      : (product.rating * product.reviewCount + localReviews.reduce((s, r) => s + r.rating, 0)) /
        totalReviewCount;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: displayedReviews.filter((r) => Math.round(r.rating) === star).length,
  }));
  const distTotal = displayedReviews.length;

  const recentProducts = recentIds
    .map((id) => cards.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p) && p!.id !== product.id)
    .slice(0, 4);

  // Related: other products of the same type (from lean cards).
  const related = cards.filter((p) => p.type === product.type && p.id !== product.id).slice(0, 4);

  const shareUrl =
    typeof window !== "undefined" ? window.location.href : `/product/${product.slug}`;
  const copyLink = () => {
    navigator.clipboard?.writeText(shareUrl).then(
      () => toast.success("Product link copied"),
      () => toast.error("Could not copy link"),
    );
  };

  const galleryStep = (dir: number) => {
    setActiveImg((i) => (i + dir + displayGallery.length) % displayGallery.length);
  };

  const handleAdd = () => {
    if (needsSize && !isCustom && !size) {
      toast.error("Please select a size");
      return;
    }
    if (isCustom && !allMeasuresValid) {
      setAttemptedAdd(true);
      toast.error("Please enter valid measurements (greater than 0)");
      return;
    }
    addToCart({
      productId: product.id,
      name: product.name,
      image: product.image,
      price: product.salePrice ?? product.price,
      qty,
      size: isCustom ? "Custom" : size || undefined,
      customSize: isCustom ? measures : undefined,
      customCharge: isCustom ? product.customSizeCharge : undefined,
    });
    toast.success("Added to bag");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-primary">
          Home
        </Link>{" "}
        /{" "}
        <Link to="/shop" className="hover:text-primary">
          Shop
        </Link>{" "}
        /{" "}
        <Link
          to="/shop"
          search={{ category: categorySlug, q: "", filter: "" }}
          className="hover:text-primary"
        >
          {product.category}
        </Link>{" "}
        / <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Gallery */}
        <div className="space-y-3">
          <button
            type="button"
            className="relative block aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-2xl bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setLightbox(true)}
            aria-label="Open image viewer"
          >
            <img
              src={displayGallery[activeImg]}
              alt={`${product.name} — view ${activeImg + 1}`}
              className="h-full w-full object-cover"
            />
            <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1.5">
              {product.isNew && <Badge className="bg-gold text-gold-foreground">New</Badge>}
              {off && <Badge className="bg-primary text-primary-foreground">-{off}%</Badge>}
              {product.isHandmade && (
                <Badge variant="outline" className="border-gold/60 bg-card/80 backdrop-blur">
                  Handmade
                </Badge>
              )}
            </div>
            {multiImage && (
              <span className="absolute bottom-3 right-3 rounded-full bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
                {activeImg + 1} / {displayGallery.length}
              </span>
            )}
          </button>

          {(multiImage || product.hasVideo) && (
            <div className="pdp-thumb-rail flex gap-3 overflow-x-auto pb-1">
              {multiImage &&
                displayGallery.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImg(i)}
                    aria-label={`View ${product.name} image ${i + 1}`}
                    aria-current={activeImg === i}
                    className={cn(
                      "aspect-square w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-24",
                      activeImg === i ? "border-primary" : "border-transparent hover:border-border",
                    )}
                  >
                    <img
                      src={g}
                      alt={`${product.name} — view ${i + 1}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              {product.hasVideo && (
                <div
                  aria-disabled="true"
                  className="grid aspect-square w-20 shrink-0 cursor-not-allowed place-items-center gap-1 rounded-lg border-2 border-dashed border-border bg-secondary/60 p-1 text-center text-muted-foreground opacity-70 sm:w-24"
                >
                  <Video className="h-5 w-5" />
                  <span className="text-[0.55rem] leading-tight">Product video coming soon</span>
                </div>
              )}
            </div>
          )}

          {/* Fullscreen lightbox */}
          <Dialog open={lightbox} onOpenChange={setLightbox}>
            <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
              <DialogTitle className="sr-only">{product.name} image viewer</DialogTitle>
              <div className="relative bg-background">
                <img
                  src={displayGallery[activeImg]}
                  alt={`${product.name} — view ${activeImg + 1}`}
                  className="mx-auto max-h-[80vh] w-auto object-contain"
                />
                {multiImage && (
                  <>
                    <button
                      onClick={() => galleryStep(-1)}
                      aria-label="Previous image"
                      className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-foreground shadow-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => galleryStep(1)}
                      aria-label="Next image"
                      className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-foreground shadow-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-card/90 px-3 py-1 text-xs text-muted-foreground">
                      {activeImg + 1} / {displayGallery.length}
                    </div>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Info */}
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <Badge variant="outline" className="border-gold/60">
                {product.category}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                    <Share2 className="h-4 w-4" /> Share
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(`${product.name} — ${shareUrl}`)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle className="mr-2 h-4 w-4" /> Share on WhatsApp
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={copyLink}>
                    <Link2 className="mr-2 h-4 w-4" /> Copy product link
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <h1 className="font-display text-4xl leading-tight text-foreground">{product.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StarRating rating={updatedAverage} count={totalReviewCount} showValue />
              {product.isBestSeller && (
                <Badge className="bg-foreground text-background">Best Seller</Badge>
              )}
            </div>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-primary">
              {formatBDT(product.salePrice ?? product.price)}
            </span>
            {product.salePrice && (
              <span className="text-lg text-muted-foreground line-through">
                {formatBDT(product.price)}
              </span>
            )}
            {off && <Badge className="bg-primary text-primary-foreground">-{off}%</Badge>}
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>

          {product.stock <= 0 ? (
            <p className="text-sm font-medium text-destructive">Currently sold out</p>
          ) : lowStock ? (
            <p className="text-sm font-medium text-destructive">Only {product.stock} left</p>
          ) : (
            <p className="text-sm font-medium text-success">In stock · {product.stock} available</p>
          )}

          {/* Dynamic options */}
          <ProductOptions
            product={product}
            needsSize={needsSize}
            sizes={sizes as readonly string[]}
            size={size}
            setSize={setSize}
            isCustom={isCustom}
            setIsCustom={setIsCustom}
            measures={measures}
            setMeasures={setMeasures}
            attemptedAdd={attemptedAdd}
            allMeasuresValid={allMeasuresValid}
            sizeChartUrl={sizeChart}
          />

          {/* Live total preview (custom-size charge) */}
          {isCustom && customCharge > 0 && (
            <div className="space-y-1.5 rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Base price</span>
                <span>{formatBDT(unitPrice)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Custom-size charge per item</span>
                <span>{formatBDT(customCharge)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Quantity</span>
                <span>{qty}</span>
              </div>
              <div className="flex justify-between border-t border-gold/30 pt-1.5 font-semibold text-foreground">
                <span>
                  Total ({formatBDT(unitPrice)} + {formatBDT(customCharge)}) × {qty}
                </span>
                <span className="text-primary">{formatBDT(liveTotal)}</span>
              </div>
            </div>
          )}

          {/* Qty + actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="flex items-center rounded-lg border border-border">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Decrease quantity"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-sm font-medium">{qty}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Increase quantity"
                onClick={() => setQty((q) => q + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button size="lg" className="flex-1" disabled={product.stock <= 0} onClick={handleAdd}>
              Add to bag
            </Button>
            <Button
              size="lg"
              variant="outline"
              aria-label={wished ? "Remove from wishlist" : "Save to wishlist"}
              onClick={() => {
                toggleWishlist(product.id);
                toast(wished ? "Removed" : "Saved to wishlist");
              }}
            >
              <Heart className={cn("h-5 w-5", wished && "fill-primary text-primary")} />
            </Button>
          </div>

          <Button
            variant="outline"
            className="w-full gap-2 border-success/40 text-success hover:bg-success hover:text-success-foreground"
            asChild
          >
            <a href={`https://wa.me/${BRAND.whatsapp}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" /> Chat with us on WhatsApp
            </a>
          </Button>

          {/* Delivery & trust */}
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <TrustCard icon={Truck} title="Inside Dhaka" text="Delivery in 1–3 days." />
            <TrustCard icon={Truck} title="Outside Dhaka" text="Delivery in 3–5 days." />
            <TrustCard
              icon={Clock}
              title="Handmade & custom-size"
              text="May require preparation time before dispatch."
            />
            <TrustCard
              icon={RotateCcw}
              title="Returns"
              text="Custom-size items are non-returnable."
            />
            <TrustCard icon={Wallet} title="Payment" text="bKash payments are manually verified." />
            <TrustCard icon={ShieldCheck} title="Authentic" text="Curated by Nongorr Studio." />
          </div>
        </div>
      </div>

      {/* Detail tabs */}
      <div className="mt-14">
        <Tabs defaultValue="details">
          <TabsList className="flex-wrap">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="care">Care</TabsTrigger>
            <TabsTrigger value="delivery">Delivery & Returns</TabsTrigger>
            <TabsTrigger value="reviews">Reviews ({totalReviewCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="pt-6">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <SpecList product={product} />
            </div>
          </TabsContent>

          <TabsContent
            value="care"
            className="max-w-2xl pt-6 text-sm leading-relaxed text-muted-foreground"
          >
            {product.care ?? "Handle with care. Store in a cool, dry place."}
            {product.howToUse && (
              <p className="mt-4">
                <strong className="text-foreground">How to use:</strong> {product.howToUse}
              </p>
            )}
            {product.safety && (
              <p className="mt-2">
                <strong className="text-foreground">Safety:</strong> {product.safety}
              </p>
            )}
          </TabsContent>

          <TabsContent
            value="delivery"
            className="max-w-2xl pt-6 text-sm leading-relaxed text-muted-foreground"
          >
            <p>
              Inside Dhaka: 1–3 days · Outside Dhaka: 3–5 days. Delivery charge calculated at
              checkout.
            </p>
            <p className="mt-3">
              Handmade and custom-size products may require preparation time before dispatch.
              Custom-size items are non-returnable. See our{" "}
              <Link to="/return-policy" className="text-primary underline">
                Return Policy
              </Link>
              .
            </p>
            <p className="mt-3">
              bKash payments are manually verified by our team. More questions? Browse our{" "}
              <Link to="/faq" className="text-primary underline">
                FAQ
              </Link>{" "}
              or{" "}
              <Link to="/contact" className="text-primary underline">
                contact our team
              </Link>
              .
            </p>
          </TabsContent>

          <TabsContent value="reviews" className="max-w-2xl space-y-5 pt-6">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-6">
                <div className="text-center">
                  <div className="font-display text-4xl text-foreground">
                    {updatedAverage.toFixed(1)}
                  </div>
                  <StarRating rating={updatedAverage} className="mt-1 justify-center" />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totalReviewCount} total ratings
                  </p>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Distribution of displayed reviews
                  </p>
                  {distribution.map((d) => (
                    <div key={d.star} className="flex items-center gap-2 text-xs">
                      <span className="w-8 text-muted-foreground">{d.star}★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-gold"
                          style={{ width: `${distTotal ? (d.count / distTotal) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-muted-foreground">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ReviewForm code={product.id} />
            {displayedReviews.map((r: ReviewItem) => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg text-foreground">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.date}</span>
                </div>
                <StarRating rating={r.rating} className="my-2" />
                <p className="text-sm text-muted-foreground">{r.text}</p>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </div>

      {/* Related */}
      <div className="mt-16">
        <SectionHeading eyebrow="You may also like" title="Related Products" />
        <ProductGrid products={related} />
      </div>

      {/* Recently viewed (session only) */}
      {recentProducts.length > 0 && (
        <div className="mt-16">
          <SectionHeading eyebrow="From your visit" title="Recently Viewed" />
          <ProductGrid products={recentProducts} />
        </div>
      )}

      {/* Mobile sticky purchase bar */}
      {product.stock > 0 && (
        <div className="pdp-mobile-purchase-bar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3 pr-16">
            <div className="min-w-0">
              <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="truncate text-base font-semibold text-primary">
                {formatBDT(liveTotal)}
              </p>
            </div>
            <Button className="flex-1" onClick={handleAdd}>
              Add to Bag
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrustCard({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Truck;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-secondary/60 p-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function SpecList({ product }: { product: Product }) {
  const rows: [string, string | undefined][] = [
    ["Fabric / Material", product.fabric],
    ["Colour", product.color],
    ["Occasion", product.occasion],
    ["Work type", product.workType],
    ["Length", product.length],
    [
      "Blouse piece",
      product.blousePiece === undefined
        ? undefined
        : product.blousePiece
          ? "Included"
          : "Not included",
    ],
    ["Pieces included", product.piecesIncluded],
    [
      "Stitching",
      product.stitched === undefined ? undefined : product.stitched ? "Stitched" : "Unstitched",
    ],
    ["Shade", product.shade],
    ["Volume", product.volume],
    ["Skin type", product.skinType],
    ["Expiry", product.expiry],
    ["Batch no.", product.batch],
    ["Ingredients", product.ingredients],
  ];
  return (
    <>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-border py-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right font-medium text-foreground">{v}</span>
          </div>
        ))}
    </>
  );
}

function ProductOptions({
  product,
  needsSize,
  sizes,
  size,
  setSize,
  isCustom,
  setIsCustom,
  measures,
  setMeasures,
  attemptedAdd,
  allMeasuresValid,
  sizeChartUrl,
}: {
  product: Product;
  needsSize: boolean;
  sizes: readonly string[];
  size: string;
  setSize: (s: string) => void;
  isCustom: boolean;
  setIsCustom: (b: boolean) => void;
  measures: Record<string, string>;
  setMeasures: (m: Record<string, string>) => void;
  attemptedAdd: boolean;
  allMeasuresValid: boolean;
  sizeChartUrl: string;
}) {
  if (["cosmetics", "makeup", "serum"].includes(product.type)) {
    return (
      <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          {product.shade && <Spec label="Shade" value={product.shade} />}
          {product.volume && <Spec label="Volume" value={product.volume} />}
          {product.skinType && <Spec label="Skin type" value={product.skinType} />}
          {product.expiry && <Spec label="Expiry" value={product.expiry} />}
        </div>
      </div>
    );
  }

  if (product.type === "saree" || (product.type === "three-piece" && !product.stitched)) {
    return (
      <div className="rounded-xl bg-secondary/50 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Ruler className="h-4 w-4 text-gold" /> One size ·{" "}
          {product.type === "saree" ? "Saree" : "Unstitched fabric"}
        </p>
        <p className="mt-1 text-muted-foreground">
          No size selection needed.{" "}
          {product.type === "three-piece"
            ? "Get it stitched to your fit by your tailor."
            : "Drape it your way."}
        </p>
      </div>
    );
  }

  if (!needsSize) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">
          {product.type === "girls-dress" ? "Select age / size" : "Select size"}
        </Label>
        <div className="flex items-center gap-3">
          <Link
            to="/size-guide"
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            Size Guide
          </Link>
          {product.type === "kurti" && <HowToMeasure url={sizeChartUrl} />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {sizes.map((s) => {
          const stock = product.sizeStock?.[s] ?? 0;
          const disabled = stock <= 0;
          const active = !isCustom && size === s;
          return (
            <button
              key={s}
              disabled={disabled}
              onClick={() => {
                setSize(s);
                setIsCustom(false);
              }}
              className={cn(
                "min-w-12 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary",
                disabled &&
                  "cursor-not-allowed border-dashed text-muted-foreground/50 line-through",
              )}
            >
              {s}
            </button>
          );
        })}
        {product.type === "kurti" && product.customSize && (
          <button
            onClick={() => setIsCustom(true)}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isCustom
                ? "border-gold bg-gold text-gold-foreground"
                : "border-gold/60 bg-card text-foreground hover:border-gold",
            )}
          >
            ✦ Custom Size{" "}
            {product.customSizeCharge ? `(+${formatBDT(product.customSizeCharge)})` : ""}
          </button>
        )}
      </div>

      {!isCustom && (
        <p className="text-xs text-muted-foreground">
          Not sure of your fit? Check the Size Guide, or{" "}
          <a
            href={`https://wa.me/${BRAND.whatsapp}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            ask on WhatsApp
          </a>
          .
        </p>
      )}

      {isCustom && (
        <div className="space-y-4 rounded-xl border border-gold/40 bg-gold/5 p-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-lg text-foreground">Your measurements (inches)</p>
            <HowToMeasure url={sizeChartUrl} />
          </div>

          <MeasureGroup
            label="Body measurements"
            fields={BODY_FIELDS}
            measures={measures}
            setMeasures={setMeasures}
            attemptedAdd={attemptedAdd}
          />
          <MeasureGroup
            label="Garment measurements"
            fields={GARMENT_FIELDS}
            measures={measures}
            setMeasures={setMeasures}
            attemptedAdd={attemptedAdd}
          />

          {/* Summary */}
          <div className="rounded-lg border border-gold/30 bg-card/60 p-3 text-sm">
            <p className="mb-2 flex items-center justify-between font-medium text-foreground">
              <span>Measurement summary</span>
              {allMeasuresValid ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check className="h-3.5 w-3.5" /> Complete
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Incomplete</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {MEASURE_FIELDS.map((f) => (
                <div key={f} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{f}</span>
                  <span className="font-medium text-foreground">
                    {isValidMeasure(measures[f]) ? `${Number(measures[f])}"` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Our tailors will craft your kurti to these exact measurements. Custom-size items are
            made to order.
          </p>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="w-full cursor-not-allowed"
          >
            Save measurements — available after account integration
          </Button>
        </div>
      )}
    </div>
  );
}

function MeasureGroup({
  label,
  fields,
  measures,
  setMeasures,
  attemptedAdd,
}: {
  label: string;
  fields: string[];
  measures: Record<string, string>;
  setMeasures: (m: Record<string, string>) => void;
  attemptedAdd: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label} <span className="text-destructive">*</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => {
          const invalid = attemptedAdd && !isValidMeasure(measures[f]);
          const errId = `err-${f.replace(/\s+/g, "-")}`;
          return (
            <div key={f} className="space-y-1">
              <Label htmlFor={`m-${f}`} className="text-xs text-muted-foreground">
                {f} (in)
              </Label>
              <Input
                id={`m-${f}`}
                type="number"
                min="0.1"
                step="0.1"
                inputMode="decimal"
                placeholder="0.0"
                value={measures[f] ?? ""}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errId : undefined}
                onChange={(e) => setMeasures({ ...measures, [f]: e.target.value })}
                className={cn(
                  "bg-background",
                  invalid && "border-destructive focus-visible:ring-destructive",
                )}
              />
              {invalid && (
                <p id={errId} className="text-[0.7rem] text-destructive">
                  Enter a value greater than 0.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HowToMeasure({ url }: { url: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0 text-gold">
          <Ruler className="mr-1 h-4 w-4" /> How to measure
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">How to measure</DialogTitle>
        </DialogHeader>
        <img src={url} alt="Kurti measurement guide" className="w-full rounded-lg" />
        <p className="text-sm text-muted-foreground">
          Measure over a well-fitting garment and round up to the nearest half inch. Need help?
          Message us on WhatsApp.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({ code }: { code: string }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rating || !text.trim()) {
      toast.error("Please add your name, a rating and a review");
      return;
    }
    setSubmitting(true);
    const res = await submitReview({
      data: { code, authorName: name.trim(), rating, body: text.trim() },
    });
    setSubmitting(false);
    if (res.success) {
      toast.success("Thanks! Your review was submitted and is awaiting approval.");
      setName("");
      setRating(0);
      setHover(0);
      setText("");
      setDone(true);
    } else {
      toast.error(res.error);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-border bg-secondary/40 p-5"
    >
      <h3 className="font-display text-xl text-foreground">Write a review</h3>
      {done && (
        <p className="flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <Check className="h-4 w-4" /> Your review was submitted and will appear once approved.
          Thank you!
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Your name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tahmina A."
            className="bg-background"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Your rating</Label>
          <div className="flex items-center gap-1 pt-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                aria-label={`${i} star${i > 1 ? "s" : ""}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(i)}
              >
                <Star
                  className={cn(
                    "h-6 w-6 transition-colors",
                    i <= (hover || rating)
                      ? "fill-gold text-gold"
                      : "fill-muted text-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Your review</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share your experience with this product…"
          className="bg-background"
          rows={3}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        You must be signed in to review. Submitted reviews are published after approval.
      </p>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit review"}
      </Button>
    </form>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
