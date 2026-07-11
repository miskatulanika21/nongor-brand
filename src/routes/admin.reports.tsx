import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader, StatCard } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  ShoppingBag,
  PackageCheck,
  Ban,
  Wallet,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { loadReports, exportOrdersCsv } from "@/lib/reports.api";
import { presetRange, type ReportRange, type ReportsBundle } from "@/lib/reports-shared";
import { toCsv, downloadCsv } from "@/lib/csv-shared";
import { formatBDT } from "@/lib/brand";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports · Nongorr Admin" }] }),
  validateSearch: (search: Record<string, unknown>): ReportRange => {
    const fallback = presetRange(30);
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const from = typeof search.from === "string" && iso.test(search.from) ? search.from : null;
    const to = typeof search.to === "string" && iso.test(search.to) ? search.to : null;
    return from && to ? { from, to } : fallback;
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const res = await loadReports({ data: deps });
    return { reports: res.success ? res.reports : null, loadError: res.success ? null : res.error };
  },
  component: Reports,
});

const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

function Reports() {
  const { reports, loadError } = Route.useLoaderData();
  const range = Route.useSearch();
  const navigate = Route.useNavigate();
  const [exporting, setExporting] = useState(false);

  const setRange = (next: ReportRange) => void navigate({ search: next });

  const isPreset = (days: number) => {
    const p = presetRange(days);
    return p.from === range.from && p.to === range.to;
  };

  const exportOrders = async () => {
    setExporting(true);
    const res = await exportOrdersCsv({ data: range });
    setExporting(false);
    if (res.success && res.csv) {
      downloadCsv(`nongorr-orders-${range.from}-to-${range.to}.csv`, res.csv);
      toast.success(
        `Exported ${res.rows} order${res.rows === 1 ? "" : "s"}.` +
          (res.truncated ? " (Truncated at 50,000 rows — narrow the range.)" : ""),
      );
    } else {
      toast.error(res.success ? "Nothing to export." : res.error);
    }
  };

  return (
    <div>
      <AdminHeader
        title="Reports"
        description={`Live figures from real orders. “Confirmed” = verified orders (confirmed → completed); “Delivered” = realized revenue. ${range.from} → ${range.to}.`}
        action={
          <Button onClick={exportOrders} disabled={exporting}>
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Orders CSV
          </Button>
        }
      />

      {/* Range controls */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        {PRESETS.map((p) => (
          <Button
            key={p.days}
            variant={isPreset(p.days) ? "default" : "outline"}
            size="sm"
            onClick={() => setRange(presetRange(p.days))}
          >
            {p.label}
          </Button>
        ))}
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={range.from}
              onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              className="h-8 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To (exclusive)</Label>
            <Input
              type="date"
              value={range.to}
              onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              className="h-8 w-40"
            />
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {reports && <ReportsBody reports={reports} range={range} />}
    </div>
  );
}

function ReportsBody({ reports, range }: { reports: ReportsBundle; range: ReportRange }) {
  const t = reports.sales.totals;
  const days = reports.sales.by_day.map((d) => ({
    ...d,
    label: d.day.slice(5), // MM-DD
  }));

  const exportSection = (name: string, headers: string[], rows: (string | number | null)[][]) => {
    const { csv } = toCsv(headers, rows);
    downloadCsv(`nongorr-${name}-${range.from}-to-${range.to}.csv`, csv);
  };

  return (
    <div className="space-y-8">
      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Orders placed" value={t.orders_count} icon={ShoppingBag} tone="default" />
        <StatCard
          label="Confirmed revenue"
          value={formatBDT(t.confirmed_revenue)}
          icon={TrendingUp}
          tone="gold"
          hint={`${t.confirmed_count} orders · AOV ${formatBDT(t.aov)}`}
        />
        <StatCard
          label="Delivered revenue"
          value={formatBDT(t.delivered_revenue)}
          icon={PackageCheck}
          tone="success"
          hint={`${t.delivered_count} orders`}
        />
        <StatCard
          label="Cancelled / expired"
          value={t.cancelled_count}
          icon={Ban}
          tone="destructive"
        />
        <StatCard
          label="COD outstanding"
          value={formatBDT(Math.round(reports.cod.totals.cod_outstanding))}
          icon={Wallet}
          tone="primary"
          hint={`${reports.cod.totals.cod_shipments} COD shipments`}
        />
      </div>

      {/* Revenue over time */}
      <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-foreground">Revenue by day</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              exportSection(
                "revenue-by-day",
                ["day", "orders", "confirmed_revenue", "delivered_revenue"],
                reports.sales.by_day.map((d) => [
                  d.day,
                  d.orders,
                  d.confirmed_revenue,
                  d.delivered_revenue,
                ]),
              )
            }
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
        {days.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No orders in this range.
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={days}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={70} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatBDT(value),
                    name === "confirmed_revenue" ? "Confirmed" : "Delivered",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="confirmed_revenue"
                  stroke="var(--color-primary)"
                  fill="url(#rev)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="delivered_revenue"
                  stroke="var(--color-success, #16a34a)"
                  fill="transparent"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Top products */}
        <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-foreground">Top products</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exportSection(
                  "top-products",
                  ["name", "units", "orders", "revenue"],
                  reports.topProducts.map((p) => [p.name, p.units, p.orders, p.revenue]),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
          {reports.topProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No confirmed sales in this range.
            </p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reports.topProducts.slice(0, 6)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={12} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                    />
                    <Tooltip formatter={(value: number) => formatBDT(value)} />
                    <Bar dataKey="revenue" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1">Product</th>
                    <th className="px-2 py-1 text-right">Units</th>
                    <th className="px-2 py-1 text-right">Orders</th>
                    <th className="px-2 py-1 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.topProducts.map((p) => (
                    <tr key={p.product_id} className="border-t border-border">
                      <td className="max-w-48 truncate px-2 py-1.5 text-foreground">{p.name}</td>
                      <td className="px-2 py-1.5 text-right">{p.units}</td>
                      <td className="px-2 py-1.5 text-right">{p.orders}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-foreground">
                        {formatBDT(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Coupons */}
        <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-foreground">Coupon usage</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exportSection(
                  "coupon-usage",
                  ["coupon_code", "uses", "live_uses", "discount_total", "order_revenue"],
                  reports.coupons.map((c) => [
                    c.coupon_code,
                    c.uses,
                    c.live_uses,
                    c.discount_total,
                    c.order_revenue,
                  ]),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
          {reports.coupons.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No coupon redemptions in this range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Code</th>
                  <th className="px-2 py-1 text-right">Uses</th>
                  <th className="px-2 py-1 text-right">Live</th>
                  <th className="px-2 py-1 text-right">Discount given</th>
                  <th className="px-2 py-1 text-right">Order revenue</th>
                </tr>
              </thead>
              <tbody>
                {reports.coupons.map((c) => (
                  <tr key={c.coupon_code} className="border-t border-border">
                    <td className="px-2 py-1.5 font-medium text-primary">{c.coupon_code}</td>
                    <td className="px-2 py-1.5 text-right">{c.uses}</td>
                    <td className="px-2 py-1.5 text-right">{c.live_uses}</td>
                    <td className="px-2 py-1.5 text-right">{formatBDT(c.discount_total)}</td>
                    <td className="px-2 py-1.5 text-right">{formatBDT(c.order_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Courier performance */}
        <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-foreground">Courier performance</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exportSection(
                  "courier-performance",
                  [
                    "provider",
                    "booked",
                    "delivered",
                    "failed",
                    "returned",
                    "cancelled",
                    "avg_hours_to_deliver",
                  ],
                  reports.courier.map((c) => [
                    c.provider,
                    c.booked,
                    c.delivered,
                    c.failed,
                    c.returned,
                    c.cancelled,
                    c.avg_hours_to_deliver,
                  ]),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
          {reports.courier.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No courier bookings in this range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Provider</th>
                  <th className="px-2 py-1 text-right">Booked</th>
                  <th className="px-2 py-1 text-right">Delivered</th>
                  <th className="px-2 py-1 text-right">Failed</th>
                  <th className="px-2 py-1 text-right">Returned</th>
                  <th className="px-2 py-1 text-right">Avg hrs</th>
                </tr>
              </thead>
              <tbody>
                {reports.courier.map((c) => (
                  <tr key={c.provider} className="border-t border-border">
                    <td className="px-2 py-1.5 font-medium capitalize text-foreground">
                      {c.provider}
                    </td>
                    <td className="px-2 py-1.5 text-right">{c.booked}</td>
                    <td className="px-2 py-1.5 text-right text-success">{c.delivered}</td>
                    <td className="px-2 py-1.5 text-right text-destructive">{c.failed}</td>
                    <td className="px-2 py-1.5 text-right">{c.returned}</td>
                    <td className="px-2 py-1.5 text-right">{c.avg_hours_to_deliver ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* COD reconciliation */}
        <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-foreground">COD reconciliation</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exportSection(
                  "cod-reconciliation",
                  [
                    "provider",
                    "cod_shipments",
                    "cod_expected",
                    "cod_collected",
                    "cod_settled",
                    "cod_outstanding",
                  ],
                  reports.cod.by_provider.map((p) => [
                    p.provider,
                    p.cod_shipments,
                    p.cod_expected,
                    p.cod_collected,
                    p.cod_settled,
                    p.cod_outstanding,
                  ]),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
          <dl className="mb-3 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {(
              [
                ["Expected", reports.cod.totals.cod_expected],
                ["Collected", reports.cod.totals.cod_collected],
                ["Settled", reports.cod.totals.cod_settled],
                ["Outstanding", reports.cod.totals.cod_outstanding],
                ["Courier fees", reports.cod.totals.courier_fees],
                ["Return fees", reports.cod.totals.return_fees],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-border/60 py-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium text-foreground">{formatBDT(Math.round(value))}</dd>
              </div>
            ))}
          </dl>
          {reports.cod.by_provider.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No COD shipments in this range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Provider</th>
                  <th className="px-2 py-1 text-right">Shipments</th>
                  <th className="px-2 py-1 text-right">Expected</th>
                  <th className="px-2 py-1 text-right">Settled</th>
                  <th className="px-2 py-1 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {reports.cod.by_provider.map((p) => (
                  <tr key={p.provider} className="border-t border-border">
                    <td className="px-2 py-1.5 font-medium capitalize text-foreground">
                      {p.provider}
                    </td>
                    <td className="px-2 py-1.5 text-right">{p.cod_shipments}</td>
                    <td className="px-2 py-1.5 text-right">
                      {formatBDT(Math.round(p.cod_expected))}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {formatBDT(Math.round(p.cod_settled))}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium text-foreground">
                      {formatBDT(Math.round(p.cod_outstanding))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Status breakdown */}
      <section className="overflow-x-auto rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 font-display text-lg text-foreground">Orders by status</h2>
        <div className="flex flex-wrap gap-2">
          {reports.sales.by_status.map((s) => (
            <span
              key={s.status}
              className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-foreground"
            >
              {s.status.replace(/_/g, " ")} · {s.count} · {formatBDT(s.total)}
            </span>
          ))}
          {reports.sales.by_status.length === 0 && (
            <span className="text-sm text-muted-foreground">No orders in this range.</span>
          )}
        </div>
      </section>
    </div>
  );
}
