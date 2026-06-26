import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { STATUS_TONE } from "@/lib/orders";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import {
  Search,
  Copy,
  MessageCircle,
  PackageSearch,
  Package,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  readStoredOrders,
  buildOrderList,
  normalizeBDPhone,
  isValidBDPhone,
  CUSTOMER_ORDER_STEPS,
  customerStepIndex,
  isExceptionStatus,
  orderScope,
  type UIOrder,
} from "@/lib/order-ui";

export const Route = createFileRoute("/_site/track")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => {
    const id = typeof s.id === "string" ? s.id : "";
    return id ? { id } : {};
  },
  head: () => ({
    meta: [
      { title: "Track Order · Nongorr" },
      {
        name: "description",
        content:
          "Track your Nongorr order. Enter your order ID or phone number to view the latest status saved in this demo or on this device.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/track" }],
  }),
  component: Track,
});

function Track() {
  const { id = "" } = Route.useSearch();
  const navigate = useNavigate();
  const { sessionSummary } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { userId: string | null };
  };
  const scope = orderScope(sessionSummary.userId);
  const [input, setInput] = useState(id);
  const [submittedQuery, setSubmittedQuery] = useState(id);
  const [device, setDevice] = useState<UIOrder[]>([]);

  useEffect(() => {
    setDevice(readStoredOrders(scope));
  }, [scope]);

  // Keep in sync if the URL search param changes externally.
  useEffect(() => {
    setInput(id);
    setSubmittedQuery(id);
  }, [id]);

  const allOrders = useMemo(() => buildOrderList(device), [device]);

  const term = submittedQuery.trim();
  const { single, list } = useMemo(() => {
    if (!term) return { single: undefined as UIOrder | undefined, list: [] as UIOrder[] };
    const upper = term.toUpperCase();
    const byId = allOrders.find((o) => o.id.toUpperCase() === upper);
    if (byId) return { single: byId, list: [] as UIOrder[] };

    if (isValidBDPhone(term)) {
      const phone = normalizeBDPhone(term);
      const matches = allOrders.filter((o) => normalizeBDPhone(o.phone) === phone);
      if (matches.length === 1) return { single: matches[0], list: [] as UIOrder[] };
      return { single: undefined, list: matches };
    }
    return { single: undefined, list: [] as UIOrder[] };
  }, [term, allOrders]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    setSubmittedQuery(trimmed);
    navigate({ to: "/track", search: trimmed ? { id: trimmed } : {}, replace: true });
  };

  const clear = () => {
    setInput("");
    setSubmittedQuery("");
    navigate({ to: "/track", search: {}, replace: true });
  };

  const hasResult = single || list.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-display text-4xl text-foreground">Track Your Order</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Enter your order ID or phone number to view the latest status saved in this demo or on this
        device.
      </p>

      <form onSubmit={onSubmit} className="mb-10 flex gap-2">
        <div className="relative flex-1">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Order ID (NGR-100231) or phone (01711223344)"
            className="bg-card pr-9"
            aria-label="Order ID or phone number"
          />
          {input && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="submit">
          <Search className="h-4 w-4" /> Track
        </Button>
      </form>

      {single ? (
        <OrderTimeline order={single} />
      ) : list.length > 0 ? (
        <PhoneResults orders={list} />
      ) : term ? (
        <EmptyState
          icon={<PackageSearch className="h-6 w-6" />}
          title="Order not found"
          description="Double-check your order ID or the phone number used at checkout."
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
          title="Enter an order ID or phone"
          description="Try NGR-100231, NGR-100245 or NGR-100250."
        />
      )}

      {!hasResult && null}
    </div>
  );
}

function PhoneResults({ orders }: { orders: UIOrder[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {orders.length} orders found for this phone number.
      </p>
      {orders.map((o) => (
        <div
          key={o.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5"
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="font-display text-lg text-foreground">{o.id}</p>
              <SourceBadge source={o.source} />
            </div>
            <p className="text-xs text-muted-foreground">
              {o.date || "—"} · {formatBDT(o.total)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn(STATUS_TONE[o.status] ?? "")}>
              {o.status}
            </Badge>
            <Button variant="outline" size="sm" asChild>
              <Link to="/track" search={{ id: o.id }}>
                Track
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/orders/$id" params={{ id: o.id }}>
                View Details
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: UIOrder["source"] }) {
  return source === "demo" ? (
    <Badge variant="outline" className="border-border text-muted-foreground">
      Demo order
    </Badge>
  ) : (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
      Saved on this device
    </Badge>
  );
}

function OrderTimeline({ order }: { order: UIOrder }) {
  const stepIdx = customerStepIndex(order.status);
  const exception = isExceptionStatus(order.status);

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/track?id=${order.id}`;
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
          <div className="flex items-center gap-2">
            <p className="font-display text-xl text-foreground">{order.id}</p>
            <SourceBadge source={order.source} />
          </div>
          <p className="text-xs text-muted-foreground">
            {order.customerName}
            {order.date ? ` · ${order.date}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn(STATUS_TONE[order.status] ?? "")}>
            {order.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={copyLink}>
            <Copy className="h-4 w-4" /> Copy link
          </Button>
        </div>
      </div>

      {exception ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Order status: {order.status}</p>
            <p className="mt-1 text-muted-foreground">
              This order is outside normal delivery. Contact support for help.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6">
          <ol className="space-y-5">
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
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h3 className="mb-2 font-display text-lg">Delivery</h3>
          <p className="text-muted-foreground">
            {order.address}
            {order.district ? `, ${order.district}` : ""}
          </p>
          <p className="mt-2">
            Courier: <strong>{order.courier ?? "To be assigned"}</strong>
          </p>
          <p>
            Tracking ID: <strong>{order.trackingId ?? "Pending"}</strong>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Estimated delivery: Placeholder only</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h3 className="mb-2 font-display text-lg">Payment</h3>
          <p className="text-muted-foreground">Manual bKash · {order.paymentStatus}</p>
          {order.trxId && (
            <p>
              TrxID: <strong className="font-mono">{order.trxId}</strong>
            </p>
          )}
          <p className="mt-2 font-semibold text-primary">{formatBDT(order.total)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gold/40 bg-gold/5 p-5 text-center">
        <p className="text-sm text-muted-foreground">Need help with this order?</p>
        <Button className="mt-3" asChild>
          <a
            href={`https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hi Nongorr! I need help with my order ${order.id}.`)}`}
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
