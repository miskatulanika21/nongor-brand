/**
 * Business reports repository — SERVER ONLY (Stage 6 P6).
 *
 * All calls use the SERVICE-ROLE client because the api.report_* RPCs are
 * REVOKE-d from anon/authenticated; the server fn (reports.api.ts) has already
 * enforced `reports.view` (admin/owner only). The RPCs re-check active-staff.
 * Reads only — no audit rows.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import type {
  CodReconciliation,
  CouponUsageRow,
  CourierPerformanceRow,
  ReportRange,
  ReportsBundle,
  SalesSummary,
  TopProductRow,
} from "@/lib/reports-shared";

export class ReportError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ReportError";
  }
}

/** [from, to) as timestamptz strings (UTC midnights from ISO dates). */
function bounds(range: ReportRange): { from: string; to: string } {
  return { from: `${range.from}T00:00:00Z`, to: `${range.to}T00:00:00Z` };
}

async function callReport<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc(fn, args);
  if (error) {
    const raw = (error.message ?? "").trim();
    throw new ReportError(raw === "actor_not_authorized" ? raw : "internal_error");
  }
  return data as T;
}

export function fetchSalesSummary(range: ReportRange, actorId: string): Promise<SalesSummary> {
  const { from, to } = bounds(range);
  return callReport("report_sales_summary", { p_actor: actorId, p_from: from, p_to: to });
}

export function fetchTopProducts(
  range: ReportRange,
  actorId: string,
  limit = 10,
): Promise<TopProductRow[]> {
  const { from, to } = bounds(range);
  return callReport("report_top_products", {
    p_actor: actorId,
    p_from: from,
    p_to: to,
    p_limit: limit,
  });
}

export function fetchCouponUsage(range: ReportRange, actorId: string): Promise<CouponUsageRow[]> {
  const { from, to } = bounds(range);
  return callReport("report_coupon_usage", { p_actor: actorId, p_from: from, p_to: to });
}

export function fetchCourierPerformance(
  range: ReportRange,
  actorId: string,
): Promise<CourierPerformanceRow[]> {
  const { from, to } = bounds(range);
  return callReport("report_courier_performance", { p_actor: actorId, p_from: from, p_to: to });
}

export function fetchCodReconciliation(
  range: ReportRange,
  actorId: string,
): Promise<CodReconciliation> {
  const { from, to } = bounds(range);
  return callReport("report_cod_reconciliation", { p_actor: actorId, p_from: from, p_to: to });
}

/** Everything the Reports page renders, fetched concurrently. */
export async function fetchReportsBundle(
  range: ReportRange,
  actorId: string,
): Promise<ReportsBundle> {
  const [sales, topProducts, coupons, courier, cod] = await Promise.all([
    fetchSalesSummary(range, actorId),
    fetchTopProducts(range, actorId, 10),
    fetchCouponUsage(range, actorId),
    fetchCourierPerformance(range, actorId),
    fetchCodReconciliation(range, actorId),
  ]);
  return { sales, topProducts, coupons, courier, cod };
}

/**
 * PII-free orders export for the range: order_no, timestamps, status, method,
 * zone, money columns, coupon. Capped (the CSV layer enforces CSV_MAX_ROWS).
 */
export async function fetchOrdersForExport(
  range: ReportRange,
  actorId: string,
): Promise<
  Array<{
    order_no: string;
    placed_at: string;
    status: string;
    payment_method: string;
    ship_zone: string;
    subtotal: number;
    discount: number;
    shipping_fee: number;
    total: number;
    coupon_code: string | null;
  }>
> {
  // Direct service-role read (same pattern as orders.server.ts) with the
  // RPC-equivalent active-staff check up front.
  const admin = createAdminSupabaseClient();
  const { data: staff, error: staffErr } = await admin
    .from("staff_profiles")
    .select("user_id")
    .eq("user_id", actorId)
    .eq("is_active", true)
    .maybeSingle();
  if (staffErr || !staff) throw new ReportError("actor_not_authorized");

  const { from, to } = bounds(range);
  const { data, error } = await admin
    .from("orders")
    .select(
      "order_no, placed_at, status, payment_method, ship_zone, subtotal, discount, shipping_fee, total, coupon_code",
    )
    .gte("placed_at", from)
    .lt("placed_at", to)
    .order("placed_at", { ascending: true })
    .limit(50000);
  if (error) throw new ReportError("internal_error");
  return (data ?? []) as Awaited<ReturnType<typeof fetchOrdersForExport>>;
}
