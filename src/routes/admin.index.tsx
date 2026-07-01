import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AdminHeader,
  StatCard,
  AdminStateToggle,
  AdminLoadingState,
  AdminEmptyState,
  AdminErrorState,
  AdminSectionCard,
  MockBadge,
  PreviewNotice,
  type AdminPreviewState,
} from "@/components/admin/AdminUI";
import { adminOrderStatsFn, listOrdersFn } from "@/lib/orders.api";
import { StatusBadge, fmtDate } from "@/components/admin/order-status";
import type { AdminOrderStats, OrderListRow } from "@/lib/orders-shared";
import { listAdminProducts } from "@/lib/catalog-admin.api";
import type { AdminProductListItem } from "@/lib/server/catalog-admin.server";
import { useNoticeToast } from "@/lib/auth-notices";
import { formatBDT } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ShoppingCart,
  Wallet,
  CheckCircle2,
  Truck,
  TrendingUp,
  AlertTriangle,
  Crown,
  Package,
  ArrowRight,
  Ruler,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard · Nongorr Admin" }] }),
  component: Dashboard,
});

// Hardcoded sample shape — clearly labelled, not connected to real revenue.
const sampleSalesData = [
  { d: "Mon", v: 12400 },
  { d: "Tue", v: 9800 },
  { d: "Wed", v: 15600 },
  { d: "Thu", v: 11200 },
  { d: "Fri", v: 18900 },
  { d: "Sat", v: 22400 },
  { d: "Sun", v: 16700 },
];

