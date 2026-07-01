import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getMyOrderFn } from "@/lib/orders.api";
import { CustomerStatusBadge, fmtDate } from "@/components/admin/order-status";
import { MeasurementsList } from "@/components/orders/MeasurementsList";
import { CUSTOMER_STEPS, customerProgress, type MyOrderDetail } from "@/lib/orders-shared";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import {
  MapPin,
  MessageCircle,
  Check,
  AlertTriangle,
  PackageSearch,
  PackageOpen,
} from "lucide-react";

export const Route = createFileRoute("/_site/orders/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Order · Nongorr` },
      { name: "description", content: "Order details for your Nongorr purchase." },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: `/orders/${params.id}` }],
  }),
  component: OrderDetails,
});

const UUID_RE = /^[0-9a-f-]{36}$/i;

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; order: MyOrderDetail }
  | { phase: "missing"; needsAuth: boolean };

function NotFoundPanel({ needsAuth }: { needsAuth: boolean }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <EmptyState
        icon={<PackageSearch className="h-6 w-6" />}
        title={needsAuth ? "Sign in to view this order" : "Order not found"}
        description={
          needsAuth
            ? "This order is tied to an account. Sign in to view it, or track a guest order with its tracking code."
            : "We couldn't find this order on your account."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {needsAuth && (
              <Button asChild>
                <Link to="/login" search={{ next: "/orders" }}>
                  Sign in
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/orders">My Orders</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/track">Track an order</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}

function OrderDetails() {
  const { id } = Route.useParams();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let live = true;
    setState({ phase: "loading" });
    if (!UUID_RE.test(id)) {
      setState({ phase: "missing", needsAuth: false });
      return;
    }
    void getMyOrderFn({ data: { orderId: id } })
      .then((res) => {
        if (!live) return;
        if (res.success) setState({ phase: "ready", order: res.order });
        else setState({ phase: "missing", needsAuth: /sign in/i.test(res.error ?? "") });
      })
      .catch(() => live && setState({ phase: "missing", needsAuth: false }));
    return () => {
      live = false;
    };
  }, [id]);

  if (state.phase === "loading") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (state.phase === "missing") return <NotFoundPanel needsAuth={state.needsAuth} />;

  const { order, items, payment } = state.order;
  const { stepIndex, exception } = customerProgress(order.status);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-foreground">{order.orderNo}</h1>
          <p className="mt-1 text-xs text-muted-foreground">Placed on {fmtDate(order.placedAt)}</p>
        </div>
        <CustomerStatusBadge status={order.status} />
      </div>

      {/* Items */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Items</h2>
        <div className="mt-4 space-y-4">
          {items.map((i, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex gap-3">
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
                <span className="text-sm font-medium">{formatBDT(i.lineTotal)}</span>
              </div>
              <MeasurementsList measurements={i.customMeasurements} />
            </div>
          ))}
        </div>

        <Separator className="my-4" />
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatBDT(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="text-gold">− {formatBDT(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shipping</span>
            <span>{order.shippingFee === 0 ? "Free" : formatBDT(order.shippingFee)}</span>
          </div>
        </div>
        <Separator className="my-4" />
        <div className="flex justify-between">
          <span className="font-display text-lg">Total</span>
          <span className="font-display text-xl text-primary">{formatBDT(order.total)}</span>
        </div>
      </div>

      {/* Address + payment */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h3 className="mb-2 font-display text-lg">Delivery address</h3>
          <p className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {[order.shipAddress, order.shipArea, order.shipDistrict].filter(Boolean).join(", ")}
          </p>
          <p className="mt-1 text-xs capitalize text-muted-foreground">Zone: {order.shipZone}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h3 className="mb-2 font-display text-lg">Payment</h3>
          <p className="capitalize text-muted-foreground">
            {order.paymentMethod}
            {payment ? ` · ${payment.status}` : ""}
          </p>
          {payment?.trxId && (
            <p className="mt-1">
              TrxID: <strong className="font-mono">{payment.trxId}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
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

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button variant="outline" asChild>
          <Link to="/orders">Back to My Orders</Link>
        </Button>
        <Button variant="ghost" asChild>
          <a
            href={`https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
              `Hi Nongorr! I need help with my order ${order.orderNo}.`,
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle className="h-4 w-4" /> Support
          </a>
        </Button>
      </div>
    </div>
  );
}
