import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { listMyOrdersFn } from "@/lib/orders.api";
import { CustomerStatusBadge, fmtDate } from "@/components/admin/order-status";
import {
  ORDER_STATUS_META,
  orderReadReasonMessage,
  type OrderReadReason,
} from "@/lib/orders-shared";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { OrderItemThumb } from "@/components/orders/OrderItemThumb";
import { Eye, MessageCircle, PackageSearch, Search } from "lucide-react";

export const Route = createFileRoute("/_site/orders/")({
  head: () => ({
    meta: [
      { title: "My Orders · Nongorr" },
      {
        name: "description",
        content: "View your Nongorr order history, track deliveries and check payment status.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/orders" }],
  }),
  // Identity-gated server read. A failure carries a distinct reason (#6): only an
  // `unauthenticated` reason means "sign in" — a backend/network failure must NOT
  // masquerade as signed-out, or a signed-in customer is wrongly told to log in.
  loader: async () => {
    try {
      const res = await listMyOrdersFn({ data: { limit: 50 } });
      if (res.success)
        return { orders: res.orders, total: res.total, ok: true as const, reason: null };
      return {
        orders: [],
        total: 0,
        ok: false as const,
        reason: (res.reason ?? "unavailable") as OrderReadReason,
      };
    } catch {
      return { orders: [], total: 0, ok: false as const, reason: "network" as OrderReadReason };
    }
  },
  component: Orders,
});

function Orders() {
  const { orders, total, ok, reason } = Route.useLoaderData();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const statuses = useMemo(() => Array.from(new Set(orders.map((o) => o.status))), [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (q) {
        const matchNo = o.orderNo.toLowerCase().includes(q);
        const matchItem = (o.firstItem?.name ?? "").toLowerCase().includes(q);
        if (!matchNo && !matchItem) return false;
      }
      return true;
    });
  }, [orders, search, statusFilter]);

  const hasFilters = search.trim() !== "" || statusFilter !== "all";

  if (!ok && reason === "unauthenticated") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="mb-2 font-display text-4xl text-foreground">My Orders</h1>
        <EmptyState
          icon={<PackageSearch className="h-6 w-6" />}
          title="Sign in to see your orders"
          description="Your order history is tied to your account. Placed an order as a guest? Track it with your order number and tracking code."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/login" search={{ next: "/orders" }}>
                  Sign in
                </Link>
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

  // A backend/network failure is NOT a signed-out state — offer a retry, never a
  // misleading "sign in" prompt (#6).
  if (!ok) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6" role="alert">
        <h1 className="mb-2 font-display text-4xl text-foreground">My Orders</h1>
        <EmptyState
          icon={<PackageSearch className="h-6 w-6" />}
          title="We couldn't load your orders"
          description={orderReadReasonMessage(reason)}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => router.invalidate()}>Retry</Button>
              <Button variant="outline" asChild>
                <Link to="/track">Track an order</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-display text-4xl text-foreground">My Orders</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Your recent orders with Nongorr.
        {total > orders.length && (
          <>
            {" "}
            Showing your latest {orders.length} of {total} orders — older orders can be found with
            their tracking link.
          </>
        )}
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order number or product"
            className="bg-card pl-9"
            aria-label="Search orders"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full bg-card sm:w-52" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_META[s]?.customerLabel ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-6 w-6" />}
          title={orders.length === 0 ? "No orders yet" : "No orders match your filters"}
          description={
            orders.length === 0
              ? "When you place an order it will appear here."
              : "Try clearing the search or status filter."
          }
          action={
            <Button asChild>
              <Link to="/shop">Shop</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((o) => (
            <div key={o.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg text-foreground">{o.orderNo}</p>
                  <p className="text-xs text-muted-foreground">Placed on {fmtDate(o.placedAt)}</p>
                </div>
                <CustomerStatusBadge status={o.status} />
              </div>

              {o.firstItem && (
                <div className="my-4 flex items-center gap-3">
                  <OrderItemThumb
                    image={o.firstItem.image}
                    name={o.firstItem.name}
                    className="h-16 w-14"
                  />
                  <p className="line-clamp-2 text-sm text-foreground">
                    {o.firstItem.name}
                    {o.itemCount > 1 && (
                      <span className="text-muted-foreground"> +{o.itemCount - 1} more</span>
                    )}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {o.itemCount} {o.itemCount === 1 ? "item" : "items"} ·{" "}
                  <span className="font-semibold text-primary">{formatBDT(o.total)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/orders/$id" params={{ id: o.id }}>
                      <Eye className="h-4 w-4" /> Details
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href={`https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
                        `Hi Nongorr! I need help with my order ${o.orderNo}.`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" /> Support
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
