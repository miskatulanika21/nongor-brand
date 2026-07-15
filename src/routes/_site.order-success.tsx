import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ClaimOrderCard } from "@/components/orders/ClaimOrderCard";
import { MeasurementsList } from "@/components/orders/MeasurementsList";
import { OrderItemThumb } from "@/components/orders/OrderItemThumb";
import { CustomerStatusBadge } from "@/components/admin/order-status";
import { paymentMethodLabel } from "@/lib/checkout-shared";
import { getMyOrderFn, trackOrderFn } from "@/lib/orders.api";
import type {
  CustomMeasurements,
  MyOrderDetail,
  OrderStatus,
  TrackOrderResult,
} from "@/lib/orders-shared";
import { Copy, Truck, MessageCircle, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_site/order-success")({
  head: () => ({
    meta: [
      { title: "Order Confirmed · Nongorr" },
      {
        name: "description",
        content:
          "Your Nongorr order has been received. We'll verify your payment and confirm shortly.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/order-success" }],
  }),
  // The URL carries a CAPABILITY only (order id/no + guest token). Every value
  // shown on the page is fetched + verified server-side from that capability —
  // the query string is never trusted for display (#3/#4).
  validateSearch: (search: Record<string, unknown>) => ({
    order_id: typeof search.order_id === "string" ? search.order_id : undefined,
    order_no: typeof search.order_no === "string" ? search.order_no : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: OrderSuccess,
});

/** Normalised, server-verified receipt shared by the guest + signed-in paths. */
interface Receipt {
  orderId: string | null;
  orderNo: string;
  status: OrderStatus;
  total: number;
  paymentMethod: string;
  items: Array<{
    name: string;
    image: string | null;
    qty: number;
    variantSize: string | null;
    customMeasurements: CustomMeasurements | null;
  }>;
  // Richer breakdown only available on the signed-in (owner) path.
  breakdown?: { subtotal: number; discount: number; shippingFee: number };
  ship?: { address: string; area: string | null; district: string; zone: string };
}

function fromTrack(r: TrackOrderResult, orderId: string | null): Receipt {
  return {
    orderId,
    orderNo: r.order.orderNo,
    status: r.order.status,
    total: r.order.total,
    paymentMethod: r.order.paymentMethod,
    items: r.items.map((i) => ({
      name: i.name,
      image: i.image,
      qty: i.qty,
      variantSize: i.variantSize,
      customMeasurements: i.customMeasurements,
    })),
  };
}

function fromMyOrder(o: MyOrderDetail): Receipt {
  return {
    orderId: o.order.id,
    orderNo: o.order.orderNo,
    status: o.order.status,
    total: o.order.total,
    paymentMethod: o.order.paymentMethod,
    items: o.items.map((i) => ({
      name: i.name,
      image: i.image,
      qty: i.qty,
      variantSize: i.variantSize,
      customMeasurements: i.customMeasurements,
    })),
    breakdown: {
      subtotal: o.order.subtotal,
      discount: o.order.discount,
      shippingFee: o.order.shippingFee,
    },
    ship: {
      address: o.order.shipAddress,
      area: o.order.shipArea,
      district: o.order.shipDistrict,
      zone: o.order.shipZone,
    },
  };
}

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; receipt: Receipt; guestToken: string | null }
  | { phase: "invalid" };

