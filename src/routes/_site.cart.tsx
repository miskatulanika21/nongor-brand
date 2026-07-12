import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type CartItem } from "@/lib/store";
import { formatBDT } from "@/lib/brand";
import { PRODUCT_TYPE_LABEL, type Product } from "@/lib/products";
import { cartToQuoteLines, couponReasonMessage, type QuoteResult } from "@/lib/checkout-shared";
import { quoteOrderFn } from "@/lib/checkout.api";
import { listProductCards } from "@/lib/catalog.api";
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  Minus,
  Plus,
  ShoppingBag,
  ArrowRight,
  Tag,
  X,
  Truck,
  Bookmark,
  Pencil,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DELIVERY_ZONES,
  FREE_DELIVERY_THRESHOLD,
  computeShipping,
  freeDeliveryRemaining,
  type DeliveryZone,
} from "@/lib/checkout-ui";

export const Route = createFileRoute("/_site/cart")({
  head: () => ({
    meta: [
      { title: "Your Bag · Nongorr" },
      {
        name: "description",
        content:
          "Review your Nongorr bag, adjust quantities and proceed to secure bKash checkout with custom-size tailoring options.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/cart" }],
  }),
  loader: () => listProductCards(),
  component: Cart,
});

function sizeTypeLabel(item: CartItem) {
  if (item.customSize) return "Custom measurements";
  if (item.size) return "Ready size";
  return "One size / No size selection";
}

