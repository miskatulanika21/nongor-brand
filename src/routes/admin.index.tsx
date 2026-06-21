import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { ORDERS, STATUS_TONE } from "@/lib/orders";
import { PRODUCTS } from "@/lib/products";
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

  // Derived honestly from seed ORDERS / PRODUCTS.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysOrders = ORDERS.filter((o) => o.date === todayKey);
  const pendingPayments = ORDERS.filter((o) => o.paymentStatus === "Pending");
  const courierPending = ORDERS.filter((o) => ["Confirmed", "Processing"].includes(o.status));
  const demoRevenue = ORDERS.reduce((sum, o) => sum + o.total, 0);

  const lowStock = PRODUCTS.filter((p) => p.stock <= 10);
  const best = PRODUCTS.filter((p) => p.isBestSeller).slice(0, 4);

  return (
    <div>
      <AdminHeader
        title="Dashboard"
        description="A read-only overview built from seed demo data."
        action={<AdminStateToggle value={previewState} onValueChange={setPreviewState} />}
      />

      <PreviewNotice className="mb-5">
        Local preview only · Figures are derived from seed orders and reset when this page reloads.
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
              value={todaysOrders.length}
              icon={ShoppingCart}
              tone="primary"
              hint={
                todaysOrders.length === 0 ? "No demo orders dated today" : "Seed orders dated today"
              }
              to="/admin/orders"
            />
            <StatCard
              label="Pending Payments"
              value={pendingPayments.length}
              icon={Wallet}
              tone="gold"
              hint="From seed payment status"
              to="/admin/payments"
            />
            <StatCard
              label="Courier Pending"
              value={courierPending.length}
              icon={Truck}
              tone="default"
              hint="Confirmed / Processing orders"
              to="/admin/courier"
            />
            <StatCard
              label="Low Stock"
              value={lowStock.length}
              icon={AlertTriangle}
              tone="destructive"
              hint="Products at or below 10"
              to="/admin/inventory"
            />
            <StatCard
              label="Demo Order Revenue"
              value={formatBDT(demoRevenue)}
              icon={TrendingUp}
              tone="gold"
              hint="Total of all seed orders"
              to="/admin/reports"
            />
            <StatCard
              label="Orders (all seed)"
              value={ORDERS.length}
              icon={CheckCircle2}
              tone="success"
              hint="Total seed orders"
              to="/admin/orders"
            />
            {/* Custom-size pending: not derivable from current seed order type. */}
            <div className="rounded-xl border border-dashed border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Custom-size Pending
                </span>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
                  <Ruler className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 font-display text-3xl text-muted-foreground">—</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Not available in the current seed orders
              </p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction
              label="Pending payments"
              desc={`${pendingPayments.length} awaiting verification`}
              cta="Verify now"
              to="/admin/payments"
              icon={Wallet}
              tone="gold"
            />
            <QuickAction
              label="Today's orders"
              desc={
                todaysOrders.length === 0
                  ? "No demo orders dated today"
                  : `${todaysOrders.length} dated today`
              }
              cta="View orders"
              to="/admin/orders"
              icon={ShoppingCart}
              tone="primary"
            />
            <QuickAction
              label="Low stock"
              desc={`${lowStock.length} items running low`}
              cta="Update stock"
              to="/admin/inventory"
              icon={AlertTriangle}
              tone="destructive"
            />
            <QuickAction
              label="Courier pending"
              desc={`${courierPending.length} ready to ship`}
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
              {lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">No low-stock products in seed data.</p>
              ) : (
                <ul className="space-y-2">
                  {lowStock.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-sm">
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
                {ORDERS.map((o) => (
                  <Link
                    key={o.id}
                    to="/admin/orders"
                    className="flex items-center justify-between rounded-lg p-2 hover:bg-secondary"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{o.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.customer} · {o.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-primary">{formatBDT(o.total)}</p>
                      <Badge
                        variant="outline"
                        className={cn("text-[0.65rem]", STATUS_TONE[o.status] ?? "")}
                      >
                        {o.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
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
                {best.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-secondary"
                  >
                    <img src={p.image} alt={p.name} className="h-12 w-10 rounded object-cover" />
                    <div className="flex-1">
                      <p className="line-clamp-1 text-sm font-medium text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.reviewCount} reviews · {formatBDT(p.salePrice ?? p.price)}
                      </p>
                    </div>
                    <Package className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
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
