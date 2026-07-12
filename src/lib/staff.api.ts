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

// Server-only helpers/operations live in staff-ops.server.ts and are imported
// dynamically INSIDE handler closures (this module is in the client graph, so it
// must not reference server-only modules at module scope — dev import-protection).

const roleEnum = z.enum(["staff", "admin", "owner"]);

// ---- List staff -------------------------------------------------------------

/** One staff member's email resolution attempt against the Auth admin API. */
export type StaffEmailLookup = { userId: string; email: string | null; ok: boolean };

/**
 * Fold per-id Auth lookups into a userId→email map plus a `degraded` flag.
 * `degraded` is true when any lookup failed, so the UI can warn that some
 * emails could not be loaded instead of silently rendering blanks. Pure.
 */
export function resolveStaffEmails(lookups: StaffEmailLookup[]): {
  emailById: Map<string, string | null>;
  degraded: boolean;
} {
  const emailById = new Map<string, string | null>();
  let degraded = false;
  for (const l of lookups) {
    emailById.set(l.userId, l.ok ? l.email : null);
    if (!l.ok) degraded = true;
  }
  return { emailById, degraded };
}

export const listStaff = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");

  const authz = await requirePermission("staff.view");
  if (!authz.ok)
    return { success: false as const, error: "Not authorized.", staff: [], emailsDegraded: false };

  const admin = createAdminSupabaseClient();
  const { data: profiles, error } = await admin
    .from("staff_profiles")
    .select("user_id, role, is_active, display_name, created_at")
    .order("created_at", { ascending: true });

  if (error)
    return {
      success: false as const,
      error: "Could not load staff.",
      staff: [],
      emailsDegraded: false,
    };

  // Resolve each staff member's email by id. Targeted lookups (one per staff
  // row) are correct regardless of how many auth users exist — the previous
  // single listUsers() call defaulted to 50/page, so staff beyond the first
  // page silently lost their email, and any Auth error was swallowed entirely.
  const ids = (profiles ?? []).map((p) => p.user_id as string);
  const lookups = await Promise.all(
    ids.map(async (userId): Promise<StaffEmailLookup> => {
      try {
        const { data, error: e } = await admin.auth.admin.getUserById(userId);
        if (e || !data?.user) return { userId, email: null, ok: false };
        return { userId, email: data.user.email ?? null, ok: true };
      } catch {
        return { userId, email: null, ok: false };
      }
    }),
  );
  const { emailById, degraded } = resolveStaffEmails(lookups);

  return {
    success: true as const,
    emailsDegraded: degraded,
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
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { requireRole } = await import("@/lib/server/rbac.server");
    const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    const { requireStepUp } = await import("@/lib/server/staff-ops.server");

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

    // F-14 — if the email already belongs to an account (e.g. an existing
    // customer), PROMOTE it in place instead of inviting (invite would fail for
    // an existing email). The email→id resolution + the staff insert happen in
    // one SECURITY DEFINER RPC (no auth.admin.listUsers paging blind spot).
    const { data: promo, error: promoError } = await admin.schema("api").rpc("promote_to_staff", {
      p_email: data.email,
      p_role: data.role,
      p_display_name: data.displayName ?? null,
      p_actor_id: actorId,
    });

    if (!promoError && promo) {
      const status = (promo as { status?: string }).status;
      if (status === "promoted") {
        return { success: true as const, message: "Existing account promoted to staff." };
      }
      if (status === "already_staff") {
        return { success: false as const, error: "That person is already a staff member." };
      }
      // status === 'not_found' → fall through to the invite flow below.
    } else if (promoError) {
      safeServerLog("error", "Staff promote RPC failed", {
        code: (promoError as { code?: string }).code ?? "unknown",
      });
      return {
        success: false as const,
        error: "Could not add this staff member. Please try again.",
      };
    }

    // No existing account — invite the user (Supabase emails a setup link).
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

// Logic lives in staff-ops.server.ts (server-only); the handler delegates.
export const updateStaffRole = createServerFn({ method: "POST" })
  .validator(updateRoleSchema)
  .handler(async ({ data }) => {
    const { performUpdateStaffRole } = await import("@/lib/server/staff-ops.server");
    return performUpdateStaffRole(data);
  });

// ---- Activate / deactivate --------------------------------------------------

const setActiveSchema = z.object({ targetUserId: z.string().uuid(), active: z.boolean() });

// Logic lives in staff-ops.server.ts (server-only); the handler delegates.
export const setStaffActive = createServerFn({ method: "POST" })
  .validator(setActiveSchema)
  .handler(async ({ data }) => {
    const { performSetStaffActive } = await import("@/lib/server/staff-ops.server");
    return performSetStaffActive(data);
  });
