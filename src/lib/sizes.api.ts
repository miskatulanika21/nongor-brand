/**
 * Size charts API — createServerFn handlers (Stage 6 P5).
 *
 *   - getSizeCharts       → storefront size guide (anon; cached; [] on failure)
 *   - loadSizeCharts      → admin list (requires `sizes.manage`)
 *   - saveSizeChart       → create/edit via guardAdminWrite (CSRF + permission
 *                           + MFA step-up + rate limit + denial audit)
 *   - setSizeChartActiveFn / deleteSizeChartFn
 *
 * The canonical size_chart.* audit rows are written SQL-side by the api.*
 * RPCs. Server-only modules are imported INSIDE handler closures so they never
 * enter the client bundle (same pattern as banners.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import {
  sizeChartInputSchema,
  setSizeChartActiveSchema,
  sizeChartIdArgSchema,
} from "@/lib/sizes-shared";

async function messageFromSizeChartError(e: unknown): Promise<string> {
  const { SizeChartAdminError } = await import("@/lib/server/sizes.server");
  const { sizeChartErrorMessage } = await import("@/lib/sizes-shared");
  return sizeChartErrorMessage(e instanceof SizeChartAdminError ? e.code : undefined);
}

export const getSizeCharts = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchPublicSizeCharts } = await import("@/lib/server/sizes.server");
  return fetchPublicSizeCharts();
});

export const loadSizeCharts = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("sizes.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", charts: [] };
  const repo = await import("@/lib/server/sizes.server");
  try {
    return { success: true as const, charts: await repo.listSizeCharts(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load size charts.", charts: [] };
  }
});

export const saveSizeChart = createServerFn({ method: "POST" })
  .validator(sizeChartInputSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("sizes.manage", "saveSizeChart");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/sizes.server");
    try {
      const result = await repo.upsertSizeChart(data, g.actorId);
      return { success: true as const, ...result };
    } catch (e) {
      return { success: false as const, error: await messageFromSizeChartError(e) };
    }
  });

export const setSizeChartActiveFn = createServerFn({ method: "POST" })
  .validator(setSizeChartActiveSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("sizes.manage", "setSizeChartActive");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/sizes.server");
    try {
      const chart = await repo.setSizeChartActive(data.id, data.active, g.actorId);
      return { success: true as const, chart };
    } catch (e) {
      return { success: false as const, error: await messageFromSizeChartError(e) };
    }
  });

export const deleteSizeChartFn = createServerFn({ method: "POST" })
  .validator(sizeChartIdArgSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("sizes.manage", "deleteSizeChart");
    if (!g.ok) return { success: false as const, error: g.error };
    const repo = await import("@/lib/server/sizes.server");
    try {
      await repo.deleteSizeChart(data.id, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromSizeChartError(e) };
    }
  });
