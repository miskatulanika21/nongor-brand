import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { STATUS_TONE } from "@/lib/orders";
import { formatBDT, BRAND } from "@/lib/brand";
import { useStore } from "@/lib/store";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";
import { Search, Truck, MessageCircle, RotateCcw, Eye, PackageSearch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  readStoredOrders,
  buildOrderList,
  normalizeBDPhone,
  reorderItems,
  type UIOrder,
} from "@/lib/order-ui";

export const Route = createFileRoute("/_site/orders")({
  head: () => ({
    meta: [
      { title: "My Orders · Nongorr" },
      {
        name: "description",
        content:
          "View your Nongorr order history saved in this demo or on this device, track deliveries and check payment status.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/orders" }],
  }),
  component: Orders,
});

type DateFilter = "all" | "7" | "30";

function Orders() {
  const navigate = useNavigate();
  const { addToCart } = useStore();
  const [hydrated, setHydrated] = useState(false);
  const [device, setDevice] = useState<UIOrder[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [reordering, setReordering] = useState<string | null>(null);

  useEffect(() => {
    setDevice(readStoredOrders());
    setHydrated(true);
  }, []);

  const orders = useMemo(() => buildOrderList(device), [device]);

  const statuses = useMemo(() => {
    const set = new Set(orders.map((o) => o.status));
    return Array.from(set);
  }, [orders]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    const qPhone = normalizeBDPhone(search);
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      if (dateFilter !== "all") {
        const t = Date.parse(o.date);
        if (!Number.isFinite(t)) return false;
        const days = Number(dateFilter);
        if (now - t > days * 24 * 60 * 60 * 1000) return false;
      }

      if (q) {
        const matchId = o.id.toLowerCase().includes(q);
        const matchPhone = qPhone.length >= 4 && normalizeBDPhone(o.phone).includes(qPhone);
        const matchProduct = o.items.some((i) => i.name.toLowerCase().includes(q));
        if (!matchId && !matchPhone && !matchProduct) return false;
      }
      return true;
    });
  }, [orders, search, statusFilter, dateFilter]);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFilter("all");
  };

  const handleReorder = (order: UIOrder) => {
    if (reordering) return;
    setReordering(order.id);
    const { added, skipped } = reorderItems(order, addToCart);
    setReordering(null);
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
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-display text-4xl text-foreground">My Orders</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Showing orders saved in this demo or on this device.
      </p>

      {/* Filters */}
      <div className="mb-8 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order ID, phone or product"
            className="bg-card pl-9"
            aria-label="Search orders"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full bg-card sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
          <SelectTrigger className="w-full bg-card sm:w-40" aria-label="Filter by date">
            <SelectValue placeholder="Date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dates</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!hydrated ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-6 w-6" />}
          title="No orders match your filters"
          description="Try clearing the filters, tracking an order, or continue shopping."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={clearFilters}>
                Clear Filters
              </Button>
              <Button variant="outline" asChild>
                <Link to="/track">Track Order</Link>
              </Button>
              <Button asChild>
                <Link to="/shop">Shop</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((o) => (
            <div key={o.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-lg text-foreground">{o.id}</p>
                    {o.source === "demo" ? (
                      <Badge variant="outline" className="border-border text-muted-foreground">
                        Demo order
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-success/30 bg-success/10 text-success"
                      >
                        Saved on this device
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Placed on {o.date || "—"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-border">
                    Payment {o.paymentStatus}
                  </Badge>
                  <Badge variant="outline" className={cn(STATUS_TONE[o.status] ?? "")}>
                    {o.status}
                  </Badge>
                </div>
              </div>

              <div className="my-4 flex gap-2 overflow-x-auto">
                {o.items.map((it, i) => (
                  <img
                    key={i}
                    src={it.image}
                    alt={it.name}
                    loading="lazy"
                    className="h-16 w-14 shrink-0 rounded-lg object-cover"
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {o.items.length} item(s) ·{" "}
                  <span className="font-semibold text-primary">{formatBDT(o.total)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/track" search={{ id: o.id }}>
                      <Truck className="h-4 w-4" /> Track
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/orders/$id" params={{ id: o.id }}>
                      <Eye className="h-4 w-4" /> Details
                    </Link>
                  </Button>
                  <Button size="sm" onClick={() => handleReorder(o)} disabled={reordering === o.id}>
                    {reordering === o.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}{" "}
                    Reorder
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href={`https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(`Hi Nongorr! I need help with my order ${o.id}.`)}`}
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
