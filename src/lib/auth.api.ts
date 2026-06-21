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
 *
 * Identity validation rules:
 *   - getClaims()  → routine identity checks (no network call)
 *   - getUser()    → high-risk ops (password changes, staff mutations, login)
 *   - getSession() → NEVER used as sole server-side authorization authority
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  loginSchema,
  registerSchema,
  resetRequestSchema,
  passwordUpdateSchema,
  authConfirmSchema,
} from "@/lib/validation";
import type { Designation } from "@/lib/server/login-destination.server";

/**
 * Safe redirect validation — re-exported from the canonical isomorphic
 * implementation so route files and the server-only resolver share one
 * set of rules.
 */
export { isSafeRedirect } from "@/lib/safe-redirect";

async function setNoCacheHeaders(): Promise<void> {
  try {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
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

/**
 * One canonical login for customers, staff, admins and owners.
 *
 * Flow: rate-limit → authenticate → resolve verified identity → handle
 * inactive/lookup-failure (deny + sign out + fail closed) → resolve
 * destination → audit privileged success. The browser never picks a role.
 */
/**
 * Core password-login transaction (extracted so it is unit-testable; the
 * createServerFn wrapper cannot be invoked directly outside the server runtime).
 *
 * Same-request correctness: the SAME client that runs signInWithPassword is
 * threaded into identity resolution and the denial sign-out, because the
 * freshly-issued session is not yet in the incoming request cookies a fresh
 * client would read.
 */
export async function performEmailLogin(data: z.infer<typeof loginSchema>) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, getClientIp, safeServerLog } =
    await import("@/lib/server/security.server");
  const { getAuthenticatedIdentity, invalidateSession } =
    await import("@/lib/server/identity.server");
  const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");
  const { checkRateLimit, rateLimitMessage } = await import("@/lib/server/rate-limit.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  // Rate limit by IP + normalized email before touching credentials.
  const rl = await checkRateLimit("login", [getClientIp(), data.email]);
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

  // Verify identity with getUser() (strict) since this is the trust anchor.
  // Reuse the just-authenticated client so resolution sees this session.
  const result = await getAuthenticatedIdentity({ strict: true, client: supabase });

  if (!result.ok) {
    // Deny: never leave a partial privileged session around. Clear the session
    // we just created via the SAME client.
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
    // lookup_failed / unauthenticated → fail closed with a safe message.
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

export const loginWithEmail = createServerFn({ method: "POST" })
  .validator(loginSchema)
  .handler(async ({ data }) => performEmailLogin(data));

// ---- Register (always creates a customer) -----------------------------------

export const registerWithEmail = createServerFn({ method: "POST" })
  .validator(registerSchema)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { checkRateLimit, rateLimitMessage } = await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const rl = await checkRateLimit("register", [getClientIp(), data.email]);
    if (!rl.allowed) {
      return { success: false as const, error: rateLimitMessage() };
    }

    // Public signup NEVER creates a privileged account. Only full_name + phone
    // go into user_metadata; any role-like fields in the payload are ignored
    // (the schema does not accept them, and no staff_profile is created here).
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
      // Generic — never reveal whether the email already exists or is privileged.
      return { success: false as const, error: "Registration could not be completed." };
    }

    return {
      success: true as const,
      message: "Account created! Check your email to confirm your account.",
    };
  });

// ---- Logout -----------------------------------------------------------------

