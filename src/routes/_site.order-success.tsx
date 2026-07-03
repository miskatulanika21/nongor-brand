import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClaimOrderCard } from "@/components/orders/ClaimOrderCard";
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
  validateSearch: (search: Record<string, unknown>) => ({
    order_id: (search.order_id as string) ?? undefined,
    order_no: (search.order_no as string) ?? undefined,
    status: (search.status as string) ?? undefined,
    total: search.total ? Number(search.total) : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: OrderSuccess,
});

function OrderSuccess() {
  const search = Route.useSearch();

  // Orders are created server-side at checkout, which redirects here with the
  // order in the URL (P3b). A bare /order-success visit has nothing to show.
  const serverOrder = search.order_id
    ? {
        id: search.order_no ?? search.order_id,
        orderId: search.order_id,
        orderNo: search.order_no ?? search.order_id,
        status: search.status ?? "pending_confirmation",
        total: search.total ?? 0,
        token: search.token ?? null,
      }
    : null;

  if (!serverOrder) return <NoOrderFallback />;
  return <ServerOrderSuccess serverOrder={serverOrder} />;
}

/** Status labels for server order statuses. */
const SERVER_STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Pending Confirmation",
  pending_payment: "Pending Payment Verification",
  confirmed: "Confirmed",
};

function ServerOrderSuccess({
  serverOrder,
}: {
  serverOrder: {
    id: string;
    orderId: string;
    orderNo: string;
    status: string;
    total: number;
    token: string | null;
  };
}) {
  const statusLabel = SERVER_STATUS_LABEL[serverOrder.status] ?? serverOrder.status;
  const isCod = serverOrder.status === "pending_confirmation";

  const { sessionSummary } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { isAuthenticated: boolean };
  };
  // Claiming consumes the capability token (the RPC clears its hash), so once
  // claimed this page renders exactly like a signed-in order: account actions,
  // no guest tracking-link card.
  const [claimed, setClaimed] = useState(false);
  const guestToken = claimed ? null : serverOrder.token;

  const waText = `Hi Nongorr! 🛍️ My order ${serverOrder.orderNo} is placed. Please confirm! 💕`;
  const waLink = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(waText)}`;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(serverOrder.orderNo);
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
          <span className="font-display text-lg text-foreground">{serverOrder.orderNo}</span>
          <Button variant="outline" size="sm" onClick={copyId}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Badge
            variant="outline"
            className={
              isCod
                ? "border-success/30 bg-success/15 text-success"
                : "border-gold/40 bg-gold/20 text-gold-foreground"
            }
          >
            {statusLabel}
          </Badge>
        </div>
      </div>

      {/* Total */}
      {serverOrder.total > 0 && (
        <div className="mt-8 rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Order Total</p>
          <p className="font-display text-2xl text-primary">{formatBDT(serverOrder.total)}</p>
        </div>
      )}

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
              <Link to="/track" search={{ o: serverOrder.orderNo, t: guestToken }}>
                <Truck className="h-4 w-4" /> Track Your Order
              </Link>
            </Button>
            <CopyTrackLink orderNo={serverOrder.orderNo} token={guestToken} />
          </div>
        </div>
      )}

      {/* Claim — turn the guest capability into a permanent account order */}
      {guestToken && (
        <div className="mt-6">
          <ClaimOrderCard
            orderNo={serverOrder.orderNo}
            token={guestToken}
            signedIn={sessionSummary.isAuthenticated}
            onClaimed={() => setClaimed(true)}
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        {guestToken ? (
          <Button variant="outline" asChild>
            <a href={waLink} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
            </a>
          </Button>
        ) : (
          <>
            <Button asChild>
              <Link to="/orders/$id" params={{ id: serverOrder.orderId }}>
                <Truck className="h-4 w-4" /> View Your Order
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={waLink} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
              </a>
            </Button>
          </>
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
      <div className="grid h-20 w-20 place-items-center rounded-full bg-gold/15 mx-auto">
        <AlertTriangle className="h-10 w-10 text-gold-foreground" />
      </div>
      <h1 className="mt-6 font-display text-2xl text-foreground sm:text-3xl">
        We couldn&apos;t load your order summary
      </h1>
      <p className="mt-3 text-muted-foreground">
        Your order may have been submitted, but this device could not load the order summary.
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
