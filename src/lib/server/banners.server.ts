/**
 * Homepage banners repository — SERVER ONLY.
 *
 * Admin calls use the SERVICE-ROLE client because the api.*_banner RPCs are
 * REVOKE-d from anon/authenticated; the server fn (banners.api.ts) has already
 * enforced CSRF + `content.manage` + MFA step-up + rate limit via
 * guardAdminWrite. The RPCs re-check active-staff and write the canonical
 * banner.* audit rows. Errors are re-thrown as BannerAdminError with a STABLE
 * code; raw SQL never reaches the client.
 *
 * The public storefront read uses the per-request ANON client (the RPC is
 * anon-granted and leaks no staff ids) behind the shared public TTL cache —
 * the hero is on the hottest page, and banners change rarely.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { cachedPublic } from "./public-cache.server";
import {
  KNOWN_BANNER_ERROR_CODES,
  toPublicBanners,
  type AdminBanner,
  type BannerInput,
  type PublicBanner,
} from "@/lib/banners-shared";

export class BannerAdminError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BannerAdminError";
  }
}

function throwBannerError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  // A CHECK/NOT-NULL violation means values were out of bounds for the type.
  if (error.code === "23514" || error.code === "23502") {
    throw new BannerAdminError("invalid_banner");
  }
  throw new BannerAdminError(KNOWN_BANNER_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/** Active, in-window banners for the storefront hero. Returns [] on failure. */
async function loadActiveBanners(): Promise<PublicBanner[]> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("get_active_banners");
  if (error) return [];
  return toPublicBanners(data);
}

/**
 * Cached wrapper — public banners are identical for every visitor and change
 * rarely; a warm instance serves them from memory (admin edits show within the
 * TTL, same guarantee as public settings).
 */
export const fetchActiveBanners = cachedPublic("public-banners", 60_000, loadActiveBanners);

/** All banners (any status) for the admin list. */
export async function listBanners(actorId: string): Promise<AdminBanner[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_banners", { p_actor: actorId });
  if (error) throwBannerError(error);
  return (data ?? []) as AdminBanner[];
}

/** Create or edit a banner (keyed on optional id). Returns the row + whether new. */
export async function upsertBanner(
  input: BannerInput,
  actorId: string,
): Promise<{ banner: AdminBanner; created: boolean }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("upsert_banner", { p_actor: actorId, p_banner: input });
  if (error) throwBannerError(error);
  return data as { banner: AdminBanner; created: boolean };
}

/** Enable/disable a banner. */
export async function setBannerActive(
  id: string,
  active: boolean,
  actorId: string,
): Promise<AdminBanner> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("set_banner_active", { p_actor: actorId, p_id: id, p_active: active });
  if (error) throwBannerError(error);
  return data as AdminBanner;
}

/** Delete a banner. */
export async function deleteBanner(id: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("delete_banner", { p_actor: actorId, p_id: id });
  if (error) throwBannerError(error);
}
