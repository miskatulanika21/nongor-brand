import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatBDT } from "@/lib/brand";
import type { SalesByDay } from "@/lib/reports-shared";

/**
 * Real 7-day revenue trend for the admin dashboard.
 *
 * Lives in its own module so the dashboard can lazy-load it: recharts is by far
 * the heaviest dependency on that route, and keeping it out of the initial
 * chunk lets the stat cards paint without waiting for it to download+parse.
 *
 * Data comes from api.report_sales_summary (via loadReports) — the same source
 * the Reports page uses, so the two screens can never disagree.
 */
export default function SalesTrendChart({ byDay }: { byDay: SalesByDay[] }) {
  const days = byDay.map((d) => ({ ...d, label: d.day.slice(5) })); // MM-DD

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={days}>
          <defs>
            <linearGradient id="dash-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={54}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          />
          <Tooltip
            formatter={(v: number) => [formatBDT(v), "Delivered revenue"]}
            labelFormatter={(l: string) => `Day ${l}`}
          />
          <Area
            type="monotone"
            dataKey="delivered_revenue"
            stroke="var(--color-primary)"
            fill="url(#dash-rev)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
