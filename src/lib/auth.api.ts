/**
 * Auth API — createServerFn handlers callable from client routes.
 *
 * Lives OUTSIDE the server/ directory so route components can import it; the
 * handler() bodies execute exclusively on the server via RPC. Server-only
 * modules are imported inside handler closures so they never enter the client
 * bundle.
 *
 * Architecture:
 *   - One canonical loginWithEmail() for ALL users (customer/staff/admin/owner).
 *   - Identity resolution, role, and destination are decided server-side via
 *     the centralized identity + destination resolvers. The browser never
 *     supplies or influences a role.
 *   - loadCustomerArea()/loadAdminArea() are the route-guard server functions.
 *   - getSessionSummary() provides safe UI hints only (not authorization).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  loginSchema,
  registerSchema,
  resetRequestSchema,
  passwordSchema,
  authConfirmSchema,
} from "@/lib/validation";
import type { Designation } from "@/lib/server/login-destination.server";

/**
 * Safe redirect validation — re-exported from the canonical isomorphic
 * implementation so route files and the server-only resolver share one
 * set of rules.
 */
export { isSafeRedirect } from "@/lib/safe-redirect";

// ---- Login (unified for all designations) -----------------------------------

export const loginWithEmail = createServerFn({ method: "POST" })
  .validator(loginSchema)
  .handler(async ({ data }) => {
    const { performEmailLogin } = await import("@/lib/server/auth.server");
    return performEmailLogin(data);
  });

// ---- Register (always creates a customer) -----------------------------------

export const registerWithEmail = createServerFn({ method: "POST" })
  .validator(registerSchema)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const rl = await checkIndependentRateLimit("register", {
      ip: getClientIp(),
      account: data.email,
    });
    if (!rl.allowed) {
      return { success: false as const, error: rateLimitMessage() };
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { full_name: data.name, phone: data.phone },
        emailRedirectTo: `${env.siteUrl}/auth/confirm?type=email`,
      },
    });

    if (error) {
      safeServerLog("warn", "Registration failed", { email: data.email });
      return { success: false as const, error: "Registration could not be completed." };
    }

    return {
      success: true as const,
      message: "Account created! Check your email to confirm your account.",
    };
  });

// ---- Logout -----------------------------------------------------------------

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin } = await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  const before = await getAuthenticatedIdentity();
  if (before.ok && before.identity.kind === "staff") {
    await writeAudit({ action: "auth.logout", actorId: before.identity.userId });
  }

  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut();
  return { success: true as const };
});

