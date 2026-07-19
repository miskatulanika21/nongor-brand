/**
 * Staff administration — SERVER-ONLY operations.
 *
 * Moved out of staff.api.ts because that module is imported by the admin route
 * component (client graph). A `.api.ts` may only reference server-only modules
 * INSIDE a createServerFn `.handler()` closure (which the TanStack splitter
 * extracts to the server bundle); module-level helpers/functions that import
 * server code trip the dev import-protection. This `.server.ts` holds those
 * functions; the handlers in staff.api.ts import them dynamically inside their
 * closures, and the unit tests import them from here directly.
 *
 * Logic is unchanged from the original staff.api.ts (see its authorization
 * summary): CSRF + role gate + owner-safety re-checks + AAL2 step-up + audit.
 */
import type { StaffRole } from "@/lib/auth-types";

async function setNoCache(): Promise<void> {
  const { setNoStore } = await import("./admin-guard.server");
  await setNoStore();
}

/**
 * Step-up (AAL2) gate for sensitive staff mutations. Only enforced when
 * ENFORCE_ADMIN_MFA=true, mirroring the admin route guard, so enabling it stays
 * a deliberate go-live step that can't lock out an owner/admin without TOTP.
 */
export async function requireStepUp(
  role: "staff" | "admin" | "owner",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { isAdminMfaEnforced } = await import("./env.server");
  if (!isAdminMfaEnforced()) return { ok: true };

  const { requireAssuranceLevel } = await import("./mfa.server");
  const aal = await requireAssuranceLevel(role);
  if (aal.ok) return { ok: true };

  return {
    ok: false,
    error: "Additional verification is required. Complete two-factor authentication and try again.",
  };
}

// Input shapes only. Authoritative zod validation lives in staff.api.ts at the
// createServerFn boundary; these handlers receive already-validated data.
type UpdateStaffRoleInput = { targetUserId: string; newRole: StaffRole };
type SetStaffActiveInput = { targetUserId: string; active: boolean };

/** Update a staff member's role (createServerFn handler delegates here). */
export async function performUpdateStaffRole(data: UpdateStaffRoleInput) {
  await setNoCache();
  const { getPublicSupabaseEnv } = await import("./env.server");
  const { checkCsrfOrigin } = await import("./security.server");
  const { requireRole } = await import("./rbac.server");
  const { meetsMinimumRole } = await import("@/lib/auth-types");
  const { createAdminSupabaseClient } = await import("./supabase-admin.server");
  const { writeAudit } = await import("./audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  // Authorize the BASELINE (admin) BEFORE any privileged lookup, so an
  // unauthorized caller cannot use this endpoint as a staff-existence oracle.
  // Owner-level elevation is checked after we learn the target/requested role.
  const authz = await requireRole("admin", { strict: true });
  if (!authz.ok) {
    await writeAudit({
      action: "authz.denied",
      actorId: authz.actorId,
      metadata: { op: "updateStaffRole", reason: authz.reason },
    });
    return { success: false as const, error: "You are not allowed to perform this change." };
  }
  const actor = authz.identity;

  const admin = createAdminSupabaseClient();
  const { data: target } = await admin
    .from("staff_profiles")
    .select("role")
    .eq("user_id", data.targetUserId)
    .maybeSingle();

  if (!target) return { success: false as const, error: "Staff member not found." };

  // Touching an owner row, or assigning owner, requires owner. Use the
  // already-resolved actor role — no second identity lookup.
  const ownerInvolved = target.role === "owner" || data.newRole === "owner";
  if (ownerInvolved && !meetsMinimumRole(actor.role, "owner")) {
    await writeAudit({
      action: "authz.denied",
      actorId: actor.userId,
      metadata: { op: "updateStaffRole", reason: "owner_required" },
    });
    return { success: false as const, error: "You are not allowed to perform this change." };
  }

  const stepUp = await requireStepUp(actor.role);
  if (!stepUp.ok) return { success: false as const, error: stepUp.error };

  const { error } = await admin.schema("api").rpc("update_staff_role", {
    p_actor_id: actor.userId,
    p_target_user_id: data.targetUserId,
    p_new_role: data.newRole,
  });

  if (error) {
    // The owner-safety trigger raises a friendly message; surface generically.
    return { success: false as const, error: messageFromDbError(error) };
  }

  return { success: true as const, message: "Role updated." };
}

/** Activate / deactivate a staff member (createServerFn handler delegates here). */
export async function performSetStaffActive(data: SetStaffActiveInput) {
  await setNoCache();
  const { getPublicSupabaseEnv } = await import("./env.server");
  const { checkCsrfOrigin } = await import("./security.server");
  const { requireRole } = await import("./rbac.server");
  const { meetsMinimumRole } = await import("@/lib/auth-types");
  const { createAdminSupabaseClient } = await import("./supabase-admin.server");
  const { writeAudit } = await import("./audit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { success: false as const, error: "Invalid request origin." };
  }

  // Baseline (admin) authorization BEFORE the privileged lookup — no existence
  // oracle for unauthorized callers. Owner elevation checked after lookup.
  const authz = await requireRole("admin", { strict: true });
  if (!authz.ok) {
    await writeAudit({
      action: "authz.denied",
      actorId: authz.actorId,
      metadata: { op: "setStaffActive", reason: authz.reason },
    });
    return { success: false as const, error: "You are not allowed to perform this change." };
  }
  const actor = authz.identity;

  const admin = createAdminSupabaseClient();
  const { data: target } = await admin
    .from("staff_profiles")
    .select("role")
    .eq("user_id", data.targetUserId)
    .maybeSingle();

  if (!target) return { success: false as const, error: "Staff member not found." };

  // Activating/deactivating an owner requires owner.
  if (target.role === "owner" && !meetsMinimumRole(actor.role, "owner")) {
    await writeAudit({
      action: "authz.denied",
      actorId: actor.userId,
      metadata: { op: "setStaffActive", reason: "owner_required" },
    });
    return { success: false as const, error: "You are not allowed to perform this change." };
  }

  const stepUp = await requireStepUp(actor.role);
  if (!stepUp.ok) return { success: false as const, error: stepUp.error };

  const { error } = await admin.schema("api").rpc("set_staff_active", {
    p_actor_id: actor.userId,
    p_target_user_id: data.targetUserId,
    p_active: data.active,
  });

  if (error) {
    return { success: false as const, error: messageFromDbError(error) };
  }

  return {
    success: true as const,
    message: data.active ? "Account activated." : "Account deactivated.",
  };
}

function messageFromDbError(error: { message?: string }): string {
  const msg = error?.message ?? "";
  if (/last active owner/i.test(msg)) {
    return "This is the last active owner and cannot be changed.";
  }
  return "Could not complete the change. Please try again.";
}
