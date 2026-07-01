import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trackOrderFn } from "@/lib/orders.api";
import { CustomerStatusBadge, fmtDate } from "@/components/admin/order-status";
import { CUSTOMER_STEPS, customerProgress, type TrackOrderResult } from "@/lib/orders-shared";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import {
  Search,
  Copy,
  MessageCircle,
  PackageSearch,
  Package,
  PackageOpen,
  Check,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_site/track")({
  validateSearch: (s: Record<string, unknown>): { o?: string; t?: string } => {
    const o = typeof s.o === "string" ? s.o.trim() : "";
    const t = typeof s.t === "string" ? s.t.trim() : "";
    return { ...(o ? { o } : {}), ...(t ? { t } : {}) };
  },
  head: () => ({
    meta: [
      { title: "Track Order · Nongorr" },
      {
        name: "description",
        content:
          "Track your Nongorr order with your order number and tracking code. Signed-in customers can also view orders from their account.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/track" }],
  }),
  component: Track,
});

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; result: TrackOrderResult }
  | { phase: "missing" };

function Track() {
  const { o = "", t = "" } = Route.useSearch();
  const navigate = useNavigate();
  const [orderNo, setOrderNo] = useState(o);
  const [token, setToken] = useState(t);
  const [state, setState] = useState<State>({ phase: "idle" });

  // Keep the inputs in sync when the URL search params change externally
  // (e.g. arriving via a capability tracking link).
  useEffect(() => {
    setOrderNo(o);
    setToken(t);
  }, [o, t]);

  // Fetch whenever the URL carries both an order number and a tracking code.
  useEffect(() => {
    if (!o || !t) {
      setState({ phase: "idle" });
      return;
    }
    let live = true;
    setState({ phase: "loading" });
    void trackOrderFn({ data: { orderNo: o, token: t } })
      .then((res) => {
        if (!live) return;
        if (res.success && res.result) setState({ phase: "ready", result: res.result });
        else setState({ phase: "missing" });
      })
      .catch(() => live && setState({ phase: "missing" }));
    return () => {
      live = false;
    };
  }, [o, t]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const no = orderNo.trim();
    const tok = token.trim();
    navigate({
      to: "/track",
      search: { ...(no ? { o: no } : {}), ...(tok ? { t: tok } : {}) },
      replace: true,
    });
  };

  const clear = () => {
    setOrderNo("");
    setToken("");
    navigate({ to: "/track", search: {}, replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-display text-4xl text-foreground">Track Your Order</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Enter your order number and the tracking code from your confirmation. Have an account?{" "}
        <Link to="/orders" className="text-primary underline-offset-4 hover:underline">
          View all your orders
        </Link>
        .
      </p>

      <form onSubmit={onSubmit} className="mb-10 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="track-order-no" className="sr-only">
            Order number
          </label>
          <Input
            id="track-order-no"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder="Order number (NGR-100231)"
            className="bg-card"
            aria-label="Order number"
          />
        </div>
        <div>
          <label htmlFor="track-token" className="sr-only">
            Tracking code
          </label>
          <Input
            id="track-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Tracking code"
            className="bg-card font-mono"
            aria-label="Tracking code"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            <Search className="h-4 w-4" /> Track
          </Button>
          {(orderNo || token) && (
            <Button type="button" variant="outline" onClick={clear} aria-label="Clear">
              Clear
            </Button>
          )}
        </div>
      </form>

      {state.phase === "loading" ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : state.phase === "ready" ? (
        <OrderTimeline result={state.result} orderNo={o} token={t} />
      ) : state.phase === "missing" ? (
        <EmptyState
          icon={<PackageSearch className="h-6 w-6" />}
          title="Order not found"
          description="Double-check your order number and tracking code, or paste the tracking link from your confirmation."
          action={
            <Button variant="outline" asChild>
              <a href={`https://wa.me/${BRAND.whatsapp}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" /> Get help on WhatsApp
              </a>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title="Enter your order details"
          description="Your order number and tracking code are on your order confirmation page."
        />
      )}
    </div>
  );
}

function OrderTimeline({
  result,
  orderNo,
  token,
}: {
  result: TrackOrderResult;
  orderNo: string;
  token: string;
}) {
  const { order, items } = result;
  const { stepIndex, exception } = customerProgress(order.status);

  const copyLink = async () => {
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5">
        <div>
          <p className="font-display text-xl text-foreground">{order.orderNo}</p>
          <p className="mt-1 text-xs text-muted-foreground">Placed on {fmtDate(order.placedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <CustomerStatusBadge status={order.status} />
          <Button variant="outline" size="sm" onClick={copyLink}>
            <Copy className="h-4 w-4" /> Copy link
          </Button>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Items</h2>
        <div className="mt-4 space-y-4">
          {items.map((i, idx) => (
            <div key={idx} className="flex gap-3">
              {i.image ? (
                <img
                  src={i.image}
                  alt={i.name}
                  loading="lazy"
                  className="h-20 w-16 rounded object-cover"
                />
              ) : (
                <div className="grid h-20 w-16 place-items-center rounded bg-muted text-muted-foreground">
                  <PackageOpen className="h-5 w-5" />
                </div>
              )}
              <div className="flex-1 text-sm">
                <p className="font-medium text-foreground">{i.name}</p>
                <p className="text-xs text-muted-foreground">
                  Qty {i.qty}
                  {i.variantSize ? ` · ${i.variantSize}` : ""}
                </p>
              </div>
              <span className="text-sm font-medium">{formatBDT(i.unitPrice * i.qty)}</span>
            </div>
          ))}
        </div>
        <Separator className="my-4" />
        <div className="flex justify-between">
          <span className="font-display text-lg">Total</span>
          <span className="font-display text-xl text-primary">{formatBDT(order.total)}</span>
        </div>
        <p className="mt-2 text-xs capitalize text-muted-foreground">
          Payment: {order.paymentMethod}
        </p>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Order status</h2>
        {exception ? (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">
                Status: <CustomerStatusBadge status={order.status} />
              </p>
              <p className="mt-1 text-muted-foreground">
                This order is outside the normal delivery flow. Contact support for details.
              </p>
            </div>
          </div>
        ) : (
          <ol className="mt-4 space-y-5">
            {CUSTOMER_STEPS.map((step, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
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
                    {i < CUSTOMER_STEPS.length - 1 && (
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

      <div className="rounded-xl border border-gold/40 bg-gold/5 p-5 text-center">
        <p className="text-sm text-muted-foreground">Need help with this order?</p>
        <Button className="mt-3" asChild>
          <a
            href={`https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hi Nongorr! I need help with my order ${order.orderNo}.`)}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle className="h-4 w-4" /> Chat with support
          </a>
        </Button>
      </div>
    </div>
  );
}
