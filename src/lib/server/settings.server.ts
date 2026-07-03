/**
 * Site settings repository — SERVER ONLY.
 *
 * Public reads use the per-request ANON client (RPC is anon-granted and returns
 * no payment secrets). Admin read/save use the service-role client and pass the
 * verified actor id to the SECURITY DEFINER RPCs, which re-check active-staff
 * and write the canonical `settings.updated` audit. Errors are re-thrown as
 * SettingsError carrying a STABLE code; raw SQL never reaches the client.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { cachedPublic } from "./public-cache.server";
import {
  KNOWN_SETTINGS_ERROR_CODES,
  normalizePublicSettings,
  normalizeAdminSettings,
  type PublicSettings,
  type AdminSettings,
  type SettingsPatch,
} from "@/lib/settings.schema";

export class SettingsError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SettingsError";
  }
}

function throwSettingsError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  // A table CHECK violation (23514) means a value was out of bounds.
  if (error.code === "23514" || error.code === "23502") throw new SettingsError("invalid_settings");
  throw new SettingsError(KNOWN_SETTINGS_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/** Public storefront settings (no payment secrets). Returns null on failure. */
async function loadPublicSettings(): Promise<PublicSettings | null> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("get_public_settings");
  if (error) return null;
  return normalizePublicSettings(data);
}

/**
 * Cached wrapper — public/anon settings are identical for every visitor and
 * change rarely, so a warm instance serves them from memory (admin edits show
 * within the TTL). Same call signature as before for all callers.
 */
export const fetchPublicSettings = cachedPublic("public-settings", 60_000, loadPublicSettings);

/** Full settings incl. payment — caller must already be an authorized admin. */
export async function fetchAdminSettings(actorId: string): Promise<AdminSettings | null> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("get_admin_settings", { p_actor: actorId });
  if (error) throwSettingsError(error);
  return normalizeAdminSettings(data);
}

/** Persist a settings patch (audited in the RPC). Returns the saved row. */
export async function saveSettings(
  patch: SettingsPatch,
  actorId: string,
): Promise<AdminSettings | null> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("save_settings", { p_patch: patch, p_actor: actorId });
  if (error) throwSettingsError(error);
  return normalizeAdminSettings(data);
}