function Dashboard() {
  const [previewState, setPreviewState] = useState<AdminPreviewState>("loaded");
  useNoticeToast();

  // Live order figures (api.admin_order_stats) + the most recent orders.
  const [stats, setStats] = useState<AdminOrderStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [recent, setRecent] = useState<OrderListRow[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([adminOrderStatsFn(), listOrdersFn({ data: { limit: 6 } })])
      .then(([s, r]) => {
        if (!active) return;
        if (s.success && s.stats) {
          setStats(s.stats);
          setStatsStatus("ready");
        } else {
          setStatsStatus("error");
        }
        if (r.success) setRecent(r.orders);
      })
      .catch(() => active && setStatsStatus("error"));
    return () => {
      active = false;
    };
  }, []);
  const statsReady = statsStatus === "ready" && stats !== null;

  // Catalog widgets (Low Stock, Best Sellers) read the LIVE product table so
  // they match the real admin catalog instead of the retired mock array.
  const [catalog, setCatalog] = useState<AdminProductListItem[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    listAdminProducts()
      .then((r) => {
        if (!active) return;
        if (r.success) {
          setCatalog(r.products);
          setCatalogStatus("ready");
        } else {
          setCatalogStatus("error");
        }
      })
      .catch(() => {
        if (active) setCatalogStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const activeProducts = catalog.filter((p) => p.status === "active");
  const lowStock = activeProducts.filter((p) => p.stock <= 10);
  const best = activeProducts.filter((p) => p.isBestSeller).slice(0, 4);
  const catalogReady = catalogStatus === "ready";

  return (
    <div>
      <AdminHeader
        title="Dashboard"
        description="Live catalog and order health at a glance."
        action={<AdminStateToggle value={previewState} onValueChange={setPreviewState} />}
      />

      <PreviewNotice className="mb-5">
        Order, payment, catalog and revenue figures are live · The sales trend chart below is still
        sample data.
      </PreviewNotice>

      {previewState === "loading" && (
        <AdminLoadingState rows={6} label="Loading dashboard preview" />
      )}

      {previewState === "empty" && (
        <AdminEmptyState
          title="No demo data to display"
          description="This simulated empty state shows how the dashboard looks before any orders or products exist."
        />
      )}

      {previewState === "error" && (
        <AdminErrorState
          title="Preview unavailable"
          description="This is a simulated dashboard error. Retrying only restores the local loaded preview."
          onRetry={() => setPreviewState("loaded")}
        />
      )}

      {previewState === "loaded" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Today's Orders"
              value={statsReady ? stats.todayOrders : "—"}
              icon={ShoppingCart}
              tone="primary"
              hint="Placed today"
              to="/admin/orders"
            />
            <StatCard
              label="Pending Payments"
              value={statsReady ? stats.pendingPayments : "—"}
              icon={Wallet}
              tone="gold"
              hint="Awaiting verification"
              to="/admin/payments"
            />
            <StatCard
              label="Courier Pending"
              value={statsReady ? stats.courierPending : "—"}
              icon={Truck}
              tone="default"
              hint="Confirmed / processing / ready"
              to="/admin/courier"
            />
            <StatCard
              label="Low Stock"
              value={catalogReady ? lowStock.length : "—"}
              icon={AlertTriangle}
              tone="destructive"
              hint="Active products at or below 10"
              to="/admin/inventory"
            />
            <StatCard
              label="Revenue (delivered)"
              value={statsReady ? formatBDT(stats.deliveredRevenue) : "—"}
              icon={TrendingUp}
              tone="gold"
              hint="Delivered + completed orders"
              to="/admin/reports"
            />
            <StatCard
              label="Total Orders"
              value={statsReady ? stats.totalOrders : "—"}
              icon={CheckCircle2}
              tone="success"
              hint="All orders"
              to="/admin/orders"
            />
            <StatCard
              label="Custom-size Pending"
              value={statsReady ? stats.customPending : "—"}
              icon={Ruler}
              tone="default"
              hint="Made-to-measure in progress"
              to="/admin/orders"
            />
          </div>

          {/* Quick actions */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction
              label="Pending payments"
              desc={statsReady ? `${stats.pendingPayments} awaiting verification` : "Checking…"}
              cta="Verify now"
              to="/admin/payments"
              icon={Wallet}
              tone="gold"
            />
            <QuickAction
              label="Today's orders"
              desc={statsReady ? `${stats.todayOrders} placed today` : "Checking…"}
              cta="View orders"
              to="/admin/orders"
              icon={ShoppingCart}
              tone="primary"
            />
            <QuickAction
              label="Low stock"
              desc={catalogReady ? `${lowStock.length} items running low` : "Checking catalog…"}
              cta="Update stock"
              to="/admin/inventory"
              icon={AlertTriangle}
              tone="destructive"
            />
            <QuickAction
              label="Courier pending"
              desc={statsReady ? `${stats.courierPending} ready to ship` : "Checking…"}
              cta="Book courier"
              to="/admin/courier"
              icon={Truck}
              tone="default"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <AdminSectionCard
              className="lg:col-span-2"
              title="Sample sales trend"
              description="Hardcoded sample data — not connected to actual store revenue."
              action={<MockBadge label="Demo" />}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sampleSalesData}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="d" stroke="var(--color-muted-foreground)" fontSize={12} />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                      tickFormatter={(v) => `${v / 1000}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 12,
                      }}
                      formatter={(v: number) => [formatBDT(v), "Sample"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#g)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </AdminSectionCard>

            <AdminSectionCard
              title="Low Stock"
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin/inventory">Update stock</Link>
                </Button>
              }
            >
              {catalogStatus === "loading" ? (
                <p className="text-sm text-muted-foreground">Loading catalog…</p>
              ) : catalogStatus === "error" ? (
                <p className="text-sm text-destructive">Couldn’t load products.</p>
              ) : lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active products are low on stock.
                </p>
              ) : (
                <ul className="space-y-2">
                  {lowStock.slice(0, 5).map((p) => (
                    <li key={p.code} className="flex items-center justify-between text-sm">
                      <span className="line-clamp-1 text-foreground">{p.name}</span>
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        {p.stock} left
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </AdminSectionCard>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <AdminSectionCard
              title="Recent Orders"
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin/orders">View all</Link>
                </Button>
              }
            >
              <div className="space-y-2">
                {statsStatus === "loading" ? (
                  <p className="text-sm text-muted-foreground">Loading orders…</p>
                ) : recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No orders yet.</p>
                ) : (
                  recent.map((o) => (
                    <Link
                      key={o.id}
                      to="/admin/orders"
                      className="flex items-center justify-between rounded-lg p-2 hover:bg-secondary"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{o.orderNo}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.customerName} · {fmtDate(o.placedAt)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="text-sm font-semibold text-primary">{formatBDT(o.total)}</p>
                        <StatusBadge status={o.status} />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </AdminSectionCard>

            <AdminSectionCard
              title={
                <span className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-gold" /> Best Sellers
                </span>
              }
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin/products">Products</Link>
                </Button>
              }
            >
              <div className="space-y-2">
                {catalogStatus === "loading" ? (
                  <p className="text-sm text-muted-foreground">Loading catalog…</p>
                ) : catalogStatus === "error" ? (
                  <p className="text-sm text-destructive">Couldn’t load products.</p>
                ) : best.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active best-sellers yet. Flag products as best-sellers to feature them here.
                  </p>
                ) : (
                  best.map((p) => (
                    <div
                      key={p.code}
                      className="flex items-center gap-3 rounded-lg p-2 hover:bg-secondary"
                    >
                      {p.image ? (
                        <img
                          src={p.image}
                          alt={p.name}
                          className="h-12 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="grid h-12 w-10 place-items-center rounded bg-secondary text-muted-foreground">
                          <Package className="h-4 w-4" />
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="line-clamp-1 text-sm font-medium text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.reviewCount} reviews · {formatBDT(p.salePrice ?? p.price)}
                        </p>
                      </div>
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </div>
            </AdminSectionCard>
          </div>
        </>
      )}
    </div>
  );
}

function QuickAction({
  label,
  desc,
  cta,
  to,
  icon: Icon,
  tone,
}: {
  label: string;
  desc: string;
  cta: string;
  to: string;
  icon: typeof Wallet;
  tone: string;
}) {
  const actionTones: Record<string, string> = {
    gold: "bg-gold/15 text-primary",
    primary: "bg-primary/10 text-primary",
    destructive: "bg-destructive/10 text-destructive",
    default: "bg-secondary text-foreground",
  };
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className={cn("mb-3 grid h-9 w-9 place-items-center rounded-lg", actionTones[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="font-medium text-foreground">{label}</p>
      <p className="mb-3 text-xs text-muted-foreground">{desc}</p>
      <Button variant="outline" size="sm" className="mt-auto w-full" asChild>
        <Link to={to as never}>
          {cta} <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
