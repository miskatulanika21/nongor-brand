/**
 * MFA — SERVER-ONLY operations (enrollment start / unenroll).
 *
 * Moved out of mfa.api.ts because that module is imported by route components
 * (client graph). A `.api.ts` may only reference server-only modules INSIDE a
 * createServerFn `.handler()` closure; module-level functions that import server
 * code trip the dev import-protection. The handlers in mfa.api.ts import these
 * dynamically inside their closures, and the unit tests import them from here.
 *
 * Logic is unchanged from the original mfa.api.ts (CSRF + strict staff identity
 * + rate limit + AAL2 rules + audit; never logs the TOTP secret/QR).
 */

async function setNoCacheHeaders(): Promise<void> {
  const { setNoStoreStrict } = await import("./admin-guard.server");
  await setNoStoreStrict();
}

/**
 * Begin TOTP enrollment. Returns the otpauth URI + secret for QR display. The
 * factor is unverified until verifyMfaEnrollment() succeeds. Requires AAL2 to add
 * a factor when one already exists; cleans up stale unverified factors first.
 */
export async function performStartMfaEnrollment() {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("./supabase.server");
  const { getPublicSupabaseEnv } = await import("./env.server");
  const { checkCsrfOrigin, getClientIp, safeServerLog } = await import("./security.server");
  const { requireStaff } = await import("./identity.server");
  const { checkIndependentRateLimit, rateLimitMessage } = await import("./rate-limit.server");
  const { writeAudit } = await import("./audit.server");

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

/**
 * Remove a verified TOTP factor (F-10): CSRF + strict staff identity, rate-limit,
 * requires a current AAL2 session, and never drops an MFA-mandatory role below one
 * verified factor. Audits removal + AAL2 denial.
 */
export async function performUnenrollMfa(data: { factorId: string }) {
  await setNoCacheHeaders();
  const { createServerSupabaseClient } = await import("./supabase.server");
  const { getPublicSupabaseEnv } = await import("./env.server");
  const { checkCsrfOrigin, getClientIp } = await import("./security.server");
  const { requireStaff } = await import("./identity.server");
  const { mfaRequiredForRole } = await import("./mfa.server");
  const { checkIndependentRateLimit, rateLimitMessage } = await import("./rate-limit.server");
  const { writeAudit } = await import("./audit.server");

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
