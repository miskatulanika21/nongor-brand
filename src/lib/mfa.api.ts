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

// Server-only operations (enrollment start / unenroll) live in
// mfa-ops.server.ts and are imported dynamically INSIDE handler closures —
// this module is in the client graph, so it must not reference server-only
// modules at module scope (dev import-protection).

// ---- Status -----------------------------------------------------------------

export const getMfaState = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStoreStrict } = await import("@/lib/server/admin-guard.server");
  await setNoStoreStrict();
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

// Logic lives in mfa-ops.server.ts (server-only); the handler delegates.
export const startMfaEnrollment = createServerFn({ method: "POST" }).handler(async () => {
  const { performStartMfaEnrollment } = await import("@/lib/server/mfa-ops.server");
  return performStartMfaEnrollment();
});

// ---- Verify enrollment ------------------------------------------------------

const verifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().min(6).max(10),
});

export const verifyMfaEnrollment = createServerFn({ method: "POST" })
  .validator(verifySchema)
  .handler(async ({ data }) => {
    const { setNoStoreStrict } = await import("@/lib/server/admin-guard.server");
    await setNoStoreStrict();
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
    const { setNoStoreStrict } = await import("@/lib/server/admin-guard.server");
    await setNoStoreStrict();
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

// Logic lives in mfa-ops.server.ts (server-only); the handler delegates.
// Hardening (F-10) documented there: AAL2 required to strip a factor, rate
// limit, policy backstop for MFA-mandatory roles, audited removal/denial.
export const unenrollMfa = createServerFn({ method: "POST" })
  .validator(unenrollSchema)
  .handler(async ({ data }) => {
    const { performUnenrollMfa } = await import("@/lib/server/mfa-ops.server");
    return performUnenrollMfa(data);
  });