function OrderSuccess() {
  const { order_id, order_no, token } = Route.useSearch();
  const { sessionSummary } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { isAuthenticated: boolean };
  };
  const signedIn = sessionSummary.isAuthenticated;
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let live = true;

    async function load() {
      // 1) Guest capability first (order_no + token → track_order).
      if (order_no && token) {
        try {
          const res = await trackOrderFn({ data: { orderNo: order_no, token } });
          if (!live) return;
          if (res.success && res.result) {
            setState({
              phase: "ready",
              receipt: fromTrack(res.result, order_id ?? null),
              guestToken: token,
            });
            return;
          }
          // Not a hard failure — fall through to the owner-scoped attempt. This
          // is the post-claim case: claiming invalidates the guest token, but an
          // authenticated owner can still load the order by its id (#7).
        } catch {
          /* fall through to the owner-scoped attempt */
        }
      }

      // 2) Owner-scoped fallback (authenticated + order_id → get_my_order). Only
      // ever returns the caller's OWN order; a non-owner id yields not-found, so
      // this never exposes another customer's order.
      if (signedIn && order_id) {
        try {
          const res = await getMyOrderFn({ data: { orderId: order_id } });
          if (!live) return;
          if (res.success && res.order) {
            setState({ phase: "ready", receipt: fromMyOrder(res.order), guestToken: null });
            return;
          }
        } catch {
          /* fall through to invalid */
        }
      }

      if (live) setState({ phase: "invalid" });
    }

    setState({ phase: "loading" });
    void load();
    return () => {
      live = false;
    };
  }, [order_id, order_no, token, signedIn]);

  if (state.phase === "loading") return <LoadingReceipt />;
  if (state.phase === "invalid") return <NoOrderFallback />;
  return (
    <ServerOrderSuccess
      receipt={state.receipt}
      initialGuestToken={state.guestToken}
      signedIn={signedIn}
    />
  );
}

function LoadingReceipt() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-14 sm:px-6">
      <Skeleton className="mx-auto h-24 w-24 rounded-full" />
      <Skeleton className="mx-auto h-8 w-3/4" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