export const logout = createServerFn({ method: "POST" }).handler(async () => {
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

  // Best-effort audit for privileged logout before clearing the session.
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
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { checkRateLimit } = await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    // Rate-limit but ALWAYS return the same generic message regardless of
    // whether the account exists or the limit was hit (no enumeration).
    const rl = await checkRateLimit("passwordReset", [getClientIp(), data.email]);
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

export const updatePassword = createServerFn({ method: "POST" })
  .validator(passwordUpdateSchema)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
    const { checkRateLimit, rateLimitMessage } = await import("@/lib/server/rate-limit.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    const { passwordSchema, privilegedPasswordSchema } = await import("@/lib/validation");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    // High-risk: resolve verified identity (getUser) and fail closed on denial.
    const result = await getAuthenticatedIdentity({ strict: true });
    if (!result.ok) {
      return { success: false as const, error: "Please sign in again." };
    }
    const identity = result.identity;

    const rl = await checkRateLimit("passwordUpdate", [getClientIp(), identity.userId]);
    if (!rl.allowed) {
      return { success: false as const, error: rateLimitMessage() };
    }

    // Privileged accounts must meet the stronger password policy.
    const schema = identity.kind === "staff" ? privilegedPasswordSchema : passwordSchema;
    const check = schema.safeParse(data.password);
    if (!check.success) {
      return {
        success: false as const,
        error: check.error.issues[0]?.message ?? "Password does not meet requirements.",
      };
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) {
      safeServerLog("warn", "Password update failed", { userId: identity.userId });
      return { success: false as const, error: "Failed to update password. Please try again." };
    }

    if (identity.kind === "staff") {
      await writeAudit({
        action: "auth.password_reset.completed",
        actorId: identity.userId,
        metadata: { role: identity.role },
      });
    }

    return { success: true as const, message: "Password updated successfully." };
  });

// ---- Email / token confirmation (OTP / token_hash) --------------------------

export const confirmEmail = createServerFn({ method: "POST" })
  .validator(authConfirmSchema)
  .handler(async ({ data }) => {
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

/**
 * Core OAuth callback transaction (extracted for unit-testability).
 *
 * Exchanges the PKCE code for a session, then resolves the destination through
 * the SAME centralized identity + destination resolvers as password login —
 * reusing the code-exchange client so resolution and the denial sign-out see
 * the just-issued session. OAuth never grants a role; role comes only from a
 * staff_profiles row matched by the authenticated user id.
 */
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

  // Same identity resolution as password login — fail closed, same client.
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

export const completeOAuthCallback = createServerFn({ method: "POST" })
  .validator(oauthCallbackSchema)
  .handler(async ({ data }) => performOAuthCallback(data));

// ---- Token confirmation with destination resolution (OTP / magic link) ------

const authTokenConfirmSchema = z.object({
  token_hash: z.string().min(1).max(2048),
  type: z.enum(["email", "recovery", "magiclink"]),
  next: z.string().max(2048).optional(),
});

/**
 * Core email/magic-link/recovery confirmation transaction (extracted for
 * unit-testability).
 *
 * Verifies the OTP token_hash, then for email/magic-link resolves the
 * destination via the SAME resolver — reusing the verification client so the
 * just-established session is visible. Recovery returns the password-update
 * destination without resolving identity (the role-aware redirect there is a
 * later phase's concern).
 */
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

  // Recovery always routes to the password-update screen.
  if (data.type === "recovery") {
    return { success: true as const, type: data.type, destination: "/account/update-password" };
  }

  // Email confirmation / magic link: a verified user now has a session. Resolve
  // the destination via the SAME resolver, reusing the verification client.
  const identity = await getAuthenticatedIdentity({ strict: true, client: supabase });
  if (!identity.ok) {
    // Verified but session not established — send to login to sign in.
    return { success: true as const, type: data.type, destination: "/login" };
  }
  const { destination } = resolvePostLoginDestination({
    identity: identity.identity,
    requestedNext: data.next,
  });
  return { success: true as const, type: data.type, destination };
}

export const confirmAuthToken = createServerFn({ method: "POST" })
  .validator(authTokenConfirmSchema)
  .handler(async ({ data }) => performEmailConfirm(data));

// ---- OAuth start (Google / Facebook) ----------------------------------------

const oauthStartSchema = z.object({
  provider: z.enum(["google", "facebook"]),
  next: z.string().max(2048).optional(),
});

/**
 * Begin a Supabase OAuth flow. Validates that the provider is enabled and the
 * `next` route is safe, then returns the provider authorization URL for the
 * browser to navigate to. Supabase JS manages PKCE/state. The callback returns
 * to /auth/callback where the SAME identity + destination resolvers run.
 */
export const startOAuth = createServerFn({ method: "POST" })
  .validator(oauthStartSchema)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
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

    // Preserve only a sanitized internal next route.
    const safeNext = data.next && isSafeRedirect(data.next) ? data.next : undefined;
    const redirectTo = `${env.siteUrl}/auth/callback${
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

/**
 * Server guard for customer-private routes. Returns either an allow result
 * with safe display data, or a redirect target. All denial branches are
 * enforced here (spec §11):
 *   unauthenticated → /login?next=...
 *   active staff    → /admin
 *   inactive staff  → sign out → /login?notice=inactive
 *   lookup failure  → fail closed → /login?notice=verify
 */
export const loadCustomerArea = createServerFn({ method: "GET" })
  .validator(guardSchema)
  .handler(async ({ data }) => {
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
    // unauthenticated
    const next = data.next && isSafeRedirect(data.next) ? data.next : undefined;
    return {
      allow: false as const,
      redirect: next ? `/login?next=${encodeURIComponent(next)}` : "/login",
    };
  });

// ---- Admin area guard (route beforeLoad) ------------------------------------

/**
 * Server guard for /admin/* routes. Returns allow + role-filtered nav + safe
 * staff display + MFA outcome, or a redirect target (spec §12, §16, §26):
 *   unauthenticated → /login?next=...
 *   customer        → /account (generic access-denied)
 *   inactive staff  → sign out → /login?notice=inactive
 *   lookup failure  → fail closed → /login?notice=verify
 *   role lacks page permission → /admin
 *   MFA required & not satisfied (when enforced) → /admin/mfa
 */
export const loadAdminArea = createServerFn({ method: "GET" })
  .validator(guardSchema)
  .handler(async ({ data }) => {
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

    // MFA enforcement (when turned on for the deployment).
    if (isAdminMfaEnforced() && pathname !== "/admin/mfa") {
      const outcome = await mfaGate(identity.role);
      if (outcome !== "ok") {
        return { allow: false as const, redirect: "/admin/mfa" };
      }
    }

    // Per-page permission check. The parent /admin landing always passes
    // (dashboard.view); sub-pages require their specific permission.
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

/**
 * Minimal authenticated session summary for header/menu presentation.
 * NOT authorization. Inactive staff and lookup failures resolve to a
 * logged-out hint so the header never implies privileged access.
 */
export const getSessionSummary = createServerFn({ method: "GET" }).handler(async () => {
  await setNoCacheHeaders();
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");

  const result = await getAuthenticatedIdentity();
  if (!result.ok) {
    return {
      isAuthenticated: false as const,
      designation: "customer" as Designation,
      hasAdminAccess: false,
    };
  }

  const identity = result.identity;
  return {
    isAuthenticated: true as const,
    designation: (identity.kind === "staff" ? identity.role : "customer") as Designation,
    hasAdminAccess: identity.kind === "staff",
  };
});

// ---- Authenticated destination resolver (for /login beforeLoad) -------------

/**
 * Resolve where an already-authenticated user visiting /login should go.
 * Denies inactive staff (signs them out) and fails closed on lookup errors
 * so the login form renders instead of looping.
 */
export const resolveAuthenticatedDestination = createServerFn({ method: "GET" })
  .validator((data: { next?: string }) => data)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { getAuthenticatedIdentity, invalidateSession } =
      await import("@/lib/server/identity.server");
    const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");

    const result = await getAuthenticatedIdentity();
    if (!result.ok) {
      // Inactive staff lingering with a session: sign them out so they can't
      // bounce around. Either way, show the login form.
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
