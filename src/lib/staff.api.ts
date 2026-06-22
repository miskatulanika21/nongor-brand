/**
 * Staff administration server functions — client-callable via RPC.
 *
 * Every handler independently authorizes (requirePermission/requireRole) and
 * re-checks owner-safety rules server-side; the admin UI hiding controls is
 * never the boundary. Provisioning uses the Supabase admin API to invite a
 * user (no password is handled or logged) and the atomic provision_staff RPC,
 * with compensation if the profile step fails. All mutations are audited with
 * the REAL actor. (Spec §31, §32.)
 *
 * Authorization summary:
 *   - View staff           → staff.view  (admin, owner)
 *   - Create staff         → requireRole("admin")  (admin, owner)
 *   - Create admin/owner   → requireRole("owner")
 *   - Change/affect an owner row, or assign owner → requireRole("owner")
 *   - Activate/deactivate  → staff.manage + owner rule above
 *   - Last active owner cannot be demoted/deactivated/deleted (DB trigger too)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { emailSchema } from "@/lib/validation";

async function setNoCache(): Promise<void> {
  try {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders({ "Cache-Control": "private, no-store" } as unknown as Headers);
  } catch {
    /* test context */
  }
}

const roleEnum = z.enum(["staff", "admin", "owner"]);

/**
 * Step-up (AAL2) gate for sensitive staff mutations.
 *
 * Only enforced when ENFORCE_ADMIN_MFA=true — mirroring the admin route guard
 * in loadAdminArea — so turning on enforcement stays a deliberate go-live step
 * and cannot lock out an owner/admin who has not yet enrolled a TOTP factor.
 * When enforced, an owner/admin acting on a first-factor (aal1) session is
 * refused until they complete the MFA challenge.
 */
async function requireStepUp(
  role: "staff" | "admin" | "owner",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { isAdminMfaEnforced } = await import("@/lib/server/env.server");
  if (!isAdminMfaEnforced()) return { ok: true };

  const { requireAssuranceLevel } = await import("@/lib/server/mfa.server");
  const aal = await requireAssuranceLevel(role);
  if (aal.ok) return { ok: true };

  return {
    ok: false,
    error: "Additional verification is required. Complete two-factor authentication and try again.",
  };
}

// ---- List staff -------------------------------------------------------------

export const listStaff = createServerFn({ method: "GET" }).handler(async () => {
  await setNoCache();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");

  const authz = await requirePermission("staff.view");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", staff: [] };

  const admin = createAdminSupabaseClient();
  const { data: profiles, error } = await admin
    .from("staff_profiles")
    .select("user_id, role, is_active, display_name, created_at")
    .order("created_at", { ascending: true });

  if (error) return { success: false as const, error: "Could not load staff.", staff: [] };

  // Map emails from auth.users (admin listUsers).
  const { data: usersList } = await admin.auth.admin.listUsers();
  const emailById = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return {
    success: true as const,
    staff: (profiles ?? []).map((p) => ({
      userId: p.user_id as string,
      email: emailById.get(p.user_id as string) ?? null,
      role: p.role as "staff" | "admin" | "owner",
      isActive: p.is_active as boolean,
      displayName: (p.display_name as string | null) ?? null,
    })),
  };
});

// ---- Provision (invite) staff ----------------------------------------------

const provisionSchema = z.object({
  email: emailSchema,
  role: roleEnum,
  displayName: z.string().trim().max(200).optional(),
});

