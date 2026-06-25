/**
 * Site settings API — createServerFn handlers.
 *
 *   - getPublicSettings  → storefront (anon; no payment secrets; null on failure)
 *   - loadAdminSettings  → admin settings page (requires `settings.manage`)
 *   - saveSettings       → admin write via guardAdminWrite (CSRF + permission +
 *                          MFA step-up + rate limit + denial audit). The
 *                          canonical settings.updated audit is in the api.* RPC.
 *
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as reviews-admin.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { settingsSaveSchema } from "@/lib/settings.schema";

async function messageFromSettingsError(e: unknown): Promise<string> {
  const { SettingsError } = await import("@/lib/server/settings.server");
  const { settingsErrorMessage } = await import("@/lib/settings.schema");
  if (e instanceof SettingsError) return settingsErrorMessage(e.code);
  return "Could not save settings. Please try again.";
}

export const getPublicSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchPublicSettings } = await import("@/lib/server/settings.server");
  return fetchPublicSettings();
});

export const loadAdminSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("settings.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", settings: null };
  const { fetchAdminSettings } = await import("@/lib/server/settings.server");
  try {
    return { success: true as const, settings: await fetchAdminSettings(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load settings.", settings: null };
  }
});

export const saveSettings = createServerFn({ method: "POST" })
  .validator(settingsSaveSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("settings.manage", "saveSettings");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/settings.server");
    try {
      const settings = await repo.saveSettings(data, g.actorId);
      return { success: true as const, settings };
    } catch (e) {
      return { success: false as const, error: await messageFromSettingsError(e) };
    }
  });