// ---- Password Reset Request -------------------------------------------------

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator(resetRequestSchema)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { checkIndependentRateLimit } = await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const rl = await checkIndependentRateLimit("passwordReset", {
      ip: getClientIp(),
      account: data.email,
    });
    if (rl.allowed) {
      const supabase = createServerSupabaseClient();
      await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${env.siteUrl}/auth/confirm?type=recovery`,
      });
    }

    return {
      success: true as const,
      message: "If an account exists for that email, password reset instructions have been sent.",
    };
  });

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

export const updatePassword = createServerFn({ method: "POST" })
  .validator(passwordUpdateWithNextSchema)
  .handler(async ({ data }) => {
    const { performPasswordUpdate } = await import("@/lib/server/auth.server");
    return performPasswordUpdate(data);
  });

// ---- Email / token confirmation (OTP / token_hash) --------------------------

export const confirmEmail = createServerFn({ method: "POST" })
  .validator(authConfirmSchema)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { safeServerLog } = await import("@/lib/server/security.server");

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: data.type,
    });

    if (error) {
      safeServerLog("warn", "Email confirmation failed", { type: data.type });
      return { success: false as const, error: "Confirmation link is invalid or expired." };
    }

    return { success: true as const };
  });

// ---- OAuth callback (PKCE code exchange) ------------------------------------

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  next: z.string().max(2048).optional(),
});

export const completeOAuthCallback = createServerFn({ method: "POST" })
  .validator(oauthCallbackSchema)
  .handler(async ({ data }) => {
    const { performOAuthCallback } = await import("@/lib/server/auth.server");
    return performOAuthCallback(data);
  });

// ---- Token confirmation with destination resolution (OTP / magic link) ------

const authTokenConfirmSchema = z.object({
  token_hash: z.string().min(1).max(2048),
  type: z.enum(["email", "recovery", "magiclink", "invite"]),
  next: z.string().max(2048).optional(),
});

export const confirmAuthToken = createServerFn({ method: "POST" })
  .validator(authTokenConfirmSchema)
  .handler(async ({ data }) => {
    const { performEmailConfirm } = await import("@/lib/server/auth.server");
    return performEmailConfirm(data);
  });

// ---- OAuth start (Google / Facebook) ----------------------------------------

const oauthStartSchema = z.object({
  provider: z.enum(["google", "facebook"]),
  next: z.string().max(2048).optional(),
});

export const startOAuth = createServerFn({ method: "POST" })
  .validator(oauthStartSchema)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog, getTrustedRequestOrigin } =
      await import("@/lib/server/security.server");
    const { checkRateLimit, rateLimitMessage } = await import("@/lib/server/rate-limit.server");
    const { isSafeRedirect } = await import("@/lib/safe-redirect");
    const { isProviderConfigured } = await import("@/lib/server/env.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }
    if (!isProviderConfigured(data.provider)) {
      return { success: false as const, error: "This sign-in method is unavailable." };
    }

    const rl = await checkRateLimit("oauthStart", [getClientIp()]);
    if (!rl.allowed) {
      return { success: false as const, error: rateLimitMessage() };
    }

    const safeNext = data.next && isSafeRedirect(data.next) ? data.next : undefined;
    // Complete the flow on the SAME trusted origin the visitor is browsing:
    // the PKCE code-verifier cookie is domain-bound, so sending an allowed
    // alias-domain visitor to the canonical /auth/callback would drop it
    // mid-flow ("Sign-in failed"). Every allowed origin's /auth/callback must
    // be listed in the Supabase Auth redirect-URL allowlist.
    const callbackBase = getTrustedRequestOrigin(env.siteUrl) ?? env.siteUrl;
    const redirectTo = `${callbackBase}/auth/callback${
      safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""
    }`;

    const supabase = createServerSupabaseClient();
    const { data: oauth, error } = await supabase.auth.signInWithOAuth({
      provider: data.provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error || !oauth?.url) {
      safeServerLog("warn", "OAuth start failed", { provider: data.provider });
      return { success: false as const, error: "Unable to start sign-in. Please try again." };
    }

    return { success: true as const, url: oauth.url };
  });

// ---- Customer area guard (route beforeLoad) ---------------------------------

const guardSchema = z.object({
  next: z.string().max(2048).optional(),
  pathname: z.string().max(2048).optional(),
});

export const loadCustomerArea = createServerFn({ method: "GET" })
  .validator(guardSchema)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { requireCustomer, invalidateSession } = await import("@/lib/server/identity.server");
    const { isSafeRedirect } = await import("@/lib/safe-redirect");

    const result = await requireCustomer();
    if (result.ok) {
      return {
        allow: true as const,
        user: {
          userId: result.identity.userId,
          email: result.identity.email,
          name: result.identity.name,
        },
      };
    }

    if (result.reason === "is_staff") {
      return { allow: false as const, redirect: "/admin" };
    }
    if (result.reason === "inactive_staff") {
      await invalidateSession();
      return { allow: false as const, redirect: "/login?notice=inactive" };
    }
    if (result.reason === "lookup_failed") {
      return { allow: false as const, redirect: "/login?notice=verify" };
    }
    const next = data.next && isSafeRedirect(data.next) ? data.next : undefined;
    return {
      allow: false as const,
      redirect: next ? `/login?next=${encodeURIComponent(next)}` : "/login",
    };
  });

// ---- Admin area guard (route beforeLoad) ------------------------------------

export const loadAdminArea = createServerFn({ method: "GET" })
  .validator(guardSchema)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { requireStaff, invalidateSession } = await import("@/lib/server/identity.server");
    const { isSafeRedirect } = await import("@/lib/safe-redirect");
    const { navForRole, roleCanAccessAdminPath } = await import("@/lib/admin-routes");
    const { mfaGate } = await import("@/lib/server/mfa.server");
    const { isAdminMfaEnforced } = await import("@/lib/server/env.server");

    const result = await requireStaff();

    if (!result.ok) {
      if (result.reason === "is_customer") {
        return { allow: false as const, redirect: "/account?notice=denied" };
      }
      if (result.reason === "inactive_staff") {
        await invalidateSession();
        return { allow: false as const, redirect: "/login?notice=inactive" };
      }
      if (result.reason === "lookup_failed") {
        return { allow: false as const, redirect: "/login?notice=verify" };
      }
      const next = data.next && isSafeRedirect(data.next) ? data.next : data.pathname;
      const safeNext = next && isSafeRedirect(next) ? next : undefined;
      return {
        allow: false as const,
        redirect: safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login",
      };
    }

    const identity = result.identity;
    const pathname = data.pathname ?? "/admin";

    if (isAdminMfaEnforced() && pathname !== "/admin/mfa") {
      const outcome = await mfaGate(identity.role);
      if (outcome !== "ok") {
        return { allow: false as const, redirect: "/admin/mfa" };
      }
    }

    if (pathname !== "/admin" && !roleCanAccessAdminPath(identity.role, pathname)) {
      return { allow: false as const, redirect: "/admin?notice=permission" };
    }

    return {
      allow: true as const,
      staff: {
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        role: identity.role,
      },
      nav: navForRole(identity.role),
    };
  });

// ---- Session Summary (header/menu UI hint only) -----------------------------

export const getSessionSummary = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
  await setNoCacheHeaders();
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");

  const result = await getAuthenticatedIdentity();
  if (!result.ok) {
    return {
      isAuthenticated: false as const,
      designation: "customer" as Designation,
      hasAdminAccess: false,
      userId: null as string | null,
    };
  }

  const identity = result.identity;
  return {
    isAuthenticated: true as const,
    designation: (identity.kind === "staff" ? identity.role : "customer") as Designation,
    hasAdminAccess: identity.kind === "staff",
    // The caller's own id (not secret) — used client-side only to partition this
    // user's device-stored orders from any other account on a shared browser.
    userId: identity.userId,
  };
});

// ---- Authenticated destination resolver (for /login beforeLoad) -------------

export const resolveAuthenticatedDestination = createServerFn({ method: "GET" })
  .validator((data: { next?: string }) => data)
  .handler(async ({ data }) => {
    const { setNoCacheHeaders } = await import("@/lib/server/auth.server");
    await setNoCacheHeaders();
    const { getAuthenticatedIdentity, invalidateSession } =
      await import("@/lib/server/identity.server");
    const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");

    const result = await getAuthenticatedIdentity();
    if (!result.ok) {
      if (result.reason === "inactive_staff") await invalidateSession();
      return { authenticated: false as const, destination: null };
    }

    const { destination } = resolvePostLoginDestination({
      identity: result.identity,
      requestedNext: data.next,
    });

    return {
      authenticated: true as const,
      destination,
      hasAdminAccess: result.identity.kind === "staff",
    };
  });
