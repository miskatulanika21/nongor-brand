/**
 * Business reports API — createServerFn handlers (Stage 6 P6).
 *
 *   - loadReports       → the full reports bundle for a date range
 *                         (requires `reports.view`; admin/owner only)
 *   - exportOrdersCsv   → PII-free orders CSV for the range
 *
 * Reads only — the canonical data comes from the api.report_* RPCs. Server-only
 * modules are imported INSIDE handler closures so they never enter the client
 * bundle (same pattern as banners.api.ts / pages.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { reportRangeSchema } from "@/lib/reports-shared";

export const loadReports = createServerFn({ method: "GET" })
  .validator(reportRangeSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("reports.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", reports: null };
    const repo = await import("@/lib/server/reports.server");
    try {
      return {
        success: true as const,
        reports: await repo.fetchReportsBundle(data, authz.identity.userId),
      };
    } catch (e) {
      const { ReportError } = await import("@/lib/server/reports.server");
      const { reportErrorMessage } = await import("@/lib/reports-shared");
      return {
        success: false as const,
        error: reportErrorMessage(e instanceof ReportError ? e.code : undefined),
        reports: null,
      };
    }
  });

export const exportOrdersCsv = createServerFn({ method: "GET" })
  .validator(reportRangeSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("reports.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", csv: null };
    const repo = await import("@/lib/server/reports.server");
    const { toCsv } = await import("@/lib/csv-shared");
    try {
      const rows = await repo.fetchOrdersForExport(data, authz.identity.userId);
      const { csv, truncated } = toCsv(
        [
          "order_no",
          "placed_at",
          "status",
          "payment_method",
          "ship_zone",
          "subtotal",
          "discount",
          "shipping_fee",
          "total",
          "coupon_code",
        ],
        rows.map((r) => [
          r.order_no,
          r.placed_at,
          r.status,
          r.payment_method,
          r.ship_zone,
          r.subtotal,
          r.discount,
          r.shipping_fee,
          r.total,
          r.coupon_code,
        ]),
      );
      return { success: true as const, csv, truncated, rows: rows.length };
    } catch (e) {
      const { ReportError } = await import("@/lib/server/reports.server");
      const { reportErrorMessage } = await import("@/lib/reports-shared");
      return {
        success: false as const,
        error: reportErrorMessage(e instanceof ReportError ? e.code : undefined),
        csv: null,
      };
    }
  });
