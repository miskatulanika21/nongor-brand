/**
 * Session-scoped account-security operations — SERVER ONLY.
 *
 * These run against the request's cookie-bound (session) Supabase client — the
 * signed-in customer acts on their OWN account only. Each entry point enforces
 * CSRF + a verified session before touching auth. Connected-login (identity)
 * linking mirrors the OAuth sign-in pattern in auth.api.ts (server starts the
 * flow with skipBrowserRedirect, returns the URL, the browser navigates).
 *
 * Note: identity linking requires "Manual linking" to be enabled in the
 * Supabase Auth settings, and only providers configured for the project can be
 * linked — we surface both honestly rather than showing a dead button.
 */

export interface ConnectedIdentity {
  /** Stable per-identity id used to unlink. */
  identityId: string;
  provider: "email" | "google" | "facebook" | string;
  email: string | null;
  createdAt: string | null;
}

export interface ConnectedIdentitiesResult {
  identities: ConnectedIdentity[];
  /** OAuth providers that are configured for this project (linkable). */
  configured: Array<"google" | "facebook">;
  /** True when the account also has an email/password identity. */
  hasPassword: boolean;
}

async function sessionContext() {
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin } = await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { ok: false as const, error: "Invalid request origin." };
  }
  const supabase = createServerSupabaseClient();
  const result = await getAuthenticatedIdentity({ strict: true, client: supabase });
  if (!result.ok) {
    return { ok: false as const, error: "Please sign in again." };
  }
  return { ok: true as const, supabase, identity: result.identity, env };
}

/** Revoke every session for the current user (all devices). */
export async function performSignOutEverywhere() {
  const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
  await setNoCacheHeaders();
  const ctx = await sessionContext();
  if (!ctx.ok) return { success: false as const, error: ctx.error };

  const { error } = await ctx.supabase.auth.signOut({ scope: "global" });
  if (error) {
    return { success: false as const, error: "Couldn't sign out other sessions. Try again." };
  }
  return { success: true as const };
}

/** List the current user's connected identities + which providers are linkable. */
export async function listConnectedIdentities(): Promise<
  { success: true; data: ConnectedIdentitiesResult } | { success: false; error: string }
> {
  const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
  await setNoCacheHeaders();
  const ctx = await sessionContext();
  if (!ctx.ok) return { success: false as const, error: ctx.error };

  const { isProviderConfigured } = await import("@/lib/server/env.server");
  const { data, error } = await ctx.supabase.auth.getUserIdentities();
  if (error) {
    return { success: false as const, error: "Couldn't load connected accounts." };
  }

  const identities: ConnectedIdentity[] = (data?.identities ?? []).map((i) => ({
    identityId: i.identity_id ?? i.id,
    provider: i.provider,
    email: (typeof i.identity_data?.email === "string" ? i.identity_data.email : null) ?? null,
    createdAt: i.created_at ?? null,
  }));

  const configured = (["google", "facebook"] as const).filter((p) => isProviderConfigured(p));
  const hasPassword = identities.some((i) => i.provider === "email");

  return { success: true as const, data: { identities, configured, hasPassword } };
}

/** Begin linking an OAuth identity to the current account (returns redirect URL). */
export async function performStartIdentityLink(data: { provider: "google" | "facebook" }) {
  const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
  await setNoCacheHeaders();
  const ctx = await sessionContext();
  if (!ctx.ok) return { success: false as const, error: ctx.error };

  const { isProviderConfigured } = await import("@/lib/server/env.server");
  const { getClientIp, safeServerLog, getTrustedRequestOrigin } =
    await import("@/lib/server/security.server");
  const { checkRateLimit, rateLimitMessage } = await import("@/lib/server/rate-limit.server");

  if (!isProviderConfigured(data.provider)) {
    return { success: false as const, error: "This sign-in method is unavailable." };
  }
  const rl = await checkRateLimit("oauthStart", [getClientIp()]);
  if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

  const callbackBase = getTrustedRequestOrigin(ctx.env.siteUrl) ?? ctx.env.siteUrl;
  const redirectTo = `${callbackBase}/auth/callback?next=${encodeURIComponent("/account/security")}`;

  const { data: link, error } = await ctx.supabase.auth.linkIdentity({
    provider: data.provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !link?.url) {
    // Manual linking disabled in the project, or provider misconfigured.
    safeServerLog("warn", "Identity link start failed", { provider: data.provider });
    return {
      success: false as const,
      error: "Couldn't start linking. This may need to be enabled by the store owner.",
    };
  }
  return { success: true as const, url: link.url };
}

/** Unlink a connected identity by its identity id. */
export async function performUnlinkIdentity(data: { identityId: string }) {
  const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
  await setNoCacheHeaders();
  const ctx = await sessionContext();
  if (!ctx.ok) return { success: false as const, error: ctx.error };

  const { data: identData, error: listErr } = await ctx.supabase.auth.getUserIdentities();
  if (listErr || !identData?.identities) {
    return { success: false as const, error: "Couldn't load connected accounts." };
  }
  const identities = identData.identities;
  const target = identities.find((i) => (i.identity_id ?? i.id) === data.identityId);
  if (!target) {
    return { success: false as const, error: "That connection was already removed." };
  }
  // Never leave the account with no way to sign in.
  const hasPassword = identities.some((i) => i.provider === "email");
  if (identities.length <= 1 && !hasPassword) {
    return {
      success: false as const,
      error: "Set a password first — this is your only sign-in method.",
    };
  }

  const { error } = await ctx.supabase.auth.unlinkIdentity(target);
  if (error) {
    return { success: false as const, error: "Couldn't disconnect that account. Try again." };
  }
  return { success: true as const };
}