export const provisionStaff = createServerFn({ method: "POST" })
  .validator(provisionSchema)
  .handler(async ({ data }) => {
    await setNoCache();
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { requireRole } = await import("@/lib/server/rbac.server");
    const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");
    const { writeAudit } = await import("@/lib/server/audit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    // Creating staff needs admin; creating admin/owner needs owner.
    const minRole = data.role === "staff" ? "admin" : "owner";
    const authz = await requireRole(minRole, { strict: true });
    if (!authz.ok) {
      await writeAudit({
        action: "authz.denied",
        actorId: authz.actorId,
        metadata: { op: "provisionStaff", role: data.role, reason: authz.reason },
      });
      return { success: false as const, error: "You are not allowed to create this account type." };
    }
    const actorId = authz.identity.userId;

    const stepUp = await requireStepUp(authz.identity.role);
    if (!stepUp.ok) return { success: false as const, error: stepUp.error };

    const rl = await checkIndependentRateLimit("staffProvision", {
      ip: getClientIp(),
      account: actorId,
    });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const admin = createAdminSupabaseClient();

    // Invite the user (Supabase emails a setup link; no password handled here).
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      data.email,
      {
        redirectTo: `${env.siteUrl}/auth/confirm?type=invite`,
        data: { full_name: data.displayName ?? null },
      },
    );

    if (inviteError || !invited?.user) {
      safeServerLog("warn", "Staff invite failed", { email: data.email });
      // Generic — never reveal whether the email already exists.
      return {
        success: false as const,
        error: "Could not invite this user. They may already exist.",
      };
    }

    const userId = invited.user.id;

    const { error: rpcError } = await admin.schema("api").rpc("provision_staff", {
      p_user_id: userId,
      p_role: data.role,
      p_display_name: data.displayName ?? null,
      p_actor_id: actorId,
      p_is_active: true,
    });

    if (rpcError) {
      // Compensation: remove the freshly-invited user to avoid orphan state.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      safeServerLog("error", "Staff provisioning RPC failed", {
        code: (rpcError as { code?: string }).code ?? "unknown",
      });
      return {
        success: false as const,
        error: "Could not complete provisioning. Please try again.",
      };
    }

    // SUPPLEMENTARY, best-effort audit. The CANONICAL record for this mutation
    // is 'staff.provisioned', written inside the same transaction as the
    // staff_profiles insert by private.provision_staff() — so the mutation and
    // its canonical audit cannot diverge. This extra 'staff.invited' event only
    // records the auth.users invitation side-effect and may safely be dropped on
    // failure without affecting the provisioning record.
    await writeAudit({
      action: "staff.invited",
      actorId,
      targetType: "auth.users",
      targetId: userId,
      metadata: { role: data.role },
    });

    return { success: true as const, message: "Invitation sent." };
  });

// ---- Update role ------------------------------------------------------------

const updateRoleSchema = z.object({ targetUserId: z.string().uuid(), newRole: roleEnum });

// Extracted for unit-testability (the createServerFn handler delegates).
export async function performUpdateStaffRole(data: z.infer<typeof updateRoleSchema>) {
  await setNoCache();
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin } = await import("@/lib/server/security.server");
  const { requireRole } = await import("@/lib/server/rbac.server");
  const { meetsMinimumRole } = await import("@/lib/auth-types");
  const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

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

export const updateStaffRole = createServerFn({ method: "POST" })
  .validator(updateRoleSchema)
  .handler(async ({ data }) => performUpdateStaffRole(data));

// ---- Activate / deactivate --------------------------------------------------

const setActiveSchema = z.object({ targetUserId: z.string().uuid(), active: z.boolean() });

// Extracted for unit-testability (the createServerFn handler delegates).
export async function performSetStaffActive(data: z.infer<typeof setActiveSchema>) {
  await setNoCache();
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin } = await import("@/lib/server/security.server");
  const { requireRole } = await import("@/lib/server/rbac.server");
  const { meetsMinimumRole } = await import("@/lib/auth-types");
  const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
  const { writeAudit } = await import("@/lib/server/audit.server");

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

export const setStaffActive = createServerFn({ method: "POST" })
  .validator(setActiveSchema)
  .handler(async ({ data }) => performSetStaffActive(data));

// ---- Helpers ----------------------------------------------------------------

function messageFromDbError(error: { message?: string }): string {
  const msg = error?.message ?? "";
  if (/last active owner/i.test(msg)) {
    return "This is the last active owner and cannot be changed.";
  }
  return "Could not complete the change. Please try again.";
}
