/**
 * MFA server functions — client-callable via createServerFn RPC.
 *
 * Wraps Supabase TOTP MFA (enroll → verify → challenge). Lives outside the
 * server/ directory (like auth.api.ts) so route components can import it; the
 * handler bodies execute server-side only.
 *
 * Sensitive (state-changing) calls verify CSRF origin. Tokens/secrets are
 * never logged. (Spec §26.)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function setNoCacheHeaders(): Promise<void> {
  try {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
    } as unknown as Headers);
  } catch {
    // Outside request context (tests) — ignore.
  }
}

// ---- Status -----------------------------------------------------------------

export const getMfaState = createServerFn({ method: "GET" }).handler(async () => {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const supabase = createServerSupabaseClient();

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factors } = await supabase.auth.mfa.listFactors();

  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
  return {
    currentLevel: (aal?.currentLevel as string | null) ?? "aal1",
    nextLevel: (aal?.nextLevel as string | null) ?? "aal1",
    enrolledFactors: verified.map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null })),
  };
});

// ---- Enroll -----------------------------------------------------------------

/**
 * Begin TOTP enrollment. Returns the otpauth URI + secret for QR display.
 * The factor is unverified until verifyMfaEnrollment() succeeds.
 *
 * Hardening:
 *   - CSRF + strict staff identity.
 *   - Independent per-IP and per-account rate limit on initiation.
 *   - If the account already has a VERIFIED factor, require a current AAL2
 *     session before another factor may be added (an aal1 session — e.g. a
 *     hijacked first-factor session — must not be able to attach a new factor).
 *   - Clean up stale UNVERIFIED factors first so repeated initiations cannot
 *     accumulate unbounded factors.
 *   - Audit initiation / denial / failure. NEVER log or audit the TOTP secret
 *     or QR payload.
 *
 * Extracted as a plain function so it is unit-testable with mocked modules; the
 * createServerFn handler just delegates.
 */
export async function performStartMfaEnrollment() {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, getClientIp, safeServerLog } =
    await import("@/lib/server/security.server");
  const { requireStaff } = await import("@/lib/server/identity.server");
  const { checkIndependentRateLimit, rateLimitMessage } =
    await import("@/lib/server/rate-limit.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  // Only privileged accounts enroll through the admin MFA flow.
  const staff = await requireStaff({ strict: true });
  if (!staff.ok) {
    return { success: false as const, error: "Not authorized." };
  }
  const actorId = staff.identity.userId;

  // Rate-limit initiation per IP and per account.
  const rl = await checkIndependentRateLimit("mfaEnroll", { ip: getClientIp(), account: actorId });
  if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

  const supabase = createServerSupabaseClient();

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    safeServerLog("warn", "MFA enrollment: listFactors failed", {
      code: (listError as { code?: string } | null)?.code ?? "unknown",
    });
    await writeAudit({ action: "mfa.enroll.failed", actorId, metadata: { stage: "list" } });
    return { success: false as const, error: "Could not start MFA setup. Please try again." };
  }

  // `data.totp` is the SDK's convenience list of VERIFIED TOTP factors; `data.all`
  // contains every factor (incl. unverified), which we need for cleanup.
  const verifiedTotp = factors?.totp ?? [];
  const allFactors = factors?.all ?? [];

  // Adding a factor when one is already verified requires AAL2.
  if (verifiedTotp.length > 0) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (((aal?.currentLevel as string | null) ?? "aal1") !== "aal2") {
      await writeAudit({
        action: "mfa.enroll.denied",
        actorId,
        metadata: { reason: "aal2_required" },
      });
      return {
        success: false as const,
        requiresAal2: true as const,
        error: "Verify your existing authenticator first, then add another.",
      };
    }
  }

  // Remove stale UNVERIFIED totp factors so repeated initiations don't pile up.
  for (const f of allFactors.filter((x) => x.factor_type === "totp" && x.status === "unverified")) {
    await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `nongorr-${Date.now()}`,
  });

  if (error || !data) {
    safeServerLog("warn", "MFA enrollment start failed", {
      code: (error as { code?: string } | null)?.code ?? "unknown",
    });
    await writeAudit({ action: "mfa.enroll.failed", actorId, metadata: { stage: "enroll" } });
    return {
      success: false as const,
      error: "Could not start MFA setup. Ensure MFA is enabled for this project.",
    };
  }

  // Audit initiation WITHOUT any secret/QR material.
  await writeAudit({ action: "mfa.enroll.started", actorId, metadata: { factorId: data.id } });

  return {
    success: true as const,
    factorId: data.id,
    qrCode: data.totp?.qr_code ?? null,
    uri: data.totp?.uri ?? null,
    secret: data.totp?.secret ?? null,
  };
}

export const startMfaEnrollment = createServerFn({ method: "POST" }).handler(async () =>
  performStartMfaEnrollment(),
);

// ---- Verify enrollment ------------------------------------------------------

const verifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().min(6).max(10),
});

