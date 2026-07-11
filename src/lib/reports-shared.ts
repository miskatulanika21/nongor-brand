/**
 * Business reports — isomorphic types, range schema & error copy (Stage 6 P6).
 * NO server-only imports (safe in the client bundle). Mirrors the five
 * api.report_* RPCs.
 *
 * Definitions (mirrors the SQL, shown to the operator in the UI):
 *   - "Confirmed" orders/revenue = statuses confirmed → completed (verified
 *     money, delivered or not). Cancelled/expired/returned/refunds are out.
 *   - "Delivered" revenue = delivered + completed only (realized).
 *   - Order reports range on placed_at; courier/COD reports on booked_at.
 */
import { z } from "zod";

export interface SalesTotals {
  orders_count: number;
  confirmed_count: number;
  delivered_count: number;
  cancelled_count: number;
  confirmed_revenue: number;
  delivered_revenue: number;
  discount_total: number;
  shipping_total: number;
  aov: number;
}

export interface SalesByDay {
  day: string;
  orders: number;
  confirmed_revenue: number;
  delivered_revenue: number;
}

export interface SalesByStatus {
  status: string;
  count: number;
  total: number;
}

export interface SalesSummary {
  totals: SalesTotals;
  by_day: SalesByDay[];
  by_status: SalesByStatus[];
}

export interface TopProductRow {
  product_id: string;
  name: string;
  units: number;
  revenue: number;
  orders: number;
}

export interface CouponUsageRow {
  coupon_code: string;
  uses: number;
  live_uses: number;
  discount_total: number;
  order_revenue: number;
}

export interface CourierPerformanceRow {
  provider: string;
  booked: number;
  delivered: number;
  failed: number;
  returned: number;
  cancelled: number;
  avg_hours_to_deliver: number | null;
}

export interface CodTotals {
  cod_shipments: number;
  cod_expected: number;
  cod_collected: number;
  cod_settled: number;
  cod_outstanding: number;
  courier_fees: number;
  return_fees: number;
  net_receivable: number;
}

export interface CodByProvider {
  provider: string;
  cod_shipments: number;
  cod_expected: number;
  cod_collected: number;
  cod_settled: number;
  cod_outstanding: number;
}

export interface CodReconciliation {
  totals: CodTotals;
  by_provider: CodByProvider[];
}

/** Everything the Reports page needs, loaded in one round trip. */
export interface ReportsBundle {
  sales: SalesSummary;
  topProducts: TopProductRow[];
  coupons: CouponUsageRow[];
  courier: CourierPerformanceRow[];
  cod: CodReconciliation;
}

// ── Range input (ISO dates; server re-validates + bounds) ────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const reportRangeSchema = z.object({ from: isoDate, to: isoDate }).superRefine((r, ctx) => {
  const from = new Date(`${r.from}T00:00:00Z`);
  const to = new Date(`${r.to}T00:00:00Z`);
  if (to <= from) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "Must be after the start date." });
  }
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > 400) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "Range is capped at 400 days." });
  }
});

export type ReportRange = z.infer<typeof reportRangeSchema>;

/** Preset helper — [from, to) covering the last `days` days incl. today. */
export function presetRange(days: number, today = new Date()): ReportRange {
  const to = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const from = new Date(to.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export const REPORT_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  invalid_range: "Pick a valid date range (start before end, at most 400 days).",
  internal_error: "Could not load the report. Please try again.",
};

export function reportErrorMessage(code: string | null | undefined): string {
  if (!code) return REPORT_ERROR_MESSAGES.internal_error;
  return REPORT_ERROR_MESSAGES[code] ?? REPORT_ERROR_MESSAGES.internal_error;
}
