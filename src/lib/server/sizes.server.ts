/**
 * Size charts repository — SERVER ONLY (Stage 6 P5).
 *
 * Admin calls use the SERVICE-ROLE client because the api.*size_chart* RPCs
 * are REVOKE-d from anon/authenticated; the server fn (sizes.api.ts) has
 * already enforced CSRF + `sizes.manage` + MFA step-up + rate limit via
 * guardAdminWrite. The RPCs re-check active-staff and write the canonical
 * size_chart.* audit rows. Errors are re-thrown as SizeChartAdminError with a
 * STABLE code; raw SQL never reaches the client.
 *
 * The public storefront read uses the per-request ANON client behind the
 * shared public TTL cache (size charts change rarely).
 */
import { createServerSupabaseClient } from "./supabase.server";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { cachedPublic } from "./public-cache.server";
import {
  KNOWN_SIZE_CHART_ERROR_CODES,
  toPublicSizeCharts,
  type AdminSizeChart,
  type PublicSizeChart,
  type SizeChartInput,
} from "@/lib/sizes-shared";

export class SizeChartAdminError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SizeChartAdminError";
  }
}

function throwSizeChartError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  if (error.code === "23514" || error.code === "23502" || error.code === "23505") {
    throw new SizeChartAdminError("invalid_size_chart");
  }
  throw new SizeChartAdminError(KNOWN_SIZE_CHART_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/** Active charts for the storefront size guide. Returns [] on failure. */
async function loadPublicSizeCharts(): Promise<PublicSizeChart[]> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("get_size_charts");
  if (error) return [];
  return toPublicSizeCharts(data);
}

/** Cached wrapper — same guarantee as settings/banners (60s TTL). */
export const fetchPublicSizeCharts = cachedPublic(
  "public-size-charts",
  60_000,
  loadPublicSizeCharts,
);

/** All charts (any status) for the admin list. */
export async function listSizeCharts(actorId: string): Promise<AdminSizeChart[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_size_charts", { p_actor: actorId });
  if (error) throwSizeChartError(error);
  return (data ?? []) as AdminSizeChart[];
}

/** Create or edit a chart (keyed on optional id). Returns the row + whether new. */
export async function upsertSizeChart(
  input: SizeChartInput,
  actorId: string,
): Promise<{ chart: AdminSizeChart; created: boolean }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("upsert_size_chart", { p_actor: actorId, p_chart: input });
  if (error) throwSizeChartError(error);
  return data as { chart: AdminSizeChart; created: boolean };
}

/** Show/hide a chart on the storefront. */
export async function setSizeChartActive(
  id: string,
  active: boolean,
  actorId: string,
): Promise<AdminSizeChart> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("set_size_chart_active", { p_actor: actorId, p_id: id, p_active: active });
  if (error) throwSizeChartError(error);
  return data as AdminSizeChart;
}

/** Delete a chart. */
export async function deleteSizeChart(id: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("delete_size_chart", { p_actor: actorId, p_id: id });
  if (error) throwSizeChartError(error);
}
