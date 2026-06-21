import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Copy,
  Truck,
  MessageCircle,
  MapPin,
  Phone,
  User,
  Check,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  readLastStoredOrder,
  CUSTOMER_ORDER_STEPS,
  customerStepIndex,
  isExceptionStatus,
  type UIOrder,
} from "@/lib/order-ui";

export const Route = createFileRoute("/_site/order-success")({
  head: () => ({
    meta: [
      { title: "Order Confirmed · Nongorr" },
      {
        name: "description",
        content:
          "Your Nongorr order has been received. We'll verify your bKash payment and confirm shortly.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/order-success" }],
  }),
  component: OrderSuccess,
});

const PAYMENT_TONE: Record<UIOrder["paymentStatus"], string> = {
  Pending: "border-gold/40 bg-gold/20 text-gold-foreground",
  Verified: "border-success/30 bg-success/15 text-success",
  Rejected: "border-destructive/30 bg-destructive/10 text-destructive",
};

function OrderSuccess() {
  const [hydrated, setHydrated] = useState(false);
  const [order, setOrder] = useState<UIOrder | null>(null);

  useEffect(() => {
    setOrder(readLastStoredOrder());
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-14 sm:px-6">
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        <Skeleton className="mx-auto h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (!order) return <NoOrderFallback />;

  // Fall back to a safe local status if missing.
  const status = order.status || "Payment Pending";
  const stepIdx = customerStepIndex(status);
  const exception = isExceptionStatus(status);

  const waText = `Hi Nongorr! 🛍️ My order ${order.id} is placed. Amount: ${formatBDT(order.total)}. bKash TrxID: ${order.trxId}. Please confirm! 💕`;
  const waLink = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(waText)}`;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(order.id);
      toast.success("Order ID copied");
    } catch {
      toast.error("Could not copy the order ID");
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
          <span className="font-display text-lg text-foreground">Order {order.id}</span>
          <Button variant="outline" size="sm" onClick={copyId}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Badge variant="outline" className={cn(PAYMENT_TONE[order.paymentStatus])}>
            Payment {order.paymentStatus}
          </Badge>
        </div>
      </div>

      {/* Delivery */}
      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Delivery to</h2>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <User className="h-4 w-4" /> {order.customerName || "—"}
          </p>
          <p className="flex items-center gap-2">
            <Phone className="h-4 w-4" /> {order.phone || "—"}
          </p>
          {(order.address || order.locality || order.district) && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />{" "}
              {[order.address, order.locality, order.district].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Items + totals */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Order summary</h2>
        <div className="mt-4 space-y-3">
          {order.items.map((i, idx) => (
            <div key={idx} className="flex gap-3">
              <img
                src={i.image}
                alt={i.name}
                loading="lazy"
                className="h-16 w-14 rounded object-cover"
              />
              <div className="flex-1 text-sm">
                <p className="line-clamp-1 font-medium text-foreground">{i.name}</p>
                <p className="text-xs text-muted-foreground">
                  Qty {i.qty}
                  {i.size ? ` · ${i.size}` : ""}
                </p>
              </div>
              <span className="text-sm font-medium">
                {formatBDT((i.price + (i.customCharge ?? 0)) * i.qty)}
              </span>
            </div>
          ))}
        </div>
        <Separator className="my-4" />
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatBDT(order.subtotal)}</span>
          </div>
          {order.discount > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="text-gold">− {formatBDT(order.discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Delivery</span>
            <span>{order.shipping === 0 ? "Free" : formatBDT(order.shipping)}</span>
          </div>
        </div>
        <Separator className="my-4" />
        <div className="flex justify-between">
          <span className="font-display text-lg">Total</span>
          <span className="font-display text-xl text-primary">{formatBDT(order.total)}</span>
        </div>
      </div>

      {/* Payment */}
      <div className="mt-6 rounded-xl border border-gold/40 bg-gold/5 p-6">
        <h2 className="font-display text-xl text-foreground">Payment</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Method: <span className="font-medium text-foreground">bKash</span>
        </p>
        {order.trxId ? (
          <div className="mt-2 rounded-lg border border-border bg-background p-3 text-sm">
            <p className="text-xs text-muted-foreground">Transaction ID</p>
            <p className="font-mono text-base text-foreground">{order.trxId}</p>
          </div>
        ) : null}
      </div>

      {/* Timeline / next steps */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">What happens next</h2>
        {exception ? (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Order status: {status}</p>
              <p className="mt-1 text-muted-foreground">
                This order is no longer in normal fulfilment. Please contact support for details.
              </p>
            </div>
          </div>
        ) : (
          <ol className="mt-4 space-y-5">
            {CUSTOMER_ORDER_STEPS.map((step, i) => {
              const done = i < stepIdx;
              const current = i === stepIdx;
              return (
                <li key={step} className="flex items-start gap-4">
                  <div className="relative flex flex-col items-center">
                    <div
                      className={cn(
                        "grid h-9 w-9 place-items-center rounded-full border-2",
                        done && "border-primary bg-primary text-primary-foreground",
                        current && "border-primary bg-primary/10 text-primary",
                        !done && !current && "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {done ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <span className="text-xs font-semibold">{i + 1}</span>
                      )}
                    </div>
                    {i < CUSTOMER_ORDER_STEPS.length - 1 && (
                      <div className={cn("h-7 w-0.5", done ? "bg-primary" : "bg-border")} />
                    )}
                  </div>
                  <div className="pt-1.5">
                    <p
                      className={cn(
                        "font-medium",
                        done || current ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {step}
                    </p>
                    {current && <p className="text-xs text-primary">Current status</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        <Button asChild>
          <Link to="/track" search={{ id: order.id } as never}>
            <Truck className="h-4 w-4" /> Track Your Order
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <a href={waLink} target="_blank" rel="noreferrer">
            <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
          </a>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/shop">Continue Shopping</Link>
        </Button>
      </div>
    </div>
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
