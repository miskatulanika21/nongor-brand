import { z } from "zod";
import { loginSchema, passwordSchema, privilegedPasswordSchema } from "@/lib/validation";
import type { Designation } from "@/lib/server/login-destination.server";
import { setResponseHeaders } from "@tanstack/react-start/server";

export { isSafeRedirect } from "@/lib/safe-redirect";

export async function setNoCacheHeaders(): Promise<void> {
  try {
    setResponseHeaders({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
    } as unknown as Headers);
  } catch {
    // Ignore error if called outside request context (e.g. in test environments)
  }
}

// ---- Login (unified for all designations) -----------------------------------

export async function performEmailLogin(data: z.infer<typeof loginSchema>) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, getClientIp, safeServerLog } =
    await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity, invalidateSession } =
    await import("@/lib/server/identity.server");
  const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");
  const { checkIndependentRateLimit, rateLimitMessage } =
    await import("@/lib/server/rate-limit.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  const rl = await checkIndependentRateLimit("login", { ip: getClientIp(), account: data.email });
  if (!rl.allowed) {
    return { success: false as const, error: rateLimitMessage() };
  }

  const supabase = createServerSupabaseClient();

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  if (authError) {
    safeServerLog("warn", "Login failed", { email: data.email });
    return { success: false as const, error: "Incorrect email or password." };
  }

  const result = await getAuthenticatedIdentity({ strict: true, client: supabase });

  if (!result.ok) {
    await invalidateSession(supabase);
    if (result.reason === "inactive_staff") {
      await writeAudit({
        action: "auth.login.denied",
        actorId: null,
        metadata: { reason: "inactive_staff", email: data.email },
      });
      return {
        success: false as const,
        error: "This staff account is inactive. Contact the account owner.",
      };
    }
    await writeAudit({
      action: "auth.login.denied",
      actorId: null,
      metadata: { reason: result.reason, email: data.email },
    });
    return {
      success: false as const,
      error: "We could not verify your account access. Please try again.",
    };
  }

  const identity = result.identity;
  const { destination, adminDenied } = resolvePostLoginDestination({
    identity,
    requestedNext: data.next,
  });

  if (identity.kind === "staff") {
    await writeAudit({
      action: "auth.login.success",
      actorId: identity.userId,
      metadata: { role: identity.role },
    });
  }

  return {
    success: true as const,
    destination,
    adminDenied,
    user: {
      designation: identity.kind === "staff" ? identity.role : ("customer" as Designation),
      hasAdminAccess: identity.kind === "staff",
    },
  };
}

// ---- Password Update (user is authenticated) --------------------------------

const passwordUpdateWithNextSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
    // Present for an authenticated change (re-auth); omitted in the recovery/
    // invite flow, which is gated server-side by a recovery marker cookie.
    currentPassword: z.string().max(200).optional(),
    next: z.string().max(2048).optional(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

// ---- Recovery / invite marker ----------------------------------------------
//
// Supabase JWT claims cannot reliably distinguish a recovery session from a
// normal one (a recovery sign-in records AMR method "otp", same as magic-link).
// So when /auth/confirm verifies a recovery- or invite-token we set a short-
// lived httpOnly marker cookie. performPasswordUpdate permits a NO-current-
// password change only when this marker is present; otherwise it requires and
// verifies the current password. A normal/hijacked authenticated session has no
// marker and cannot fabricate one (httpOnly + server-set), so it cannot silently
// take over the account via the password endpoint.
const PW_RECOVERY_COOKIE = "nz_pwreset";
const PW_RECOVERY_TTL_SEC = 15 * 60;

async function setRecoveryMarker(): Promise<void> {
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    const { isProduction } = await import("./env.server");
    setCookie(PW_RECOVERY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
      maxAge: PW_RECOVERY_TTL_SEC,
    });
  } catch {
    // Outside request context (tests) — ignore.
  }
}

async function hasRecoveryMarker(): Promise<boolean> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(PW_RECOVERY_COOKIE) === "1";
  } catch {
    return false;
  }
}

async function clearRecoveryMarker(): Promise<void> {
  try {
    const { deleteCookie } = await import("@tanstack/react-start/server");
    deleteCookie(PW_RECOVERY_COOKIE, { path: "/" });
  } catch {
    // Ignore.
  }
}

/**
 * Verify a password by attempting a sign-in on a THROWAWAY, non-persistent
 * client (never the request's cookie-bound client), so the live session is
 * untouched. Returns true iff the credentials are valid.
 */
async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const { getPublicSupabaseEnv } = await import("./env.server");
    const env = getPublicSupabaseEnv();
    const probe = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await probe.auth.signInWithPassword({ email, password });
    await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
    return !error;
  } catch {
    return false;
  }
}