export const verifyMfaEnrollment = createServerFn({ method: "POST" })
  .validator(verifySchema)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { requireStaff } = await import("@/lib/server/identity.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");
    const { writeAudit } = await import("@/lib/server/audit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const staff = await requireStaff({ strict: true });
    if (!staff.ok) return { success: false as const, error: "Not authorized." };

    const rl = await checkIndependentRateLimit("mfaVerify", {
      ip: getClientIp(),
      account: staff.identity.userId,
    });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const supabase = createServerSupabaseClient();
    const { error: challengeError, data: challenge } = await supabase.auth.mfa.challenge({
      factorId: data.factorId,
    });
    if (challengeError || !challenge) {
      return { success: false as const, error: "Verification failed. Please try again." };
    }

    const { error } = await supabase.auth.mfa.verify({
      factorId: data.factorId,
      challengeId: challenge.id,
      code: data.code,
    });

    if (error) {
      await writeAudit({
        action: "mfa.challenge.failed",
        actorId: staff.identity.userId,
        targetType: "mfa_factor",
        targetId: data.factorId,
        metadata: { phase: "enrollment" },
      });
      safeServerLog("warn", "MFA enrollment verify failed", { userId: staff.identity.userId });
      return { success: false as const, error: "Incorrect code. Please try again." };
    }

    await writeAudit({
      action: "mfa.enrolled",
      actorId: staff.identity.userId,
      targetType: "mfa_factor",
      targetId: data.factorId,
    });
    return { success: true as const };
  });

// ---- Challenge (step-up an existing factor to aal2) -------------------------

export const challengeMfa = createServerFn({ method: "POST" })
  .validator(verifySchema)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { requireStaff } = await import("@/lib/server/identity.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");
    const { writeAudit } = await import("@/lib/server/audit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const staff = await requireStaff();
    if (!staff.ok) return { success: false as const, error: "Not authorized." };

    const rl = await checkIndependentRateLimit("mfaVerify", {
      ip: getClientIp(),
      account: staff.identity.userId,
    });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const supabase = createServerSupabaseClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: data.factorId,
    });
    if (challengeError || !challenge) {
      return { success: false as const, error: "Verification failed. Please try again." };
    }

    const { error } = await supabase.auth.mfa.verify({
      factorId: data.factorId,
      challengeId: challenge.id,
      code: data.code,
    });

    if (error) {
      await writeAudit({
        action: "mfa.challenge.failed",
        actorId: staff.identity.userId,
        targetType: "mfa_factor",
        targetId: data.factorId,
      });
      safeServerLog("warn", "MFA challenge failed", { userId: staff.identity.userId });
      return { success: false as const, error: "Incorrect code. Please try again." };
    }

    await writeAudit({
      action: "mfa.challenge.success",
      actorId: staff.identity.userId,
      targetType: "mfa_factor",
      targetId: data.factorId,
    });
    return { success: true as const };
  });

// ---- Unenroll ---------------------------------------------------------------

const unenrollSchema = z.object({ factorId: z.string().min(1) });

/**
 * Remove a verified TOTP factor.
 *
 * Hardening (F-10):
 *   - CSRF + strict staff identity (getUser).
 *   - Rate-limited (this was the ONLY MFA op without a limit).
 *   - **Requires a current AAL2 session.** Removing a factor lowers account
 *     security, so — mirroring the enrollment path, which already requires AAL2
 *     to ADD a factor when one exists — a first-factor-only (aal1) session, e.g.
 *     a hijacked password, must not be able to STRIP MFA. The caller already
 *     holds a verified factor, so it can step up via challengeMfa and retry.
 *   - Policy backstop: for MFA-mandatory roles, never drop below one factor.
 *   - Audit removal and AAL2 denial.
 *
 * Extracted as a plain function so it is unit-testable with mocked modules.
 */
export async function performUnenrollMfa(data: z.infer<typeof unenrollSchema>) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
  const { requireStaff } = await import("@/lib/server/identity.server");
  const { mfaRequiredForRole } = await import("@/lib/server/mfa.server");
  const { checkIndependentRateLimit, rateLimitMessage } =
    await import("@/lib/server/rate-limit.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  // High-risk: verify with getUser().
  const staff = await requireStaff({ strict: true });
  if (!staff.ok) return { success: false as const, error: "Not authorized." };
  const actorId = staff.identity.userId;

  const rl = await checkIndependentRateLimit("mfaManage", { ip: getClientIp(), account: actorId });
  if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

  const supabase = createServerSupabaseClient();

  // Require an AAL2 session to remove a factor (step-up the existing one first).
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (((aal?.currentLevel as string | null) ?? "aal1") !== "aal2") {
    await writeAudit({
      action: "mfa.remove.denied",
      actorId,
      targetType: "mfa_factor",
      targetId: data.factorId,
      metadata: { reason: "aal2_required" },
    });
    return {
      success: false as const,
      requiresAal2: true as const,
      error: "Verify your authenticator first, then remove a device.",
    };
  }

  // If MFA is mandatory for this role, only allow removal when another
  // verified factor remains (so the account never drops below the policy).
  if (mfaRequiredForRole(staff.identity.role)) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
    if (verified.length <= 1) {
      return {
        success: false as const,
        error: "MFA is required for your role. Add another authenticator before removing this one.",
      };
    }
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: data.factorId });
  if (error) {
    return { success: false as const, error: "Could not remove this authenticator." };
  }

  await writeAudit({
    action: "mfa.removed",
    actorId,
    targetType: "mfa_factor",
    targetId: data.factorId,
  });
  return { success: true as const };
}

export const unenrollMfa = createServerFn({ method: "POST" })
  .validator(unenrollSchema)
  .handler(async ({ data }) => performUnenrollMfa(data));