function Cart() {
  const allProducts = Route.useLoaderData();
  const {
    cart,
    updateQty,
    removeFromCart,
    cartSubtotal,
    deliveryZone,
    setDeliveryZone,
    couponCode,
    applyCoupon,
    removeCoupon,
    orderNote,
    setOrderNote,
    savedForLater,
    saveForLater,
    moveToCart,
    removeSavedItem,
  } = useStore();

  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const confirm = useConfirm();

  // ── Server reconciliation ──────────────────────────────────────────────
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  /** Per-item warnings keyed by `code:size`. */
  const [itemWarnings, setItemWarnings] = useState<Map<string, string>>(new Map());

  const reconcile = useCallback(async () => {
    const lines = cartToQuoteLines(cart);
    if (lines.length === 0) return;
    setReconciling(true);
    setQuoteError(null);
    try {
      const result = await quoteOrderFn({
        data: { lines, zone: deliveryZone, coupon: couponCode ?? undefined },
      });
      if (!result.success) {
        setQuoteError(result.error);
      } else {
        setQuote(result.quote);
        const warnings = new Map<string, string>();
        for (const line of result.quote.lines) {
          const key = `${line.code}:${line.size ?? ""}`;
          if (!line.found) {
            warnings.set(key, "This item is no longer available.");
          } else if (!line.visible) {
            warnings.set(key, "This item has been removed from the store.");
          } else if (line.custom || line.available == null) {
            // Made-to-order (custom) lines carry available = null: unlimited, no
            // ready-stock gate, so they never trigger a stock warning.
          } else if (line.available < line.qty) {
            if (line.available === 0) {
              warnings.set(key, "Out of stock.");
            } else {
              warnings.set(key, `Only ${line.available} left in stock.`);
              // Auto-correct qty
              const cartItem = cart.find(
                (c) => c.productId === line.code && (c.size ?? "") === (line.size ?? ""),
              );
              if (cartItem && cartItem.qty > line.available) {
                updateQty(cartItem.id, line.available);
                toast.info(
                  `${cartItem.name}: quantity adjusted to ${line.available} (max available).`,
                );
              }
            }
          }
        }
        setItemWarnings(warnings);
      }
    } catch {
      // Non-critical — client-side totals remain usable
      setQuoteError("Could not verify prices right now.");
    } finally {
      setReconciling(false);
    }
  }, [cart, deliveryZone, couponCode, updateQty]);

  useEffect(() => {
    reconcile();
  }, [reconcile]);

  // Discount + coupon status are server truth (from the quote). Until the first
  // quote resolves we show no discount rather than a phantom one.
  const couponStatus = quote?.coupon ?? null;
  const couponApplied = couponStatus?.applied === true;
  const discount = quote?.discount ?? 0;

  const clientShipping = computeShipping(deliveryZone, cartSubtotal);
  const shipping = quote?.shipping_fee ?? clientShipping;
  const total = quote?.total ?? Math.max(0, cartSubtotal - discount) + shipping;
  const freeDelivery = cartSubtotal >= FREE_DELIVERY_THRESHOLD;
  const remaining = freeDeliveryRemaining(cartSubtotal);
  const progress = Math.min(100, (cartSubtotal / FREE_DELIVERY_THRESHOLD) * 100);
  const serverSubtotal = quote?.subtotal ?? null;

  const completeTheLook = useMemo(() => {
    if (!cart.length) return [];
    const first = allProducts.find((p) => p.id === cart[0].productId);
    if (!first) return [];
    const inCart = new Set(cart.map((c) => c.productId));
    const seen = new Set<string>();
    return allProducts
      .filter((p) => p.type === first.type && p.id !== first.id)
      .filter((p) => !inCart.has(p.id) && !seen.has(p.id) && seen.add(p.id))
      .slice(0, 4);
  }, [cart, allProducts]);

  function handleApplyCoupon() {
    // The store only records the code; the server (re-quote) decides if it
    // applies. Feedback surfaces from quote.coupon once the quote resolves.
    if (applyCoupon(couponInput)) {
      setCouponError(null);
      setCouponInput("");
    } else {
      setCouponError("Enter a coupon code.");
    }
  }

  function requestRemove(item: CartItem) {
    if (!item.customSize) {
      removeFromCart(item.id);
      return;
    }
    void confirm({
      tone: "danger",
      title: "Remove this custom-size item?",
      description: `Removing “${item.name}” will also delete the custom measurements you entered for it. This can't be undone.`,
      confirmText: "Remove",
      cancelText: "Keep item",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: () => removeFromCart(item.id),
    });
  }

  if (!cart.length && !savedForLater.length) {
    const suggestions = allProducts.slice(0, 4);
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-primary">
            <ShoppingBag className="h-9 w-9" />
          </div>
          <h1 className="mt-6 font-display text-3xl text-foreground sm:text-4xl">
            Your bag is empty
          </h1>
          <p className="mt-2 max-w-md text-muted-foreground">
            Discover beautiful pieces crafted just for you — handloom kurtis, sarees and more.
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link to="/shop">
              Start shopping <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-16">
          <h2 className="mb-6 text-center font-display text-2xl text-foreground">You might like</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {suggestions.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="mb-8 font-display text-4xl text-foreground">Your Bag</h1>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {/* Free-delivery progress */}
          {cart.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              {freeDelivery ? (
                <p className="flex items-center gap-2 text-sm font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" /> You've unlocked free delivery!
                </p>
              ) : (
                <p className="text-sm text-foreground">
                  Add <span className="font-semibold text-primary">{formatBDT(remaining)}</span>{" "}
                  more to unlock free delivery.
                </p>
              )}
              <Progress value={progress} className="mt-2 h-2" />
            </div>
          )}

          {cart.map((item) => {
            const product = allProducts.find((p) => p.id === item.productId);
            const category = product ? PRODUCT_TYPE_LABEL[product.type] : null;
            return (
              <div key={item.id} className="flex gap-4 rounded-xl border border-border bg-card p-4">
                <img
                  src={item.image}
                  alt={item.name}
                  loading="lazy"
                  className="h-28 w-24 shrink-0 rounded-lg object-cover"
                />
                <div className="flex flex-1 flex-col">
                  <div className="flex justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg leading-snug text-foreground">
                        {item.name}
                      </h3>
                      {category && <p className="text-xs text-muted-foreground">{category}</p>}
                    </div>
                    <button
                      onClick={() => requestRemove(item)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {sizeTypeLabel(item)}
                    {item.size ? `: ${item.size}` : ""}{" "}
                    {item.size && (
                      <Link
                        to="/size-guide"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Size Guide
                      </Link>
                    )}
                  </p>

                  {item.customSize && (
                    <Collapsible className="mt-1">
                      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-gold">
                        Custom measurements <ChevronDown className="h-3 w-3" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 text-xs text-muted-foreground">
                        {Object.entries(item.customSize)
                          .map(([k, v]) => `${k} ${v}"`)
                          .join(", ")}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Server reconciliation warning */}
                  {(() => {
                    const warnKey = `${item.productId}:${item.size ?? ""}`;
                    const warning = itemWarnings.get(warnKey);
                    return warning ? (
                      <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                        <AlertTriangle className="h-3 w-3 shrink-0" /> {warning}
                      </p>
                    ) : null;
                  })()}

                  {item.customCharge ? (
                    <p className="text-xs text-muted-foreground">
                      + custom charge {formatBDT(item.customCharge)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Unit price {formatBDT(item.price + (item.customCharge ?? 0))}
                  </p>

                  <div className="mt-auto flex items-center justify-between pt-2">
                    <div className="flex items-center rounded-lg border border-border">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Decrease quantity"
                        onClick={() => updateQty(item.id, item.qty - 1)}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-8 text-center text-sm">{item.qty}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Increase quantity"
                        onClick={() => updateQty(item.id, item.qty + 1)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className="font-semibold text-primary">
                      {formatBDT((item.price + (item.customCharge ?? 0)) * item.qty)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {product ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/product/$slug" params={{ slug: product.slug }}>
                          <Pencil className="h-3.5 w-3.5" /> Edit Options
                        </Link>
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        <Pencil className="h-3.5 w-3.5" /> Edit Options
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => saveForLater(item.id)}>
                      <Bookmark className="h-3.5 w-3.5" /> Save for Later
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Saved for later */}
          {savedForLater.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-display text-lg text-foreground">
                Saved for later{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (stays in this browser)
                </span>
              </h2>
              <div className="mt-3 space-y-3">
                {savedForLater.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <img
                      src={item.image}
                      alt={item.name}
                      loading="lazy"
                      className="h-16 w-14 shrink-0 rounded object-cover"
                    />
                    <div className="flex flex-1 flex-col text-sm">
                      <p className="font-medium text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {sizeTypeLabel(item)}
                        {item.size ? `: ${item.size}` : ""} · Qty {item.qty}
                      </p>
                      <div className="mt-1 flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => moveToCart(item.id)}>
                          Move to bag
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => removeSavedItem(item.id)}>
                          <X className="h-3.5 w-3.5" /> Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Order note */}
          {cart.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <label htmlFor="order-note" className="font-display text-base text-foreground">
                Order note{" "}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="order-note"
                value={orderNote}
                maxLength={200}
                onChange={(e) => setOrderNote(e.target.value.slice(0, 200))}
                placeholder="Gift note, colour preference, or any special instruction…"
                className="mt-2 bg-background"
                rows={3}
              />
              <div className="mt-1 text-right text-xs text-muted-foreground">
                {orderNote.length}/200
              </div>
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="site-sticky-with-gap h-fit space-y-4 rounded-xl border border-border bg-card p-6 lg:sticky">
            <h2 className="font-display text-2xl text-foreground">Order Summary</h2>

            {/* Coupon (server-validated via the quote) */}
            <div className="space-y-2">
              {couponApplied ? (
                <div className="flex items-center justify-between rounded-lg border border-gold/40 bg-gold/10 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Tag className="h-4 w-4 text-gold" /> {couponStatus!.code}
                    {couponStatus!.type === "free_shipping"
                      ? " · Free delivery"
                      : ` · − ${formatBDT(couponStatus!.amount ?? discount)}`}
                  </span>
                  <button
                    onClick={removeCoupon}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove coupon"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  {couponCode && couponStatus && !couponStatus.applied && (
                    <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
                      <span className="text-xs text-destructive">
                        {couponCode}: {couponReasonMessage(couponStatus.reason)}
                      </span>
                      <button
                        onClick={removeCoupon}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove coupon"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {couponCode && !couponStatus && reconciling && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Checking {couponCode}…
                    </p>
                  )}
                  {couponCode && !couponStatus && !reconciling && quoteError && (
                    <div className="flex items-center justify-between rounded-lg border border-gold/40 bg-gold/5 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        {couponCode}: couldn't verify right now — it will be re-checked at checkout.
                      </span>
                      <button
                        onClick={removeCoupon}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove coupon"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Coupon code"
                      className="bg-background"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value);
                        setCouponError(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleApplyCoupon()}
                    />
                    <Button variant="outline" onClick={handleApplyCoupon}>
                      Apply
                    </Button>
                  </div>
                  {couponError && <p className="text-xs text-destructive">{couponError}</p>}
                </>
              )}
            </div>

            {/* Zone-based shipping */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Truck className="h-4 w-4" /> Deliver to
              </label>
              <Select
                value={deliveryZone}
                onValueChange={(v) => setDeliveryZone(v as DeliveryZone)}
              >
                <SelectTrigger className="bg-background" aria-label="Delivery zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_ZONES.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label} · {formatBDT(d.fee)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {freeDelivery
                  ? "🎉 You've unlocked free delivery!"
                  : `Free delivery on orders over ${formatBDT(FREE_DELIVERY_THRESHOLD)}.`}
              </p>
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <Row
                label="Subtotal"
                value={formatBDT(serverSubtotal ?? cartSubtotal)}
                suffix={
                  reconciling ? (
                    <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground" />
                  ) : quote ? (
                    <span className="text-xs text-success">✓</span>
                  ) : null
                }
              />
              {discount > 0 && (
                <Row
                  label={`Discount${couponStatus?.code ? ` (${couponStatus.code})` : ""}`}
                  value={`− ${formatBDT(discount)}`}
                  accent
                />
              )}
              <Row label="Delivery" value={shipping === 0 ? "Free" : formatBDT(shipping)} />
            </div>
            <Separator />
            <Row label="Total" value={formatBDT(total)} big />

            <Button size="lg" className="w-full" asChild>
              <Link to="/checkout">
                Checkout <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="ghost" className="w-full" asChild>
              <Link to="/shop">Continue shopping</Link>
            </Button>
          </div>
        )}
      </div>

      {/* Complete the Look */}
      {completeTheLook.length > 0 && <CompleteTheLook items={completeTheLook} />}
    </div>
  );
}

function CompleteTheLook({ items }: { items: Product[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    updateBounds();
    const onResize = () => updateBounds();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [items]);

  function updateBounds() {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 4;
    setOverflow(hasOverflow);
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }

  function scrollBy(dir: number) {
    scrollRef.current?.scrollBy({ left: dir * 240, behavior: "smooth" });
  }

  return (
    <div className="mt-16">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl text-foreground">Complete the Look</h2>
        <div className="hidden gap-2 sm:flex">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            disabled={!overflow || atStart}
            onClick={() => scrollBy(-1)}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            disabled={!overflow || atEnd}
            onClick={() => scrollBy(1)}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={updateBounds}
        className="pdp-snap-row -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      >
        {items.map((p) => (
          <div key={p.id} className="w-44 shrink-0 snap-start sm:w-52">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
      <p className="mt-1 text-center text-xs text-muted-foreground sm:hidden">
        Swipe to see more →
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  big,
  accent,
  suffix,
}: {
  label: string;
  value: string;
  big?: boolean;
  accent?: boolean;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={big ? "font-display text-lg text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span
        className={
          big
            ? "font-display text-xl text-primary"
            : accent
              ? "font-medium text-gold"
              : "font-medium text-foreground"
        }
      >
        {value}
        {suffix && <span className="ml-1">{suffix}</span>}
      </span>
    </div>
  );
}
