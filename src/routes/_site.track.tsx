import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trackOrderFn } from "@/lib/orders.api";
import { CustomerStatusBadge, fmtDate, fmtDateTime } from "@/components/admin/order-status";
import { MeasurementsList } from "@/components/orders/MeasurementsList";
import { ClaimOrderCard } from "@/components/orders/ClaimOrderCard";
import { OrderItemThumb } from "@/components/orders/OrderItemThumb";
import {
  CUSTOMER_STEPS,
  ORDER_STATUS_META,
  customerProgress,
  courierProviderLabel,
  courierTrackingUrl,
  orderReadReasonMessage,
  type TrackOrderResult,
} from "@/lib/orders-shared";
import { paymentMethodLabel } from "@/lib/checkout-shared";
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
  Check,
  AlertTriangle,
  Truck,
  ExternalLink,
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
  | { phase: "missing" }
  | { phase: "error"; message: string };

function Track() {
  const { o = "", t = "" } = Route.useSearch();
  const navigate = useNavigate();
  const { sessionSummary } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { isAuthenticated: boolean };
  };
  const [orderNo, setOrderNo] = useState(o);
  const [token, setToken] = useState(t);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [fieldErrors, setFieldErrors] = useState<{ orderNo?: string; token?: string }>({});
  const [retry, setRetry] = useState(0);
  const orderNoRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

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
        if (res.success && res.result) {
          setState({ phase: "ready", result: res.result });
        } else if (res.success) {
          // Reached the server but no order matched the capability pair.
          setState({ phase: "missing" });
        } else if (res.reason === "not_found") {
          // Wrong number/token → non-oracular "not found" (never reveals whether
          // some other customer's order exists).
          setState({ phase: "missing" });
        } else {
          // A genuine failure (rate limit, bad origin, backend outage) is NOT a
          // "not found" — surface the real, distinct reason with a retry (#6).
          setState({
            phase: "error",
            message: orderReadReasonMessage(res.reason ?? "unavailable"),
          });
        }
      })
      .catch(
        () => live && setState({ phase: "error", message: orderReadReasonMessage("network") }),
      );
    return () => {
      live = false;
    };
  }, [o, t, retry]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const no = orderNo.trim();
    const tok = token.trim();
    // Both fields are required to form a valid capability pair.
    const errs: { orderNo?: string; token?: string } = {};
    if (!no) errs.orderNo = "Enter your order number.";
    if (!tok) errs.token = "Enter your tracking code.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      (errs.orderNo ? orderNoRef : tokenRef).current?.focus();
      return;
    }
    navigate({ to: "/track", search: { o: no, t: tok }, replace: true });
  };

  const clear = () => {
    setOrderNo("");
    setToken("");
    setFieldErrors({});
    navigate({ to: "/track", search: {}, replace: true });
  };

  // Concise status for the screen-reader live region.
  const liveMessage =
    state.phase === "loading"
      ? "Looking up your order…"
      : state.phase === "ready"
        ? "Order found."
        : state.phase === "missing"
          ? "No order found for those details."
          : state.phase === "error"
            ? state.message
            : "";

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

      <form onSubmit={onSubmit} noValidate className="mb-10 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="track-order-no" className="sr-only">
            Order number
          </label>
          <Input
            id="track-order-no"
            ref={orderNoRef}
            value={orderNo}
            onChange={(e) => {
              setOrderNo(e.target.value);
              if (fieldErrors.orderNo) setFieldErrors((f) => ({ ...f, orderNo: undefined }));
            }}
            placeholder="Order number (NGR-100231)"
            className={cn("bg-card", fieldErrors.orderNo && "border-destructive")}
            aria-label="Order number"
            aria-invalid={fieldErrors.orderNo ? true : undefined}
            aria-describedby={fieldErrors.orderNo ? "track-order-no-error" : undefined}
          />
          {fieldErrors.orderNo && (
            <p id="track-order-no-error" className="mt-1 text-xs text-destructive">
              {fieldErrors.orderNo}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="track-token" className="sr-only">
            Tracking code
          </label>
          <Input
            id="track-token"
            ref={tokenRef}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              if (fieldErrors.token) setFieldErrors((f) => ({ ...f, token: undefined }));
            }}
            placeholder="Tracking code"
            className={cn("bg-card font-mono", fieldErrors.token && "border-destructive")}
            aria-label="Tracking code"
            aria-invalid={fieldErrors.token ? true : undefined}
            aria-describedby={fieldErrors.token ? "track-token-error" : undefined}
          />
          {fieldErrors.token && (
            <p id="track-token-error" className="mt-1 text-xs text-destructive">
              {fieldErrors.token}
            </p>
          )}
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

      {/* Screen-reader status announcements for loading / results / errors. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {state.phase === "loading" ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : state.phase === "ready" ? (
        <div className="space-y-6">
          {/* A valid tracked order is still guest-owned — offer to claim it.
              After the claim the token is dead, so leave straight for the
              account's own order page. */}
          <ClaimOrderCard
            orderNo={o}
            token={t}
            signedIn={sessionSummary.isAuthenticated}
            onClaimed={(r) => navigate({ to: "/orders/$id", params: { id: r.orderId } })}
          />
          <OrderTimeline result={state.result} orderNo={o} token={t} />
        </div>
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
      ) : state.phase === "error" ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="We couldn't check that right now"
          description={state.message}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setRetry((n) => n + 1)}>Try again</Button>
              <Button variant="outline" asChild>
                <a href={`https://wa.me/${BRAND.whatsapp}`} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" /> Get help on WhatsApp
                </a>
              </Button>
            </div>
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
  const { order, items, history, courier } = result;
  const { stepIndex, exception } = customerProgress(order.status);
  const trackingUrl = courier ? courierTrackingUrl(courier) : null;

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
            <div key={idx} className="space-y-2">
              <div className="flex gap-3">
                <OrderItemThumb image={i.image} name={i.name} className="h-20 w-16" />
                <div className="flex-1 text-sm">
                  {i.productSlug ? (
                    <Link
                      to="/product/$slug"
                      params={{ slug: i.productSlug }}
                      className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
                    >
                      {i.name}
                    </Link>
                  ) : (
                    <p className="font-medium text-foreground">{i.name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {i.qty} × {formatBDT(i.unitPrice)}
                    {i.variantSize ? ` · ${i.variantSize}` : ""}
                  </p>
                  {i.sku && (
                    <p className="text-xs text-muted-foreground">
                      SKU: <span className="font-mono">{i.sku}</span>
                    </p>
                  )}
                </div>
                <span className="text-sm font-medium">{formatBDT(i.unitPrice * i.qty)}</span>
              </div>
              <MeasurementsList measurements={i.customMeasurements} />
            </div>
          ))}
        </div>
        <Separator className="my-4" />
        <div className="flex justify-between">
          <span className="font-display text-lg">Total</span>
          <span className="font-display text-xl text-primary">{formatBDT(order.total)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Payment: {paymentMethodLabel(order.paymentMethod)}
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

        {/* Real, timestamped status history (#8). */}
        {history.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Status history</h3>
            <ol className="space-y-2">
              {history.map((h, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground">
                    {ORDER_STATUS_META[h.toStatus]?.customerLabel ?? h.toStatus}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDateTime(h.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Courier / shipment (#8) */}
      {courier && (
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl">
            <Truck className="h-5 w-5 text-primary" /> Courier
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="text-muted-foreground">
              Provider:{" "}
              <span className="text-foreground">{courierProviderLabel(courier.provider)}</span>
            </p>
            {courier.courierStatus && (
              <p className="capitalize text-muted-foreground">
                Status:{" "}
                <span className="text-foreground">{courier.courierStatus.replace(/_/g, " ")}</span>
              </p>
            )}
            {courier.trackingCode && (
              <p className="text-muted-foreground">
                Tracking code:{" "}
                <span className="font-mono text-foreground">{courier.trackingCode}</span>
              </p>
            )}
            {courier.consignmentId && (
              <p className="text-muted-foreground">
                Consignment:{" "}
                <span className="font-mono text-foreground">{courier.consignmentId}</span>
              </p>
            )}
            {courier.bookedAt && (
              <p className="text-muted-foreground">
                Booked: <span className="text-foreground">{fmtDateTime(courier.bookedAt)}</span>
              </p>
            )}
          </div>
          {trackingUrl && (
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <a href={trackingUrl} target="_blank" rel="noreferrer">
                Track with {courierProviderLabel(courier.provider)}{" "}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      )}

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
