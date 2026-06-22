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
 */
export const startMfaEnrollment = createServerFn({ method: "POST" }).handler(async () => {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, safeServerLog } = await import("@/lib/server/security.server");
  const { requireStaff } = await import("@/lib/server/identity.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  // Only privileged accounts enroll through the admin MFA flow.
  const staff = await requireStaff({ strict: true });
  if (!staff.ok) {
    return { success: false as const, error: "Not authorized." };
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `nongorr-${Date.now()}`,
  });

  if (error || !data) {
    safeServerLog("warn", "MFA enrollment start failed", {
      code: (error as { code?: string } | null)?.code ?? "unknown",
    });
    return {
      success: false as const,
      error: "Could not start MFA setup. Ensure MFA is enabled for this project.",
    };
  }

  return {
    success: true as const,
    factorId: data.id,
    qrCode: data.totp?.qr_code ?? null,
    uri: data.totp?.uri ?? null,
    secret: data.totp?.secret ?? null,
  };
});

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

export const unenrollMfa = createServerFn({ method: "POST" })
  .validator(unenrollSchema)
  .handler(async ({ data }) => {
    await setNoCacheHeaders();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin } = await import("@/lib/server/security.server");
    const { requireStaff } = await import("@/lib/server/identity.server");
    const { mfaRequiredForRole } = await import("@/lib/server/mfa.server");
    const { writeAudit } = await import("@/lib/server/audit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    // High-risk: verify with getUser().
    const staff = await requireStaff({ strict: true });
    if (!staff.ok) return { success: false as const, error: "Not authorized." };

    const supabase = createServerSupabaseClient();

    // If MFA is mandatory for this role, only allow removal when another
    // verified factor remains (so the account never drops below the policy).
    if (mfaRequiredForRole(staff.identity.role)) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
      if (verified.length <= 1) {
        return {
          success: false as const,
          error:
            "MFA is required for your role. Add another authenticator before removing this one.",
        };
      }
    }

    const { error } = await supabase.auth.mfa.unenroll({ factorId: data.factorId });
    if (error) {
      return { success: false as const, error: "Could not remove this authenticator." };
    }

    await writeAudit({
      action: "mfa.removed",
      actorId: staff.identity.userId,
      targetType: "mfa_factor",
      targetId: data.factorId,
    });
    return { success: true as const };
  });