function ServerOrderSuccess({
  receipt,
  initialGuestToken,
  signedIn,
}: {
  receipt: Receipt;
  initialGuestToken: string | null;
  signedIn: boolean;
}) {
  const isCod = receipt.paymentMethod === "cod";

  // Claiming consumes the capability token (the RPC clears its hash). Capture
  // the real order id the claim returns so the "View order" link is correct.
  const [claimedOrderId, setClaimedOrderId] = useState<string | null>(null);
  const guestToken = claimedOrderId ? null : initialGuestToken;
  const viewOrderId = claimedOrderId ?? receipt.orderId;

  const waText = `Hi Nongorr! 🛍️ My order ${receipt.orderNo} is placed. Please confirm! 💕`;
  const waLink = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(waText)}`;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(receipt.orderNo);
      toast.success("Order number copied");
    } catch {
      toast.error("Could not copy the order number");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <div className="flex flex-col items-center text-center">
        <div className="success-pop grid h-24 w-24 place-items-center rounded-full bg-success/15">
          <svg viewBox="0 0 52 52" className="h-14 w-14 text-success">
            <circle
              className="check-circle"
              cx="26"
              cy="26"
              r="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="check-mark"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 27l8 8 16-16"
            />
          </svg>
        </div>
        <h1 className="mt-6 font-display text-3xl text-foreground sm:text-4xl">
          Order Placed Successfully! 🎉
        </h1>
        <p className="mt-2 text-muted-foreground">Thank you for shopping with Nongorr 💕</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <span className="font-display text-lg text-foreground">{receipt.orderNo}</span>
          <Button variant="outline" size="sm" onClick={copyId}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <CustomerStatusBadge status={receipt.status} />
        </div>
      </div>

      {/* Verified order summary — items + totals from the server, not the URL */}
      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Your order</h2>
        <div className="mt-4 space-y-4">
          {receipt.items.map((i, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex gap-3">
                <OrderItemThumb image={i.image} name={i.name} className="h-20 w-16" />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-foreground">{i.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Qty {i.qty}
                    {i.variantSize ? ` · ${i.variantSize}` : ""}
                  </p>
                </div>
              </div>
              <MeasurementsList measurements={i.customMeasurements} />
            </div>
          ))}
        </div>

        <Separator className="my-4" />
        {receipt.breakdown ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatBDT(receipt.breakdown.subtotal)}</span>
            </div>
            {receipt.breakdown.discount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-gold">− {formatBDT(receipt.breakdown.discount)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery</span>
              <span>
                {receipt.breakdown.shippingFee === 0
                  ? "Free"
                  : formatBDT(receipt.breakdown.shippingFee)}
              </span>
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between">
          <span className="font-display text-lg">Total</span>
          <span className="font-display text-xl text-primary">{formatBDT(receipt.total)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Payment: {paymentMethodLabel(receipt.paymentMethod)}
        </p>
        {receipt.ship && (
          <p className="mt-1 text-xs text-muted-foreground">
            Delivery to{" "}
            {[receipt.ship.address, receipt.ship.area, receipt.ship.district]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
      </div>

      {/* What happens next */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">What happens next</h2>
        <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
          {isCod ? (
            <>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>
                  Your order has been placed. We&apos;ll confirm and schedule delivery shortly.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                  2
                </span>
                <span>Our courier will collect the payment when your order is delivered.</span>
              </li>
            </>
          ) : (
            <>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>Your order has been submitted.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary text-xs font-medium text-primary">
                  2
                </span>
                <span>
                  We&apos;ll verify your payment and confirm the order — usually within a few hours.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                  3
                </span>
                <span>Once confirmed, we&apos;ll prepare and ship your order.</span>
              </li>
            </>
          )}
        </ol>
      </div>

      {/* Guest tracking link — surface the capability so guests can return later */}
      {guestToken && (
        <div className="mt-6 rounded-xl border border-gold/40 bg-gold/5 p-5 text-sm">
          <p className="font-medium text-foreground">Save your tracking link</p>
          <p className="mt-1 text-muted-foreground">
            You&apos;re checking out as a guest. Bookmark the link below to track this order later —
            it&apos;s the only way to find it without an account.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" asChild>
              <Link to="/track" search={{ o: receipt.orderNo, t: guestToken }}>
                <Truck className="h-4 w-4" /> Track Your Order
              </Link>
            </Button>
            <CopyTrackLink orderNo={receipt.orderNo} token={guestToken} />
          </div>
        </div>
      )}

      {/* Claim — turn the guest capability into a permanent account order */}
      {guestToken && (
        <div className="mt-6">
          <ClaimOrderCard
            orderNo={receipt.orderNo}
            token={guestToken}
            signedIn={signedIn}
            onClaimed={(r) => setClaimedOrderId(r.orderId)}
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        {!guestToken && viewOrderId ? (
          <>
            <Button asChild>
              <Link to="/orders/$id" params={{ id: viewOrderId }}>
                <Truck className="h-4 w-4" /> View Your Order
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={waLink} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
              </a>
            </Button>
          </>
        ) : (
          <Button variant="outline" asChild>
            <a href={waLink} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
            </a>
          </Button>
        )}
        <Button variant="ghost" asChild>
          <Link to="/shop">Continue Shopping</Link>
        </Button>
      </div>
    </div>
  );
}

function CopyTrackLink({ orderNo, token }: { orderNo: string; token: string }) {
  const copy = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/track?o=${encodeURIComponent(orderNo)}&t=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Tracking link copied");
    } catch {
      toast.error("Could not copy the tracking link");
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      <Copy className="h-4 w-4" /> Copy tracking link
    </Button>
  );
}

function NoOrderFallback() {
  const waLink = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
    "Hi Nongorr! I just placed an order but my device could not load the summary. Can you help?",
  )}`;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gold/15">
        <AlertTriangle className="h-10 w-10 text-gold-foreground" />
      </div>
      <h1 className="mt-6 font-display text-2xl text-foreground sm:text-3xl">
        We couldn&apos;t load your order summary
      </h1>
      <p className="mt-3 text-muted-foreground">
        This link may be incomplete or expired. If you just placed an order, track it with your
        order number and tracking code, or reach us on WhatsApp.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link to="/track">
            <Truck className="h-4 w-4" /> Track Order
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <a href={waLink} target="_blank" rel="noreferrer">
            <MessageCircle className="h-4 w-4" /> Contact on WhatsApp
          </a>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/shop">Continue Shopping</Link>
        </Button>
      </div>
    </div>
  );
}
