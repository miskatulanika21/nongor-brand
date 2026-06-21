import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader, StatCard } from "@/components/admin/AdminUI";
import { formatBDT } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TrendingUp, ShoppingCart, Users, RotateCcw, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reports")({ component: Reports });

const RANGES = ["Today", "This Week", "This Month", "Last 6 Months", "All Time"] as const;
type Range = (typeof RANGES)[number];

const monthly = [
  { m: "Jan", v: 210000 },
  { m: "Feb", v: 245000 },
  { m: "Mar", v: 312000 },
  { m: "Apr", v: 289000 },
  { m: "May", v: 356000 },
  { m: "Jun", v: 389400 },
];

const categorySales = [
  { name: "Kurti", value: 620000 },
  { name: "Saree", value: 540000 },
  { name: "Three Piece", value: 310000 },
  { name: "Girls Dress", value: 180000 },
  { name: "Cosmetics", value: 151400 },
];

const paymentMethods = [
  { name: "bKash", value: 72 },
  { name: "Nagad", value: 18 },
  { name: "COD", value: 10 },
];

const topProducts = [
  { name: "Emerald Everyday Kurti", sold: 142, revenue: 339380 },
  { name: "Royal Jamdani Saree", sold: 64, revenue: 441600 },
  { name: "Festive Three Piece Set", sold: 58, revenue: 400200 },
  { name: "Little Princess Frock", sold: 96, revenue: 133440 },
  { name: "Glow Serum 30ml", sold: 88, revenue: 114400 },
];

const PIE_COLORS = [
  "var(--color-primary)",
  "var(--color-gold)",
  "var(--color-success)",
  "#c08552",
  "#9a6a8a",
];

function Reports() {
  const [range, setRange] = useState<Range>("Last 6 Months");

  const exportCsv = () => {
    const rows = [
      ["Product", "Units Sold", "Revenue"],
      ...topProducts.map((p) => [p.name, p.sold, p.revenue]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nongorr-report.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported (demo)");
  };

  return (
    <div>
      <AdminHeader
        title="Reports"
        description="Sales and performance insights (mock data)."
        action={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              range === r
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Revenue"
          value={formatBDT(1801400)}
          icon={TrendingUp}
          tone="gold"
          hint={range}
        />
        <StatCard label="Orders" value={612} icon={ShoppingCart} tone="primary" />
        <StatCard label="New Customers" value={198} icon={Users} tone="success" />
        <StatCard label="Return Rate" value="3.2%" icon={RotateCcw} tone="destructive" />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 font-display text-xl text-foreground">Revenue ({range})</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="m" stroke="var(--color-muted-foreground)" fontSize={12} />
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
                formatter={(v: number) => [formatBDT(v), "Revenue"]}
              />
              <Bar dataKey="v" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Category sales">
          <PieChart>
            <Pie
              data={categorySales}
              dataKey="value"
              nameKey="name"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
            >
              {categorySales.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Legend />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
              }}
              formatter={(v: number) => formatBDT(v)}
            />
          </PieChart>
        </ChartCard>
        <ChartCard title="Payment methods">
          <PieChart>
            <Pie
              data={paymentMethods}
              dataKey="value"
              nameKey="name"
              outerRadius={90}
              paddingAngle={2}
            >
              {paymentMethods.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Legend />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
              }}
              formatter={(v: number) => `${v}%`}
            />
          </PieChart>
        </ChartCard>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 font-display text-xl text-foreground">Top 5 products</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topProducts.map((p) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                <TableCell className="text-right">{p.sold}</TableCell>
                <TableCell className="text-right text-primary">{formatBDT(p.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 font-display text-xl text-foreground">{title}</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
