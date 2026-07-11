/**
 * Shared guard for admin WRITE server functions.
 *
 * Bundles the full mutation security spine used across the admin area so each
 * handler cannot accidentally omit a layer (the staff RPCs in staff.api.ts
 * established this exact order):
 *
 *   1. no-store response headers
 *   2. CSRF same-origin check
 *   3. strict permission check (getUser, not just claims) against the registry
 *   4. MFA step-up (only when ENFORCE_ADMIN_MFA — a deliberate go-live switch)
 *   5. per-IP + per-account rate limiting
 *   6. audited denial (authz.denied) with the verified actor
 *
 * Returns the verified actor on success; a generic, non-oracular error string
 * otherwise. The .server.ts suffix keeps this off the client bundle.
 */
import type { AdminPermission } from "@/lib/permissions";
import type { StaffRole } from "@/lib/auth-types";

export type AdminWriteGuardResult =
  | { ok: true; actorId: string; role: StaffRole }
  | { ok: false; error: string };

/**
 * Mark the current response private + uncacheable. Privileged reads AND writes
 * must set this so admin data is never stored by shared/browser caches.
 */
export async function setNoStore(): Promise<void> {
  try {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders({ "Cache-Control": "private, no-store" } as unknown as Headers);
  } catch {
    /* no request context (e.g. unit test) */
  }
}

/**
 * Like setNoStore, but adds the HTTP/1.0 legacy no-cache headers too. Used by the
 * auth/MFA endpoints. Lives here (a .server.ts) so `.api.ts` modules never import
 * `@tanstack/react-start/server` directly — that specifier is denied in the client
 * graph and breaks the dev import-protection when a route pulls the api module in.
 */
export async function setNoStoreStrict(): Promise<void> {
  try {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
    } as unknown as Headers);
  } catch {
    /* no request context (e.g. unit test) */
  }
}

/**
 * Authorize and rate-limit an admin write. `permission` is enforced against the
 * centralized RBAC registry; `op` is recorded in the denial audit for tracing.
 */
export async function guardAdminWrite(
  permission: AdminPermission,
  op: string,
): Promise<AdminWriteGuardResult> {
  await setNoStore();

  const { getPublicSupabaseEnv, isAdminMfaEnforced } = await import("./env.server");
  const { checkCsrfOrigin, getClientIp } = await import("./security.server");
  const { requirePermission } = await import("./rbac.server");
  const { checkIndependentRateLimit, rateLimitMessage } = await import("./rate-limit.server");
  const { writeAudit } = await import("./audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { ok: false, error: "Invalid request origin." };
  }

  // Strict (getUser) — destructive admin mutations must verify the live session.
  const authz = await requirePermission(permission, { strict: true });
  if (!authz.ok) {
    await writeAudit({
      action: "authz.denied",
      actorId: authz.actorId,
      metadata: { op, permission, reason: authz.reason },
    });
    return { ok: false, error: "You are not authorized to perform this action." };
  }
  const actor = authz.identity;

  // Step-up (AAL2) — only enforced when admin MFA is switched on for go-live, so
  // it can never lock out an owner/admin who has not yet enrolled a TOTP factor.
  if (isAdminMfaEnforced()) {
    const { requireAssuranceLevel } = await import("./mfa.server");
    const aal = await requireAssuranceLevel(actor.role);
    if (!aal.ok) {
      return {
        ok: false,
        error:
          "Additional verification is required. Complete two-factor authentication and try again.",
      };
    }
  }

  const rl = await checkIndependentRateLimit("catalogWrite", {
    ip: getClientIp(),
    account: actor.userId,
  });
  if (!rl.allowed) return { ok: false, error: rateLimitMessage() };

  return { ok: true, actorId: actor.userId, role: actor.role };
}
