import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ORDERS, STATUS_TONE } from "@/lib/orders";
import { formatBDT, BRAND } from "@/lib/brand";
import { useStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import {
  MapPin,
  MessageCircle,
  Truck,
  FileText,
  RotateCcw,
  Check,
  AlertTriangle,
  PackageSearch,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  readStoredOrders,
  normalizeSeedOrder,
  reorderItems,
  CUSTOMER_ORDER_STEPS,
  customerStepIndex,
  isExceptionStatus,
  measurementLabel,
  measurementValue,
  type UIOrder,
} from "@/lib/order-ui";

export const Route = createFileRoute("/_site/orders/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Order ${params.id} · Nongorr` },
      { name: "description", content: "Order details for your Nongorr purchase." },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: `/orders/${params.id}` }],
  }),
  component: OrderDetails,
  errorComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Something went wrong"
        description="We couldn't load this order. Please try again."
        action={
          <Button asChild>
            <Link to="/orders">Back to My Orders</Link>
          </Button>
        }
      />
    </div>
  ),
  notFoundComponent: () => <NotFoundPanel />,
});

function NotFoundPanel() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <EmptyState
        icon={<PackageSearch className="h-6 w-6" />}
        title="Order not found"
        description="We couldn't find this order in the demo records or on this device."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/orders">My Orders</Link>
            </Button>
            <Button asChild>
              <Link to="/track">Track an Order</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}

function OrderDetails() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { addToCart } = useStore();
  const [hydrated, setHydrated] = useState(false);
  const [device, setDevice] = useState<UIOrder[]>([]);
  const [reordering, setReordering] = useState(false);

  // Seed orders resolve immediately (available without the browser).
  const seedOrder = useMemo(() => {
    const found = ORDERS.find((o) => o.id.toUpperCase() === id.toUpperCase());
    return found ? normalizeSeedOrder(found) : null;
  }, [id]);

  useEffect(() => {
    setDevice(readStoredOrders());
    setHydrated(true);
  }, []);

  // Device order overrides seed with the same id.
  const order = useMemo(() => {
    const deviceMatch = device.find((o) => o.id.toUpperCase() === id.toUpperCase());
    return deviceMatch ?? seedOrder;
  }, [device, seedOrder, id]);

  // Wait for hydration before declaring not-found for local orders.
  if (!order) {
    if (!hydrated && !seedOrder) {
      return (
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-12 sm:px-6">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      );
    }
    return <NotFoundPanel />;
  }

  const stepIdx = customerStepIndex(order.status);
  const exception = isExceptionStatus(order.status);

  const baseSubtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  const customCharges = order.items.reduce((s, i) => s + (i.customCharge ?? 0) * i.qty, 0);

  const handleReorder = () => {
    if (reordering) return;
    setReordering(true);
    const { added, skipped } = reorderItems(order, addToCart);
    setReordering(false);
    if (added === 0) {
      toast.error("None of these items could be reordered right now.");
      return;
    }
    const parts = [`${added} item${added === 1 ? "" : "s"} added using current prices.`];
    if (skipped > 0) parts.push(`${skipped} unavailable item${skipped === 1 ? "" : "s"} skipped.`);
    toast.success(parts.join(" "), {
      action: { label: "View Cart", onClick: () => navigate({ to: "/cart" }) },
    });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-3xl text-foreground">{order.id}</h1>
            {order.source === "demo" ? (
              <Badge variant="outline" className="border-border text-muted-foreground">
                Demo order
              </Badge>
            ) : (
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                Saved on this device
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Placed on {order.date || "—"}</p>
        </div>
        <Badge variant="outline" className={cn(STATUS_TONE[order.status] ?? "")}>
          {order.status}
        </Badge>
      </div>

      {/* Items */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Items</h2>
        <div className="mt-4 space-y-4">
          {order.items.map((i, idx) => {
            const measures = i.customSize ? Object.entries(i.customSize) : [];
            return (
              <div key={idx} className="flex gap-3">
                <img
                  src={i.image}
                  alt={i.name}
                  loading="lazy"
                  className="h-20 w-16 rounded object-cover"
                />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-foreground">{i.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Qty {i.qty}
                    {i.size ? ` · Size ${i.size}` : ""}
                  </p>
                  {i.customCharge != null && i.customCharge > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Custom-size charge: {formatBDT(i.customCharge)} / unit
                    </p>
                  )}
                  {measures.length > 0 && (
                    <div className="mt-2 rounded-lg border border-border bg-background p-2">
                      <p className="mb-1 text-xs font-medium text-foreground">
                        Custom measurements
                      </p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {measures.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <dt>{measurementLabel(k)}</dt>
                            <dd className="text-foreground">{measurementValue(String(v))}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
                <span className="text-sm font-medium">
                  {formatBDT((i.price + (i.customCharge ?? 0)) * i.qty)}
                </span>
              </div>
            );
          })}
        </div>

        <Separator className="my-4" />
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Products subtotal</span>
            <span>{formatBDT(baseSubtotal)}</span>
          </div>
          {customCharges > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Custom-size charges</span>
              <span>{formatBDT(customCharges)}</span>
            </div>
          )}
          {order.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Discount{order.couponCode ? ` (${order.couponCode})` : ""}
              </span>
              <span className="text-gold">− {formatBDT(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shipping</span>
            <span>{order.shipping === 0 ? "Free" : formatBDT(order.shipping)}</span>
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
          <p className="font-medium text-foreground">{order.customerName || "—"}</p>
          <p className="text-muted-foreground">{order.phone || "—"}</p>
          <p className="mt-1 flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {[order.address, order.locality, order.district].filter(Boolean).join(", ") || "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h3 className="mb-2 font-display text-lg">Payment</h3>
          <p className="text-muted-foreground">
            Manual bKash · <span className="text-foreground">{order.paymentStatus}</span>
          </p>
          {order.trxId && (
            <p className="mt-1">
              TrxID: <strong className="font-mono">{order.trxId}</strong>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Courier: {order.courier ?? "To be assigned"}
          </p>
          <p className="text-xs text-muted-foreground">
            Tracking ID: {order.trackingId ?? "Pending"}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-xl text-foreground">Order status</h2>
        {exception ? (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Order status: {order.status}</p>
              <p className="mt-1 text-muted-foreground">
                This order is outside normal delivery. Contact support for details.
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
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button onClick={handleReorder} disabled={reordering}>
          {reordering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}{" "}
          Reorder
        </Button>
        <Button variant="outline" asChild>
          <Link to="/track" search={{ id: order.id }}>
            <Truck className="h-4 w-4" /> Track
          </Link>
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">
              <FileText className="h-4 w-4" /> Invoice preview
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invoice preview — UI only</DialogTitle>
              <DialogDescription>
                Downloadable invoices are coming later. This is a preview of order {order.id} for{" "}
                {formatBDT(order.total)}.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-border bg-background p-4 text-sm">
              <p className="font-medium text-foreground">{BRAND.name}</p>
              <p className="text-muted-foreground">
                Order {order.id} · {order.date || "—"}
              </p>
              <Separator className="my-3" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-primary">{formatBDT(order.total)}</span>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <Button variant="ghost" asChild>
          <a
            href={`https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hi Nongorr! I need help with my order ${order.id}.`)}`}
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