export async function performPasswordUpdate(data: z.infer<typeof passwordUpdateWithNextSchema>) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, getClientIp, safeServerLog } =
    await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
  const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");
  const { checkIndependentRateLimit, rateLimitMessage } =
    await import("@/lib/server/rate-limit.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  const supabase = createServerSupabaseClient();

  const result = await getAuthenticatedIdentity({ strict: true, client: supabase });
  if (!result.ok) {
    return { success: false as const, error: "Please sign in again." };
  }
  const identity = result.identity;

  const rl = await checkIndependentRateLimit("passwordUpdate", {
    ip: getClientIp(),
    account: identity.userId,
  });
  if (!rl.allowed) {
    return { success: false as const, error: rateLimitMessage() };
  }

  if (identity.kind === "staff") {
    const check = privilegedPasswordSchema.safeParse(data.password);
    if (!check.success) {
      return {
        success: false as const,
        error: check.error.issues[0]?.message ?? "Password does not meet requirements.",
      };
    }
  }

  // F-11 — re-authentication gate. A no-current-password change is allowed ONLY
  // in a recovery/invite context (proven by the server-set marker cookie).
  // Otherwise this is a normal authenticated change and the current password
  // must be supplied and verified, so a hijacked session cannot silently take
  // over the account + lock the owner out.
  const viaRecovery = await hasRecoveryMarker();
  if (!viaRecovery) {
    const current = data.currentPassword?.trim();
    if (!current) {
      return { success: false as const, error: "Enter your current password to change it." };
    }
    if (!identity.email) {
      // No email to verify against (e.g. an OAuth-only account) — direct them to
      // the email reset flow rather than allowing an unverified change.
      return {
        success: false as const,
        error: "Use the password reset link to set a password for this account.",
      };
    }
    const ok = await verifyCurrentPassword(identity.email, current);
    if (!ok) {
      if (identity.kind === "staff") {
        await writeAudit({
          action: "auth.password_change.denied",
          actorId: identity.userId,
          metadata: { reason: "invalid_current_password", role: identity.role },
        });
      }
      return { success: false as const, error: "Your current password is incorrect." };
    }
  }

  const { error } = await supabase.auth.updateUser({ password: data.password });

  if (error) {
    safeServerLog("warn", "Password update failed", { userId: identity.userId });
    return { success: false as const, error: "Failed to update password. Please try again." };
  }

  // Consume the one-time recovery marker so it cannot be reused.
  if (viaRecovery) await clearRecoveryMarker();

  if (identity.kind === "staff") {
    await writeAudit({
      action: viaRecovery ? "auth.password_reset.completed" : "auth.password_changed",
      actorId: identity.userId,
      metadata: { role: identity.role },
    });
  }

  const { destination } = resolvePostLoginDestination({ identity, requestedNext: data.next });
  return { success: true as const, message: "Password updated successfully.", destination };
}

// ---- OAuth callback (PKCE code exchange) ------------------------------------

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  next: z.string().max(2048).optional(),
});

export async function performOAuthCallback(data: z.infer<typeof oauthCallbackSchema>) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { safeServerLog } = await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity, invalidateSession } =
    await import("@/lib/server/identity.server");
  const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(data.code);
  if (error) {
    safeServerLog("warn", "PKCE code exchange failed");
    return { success: false as const, redirect: null, error: "Sign-in failed. Please try again." };
  }

  const result = await getAuthenticatedIdentity({ strict: true, client: supabase });
  if (!result.ok) {
    await invalidateSession(supabase);
    if (result.reason === "inactive_staff") {
      await writeAudit({
        action: "auth.login.denied",
        actorId: null,
        metadata: { reason: "inactive_staff", via: "oauth" },
      });
      return { success: true as const, redirect: "/login?notice=inactive", error: null };
    }
    return { success: true as const, redirect: "/login?notice=verify", error: null };
  }

  const { destination } = resolvePostLoginDestination({
    identity: result.identity,
    requestedNext: data.next,
  });

  if (result.identity.kind === "staff") {
    await writeAudit({
      action: "auth.login.success",
      actorId: result.identity.userId,
      metadata: { role: result.identity.role, via: "oauth" },
    });
  }

  return { success: true as const, redirect: destination, error: null };
}

// ---- Token confirmation with destination resolution (OTP / magic link) ------

const authTokenConfirmSchema = z.object({
  token_hash: z.string().min(1).max(2048),
  type: z.enum(["email", "recovery", "magiclink", "invite"]),
  next: z.string().max(2048).optional(),
});

export async function performEmailConfirm(data: z.infer<typeof authTokenConfirmSchema>) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { safeServerLog } = await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
  const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");

  const supabase = createServerSupabaseClient();

  const { error } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: data.type,
  });

  if (error) {
    safeServerLog("warn", "Email confirmation failed", { type: data.type });
    return { success: false as const, type: data.type, destination: null };
  }

  if (data.type === "recovery" || data.type === "invite") {
    // Mark this session as recovery/invite-originated so the password endpoint
    // accepts a no-current-password set (F-11). The marker is short-lived and
    // consumed on a successful update.
    await setRecoveryMarker();
    const { isSafeRedirect } = await import("@/lib/safe-redirect");
    const safeNext = data.next && isSafeRedirect(data.next) ? data.next : undefined;
    const destination = safeNext
      ? `/auth/update-password?next=${encodeURIComponent(safeNext)}`
      : "/auth/update-password";
    return { success: true as const, type: data.type, destination };
  }

  const identity = await getAuthenticatedIdentity({ strict: true, client: supabase });
  if (!identity.ok) {
    return { success: true as const, type: data.type, destination: "/login" };
  }
  const { destination } = resolvePostLoginDestination({
    identity: identity.identity,
    requestedNext: data.next,
  });
  return { success: true as const, type: data.type, destination };
}
