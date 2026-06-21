/**
 * RBAC — role & permission gates for routes and server actions.
 *
 * Thin layer on top of identity.server.ts. Every gate resolves the verified
 * identity through the single resolver, then checks role/permission against
 * the centralized registry. No route reimplements these checks.
 *
 * Decision tree for `strict`:
 *   - default (getClaims) → routine reads / page guards (no network call)
 *   - strict (getUser)    → high-risk ops: staff changes, payments,
 *                           destructive admin mutations, owner actions
 *
 * The .server.ts suffix prevents bundling into the client.
 */
import { type StaffRole, meetsMinimumRole } from "@/lib/auth-types";
import { type AdminPermission, roleHasPermission } from "@/lib/permissions";
import { requireStaff, type StaffIdentity, type StaffGuardResult } from "./identity.server";

// ---- Result types -----------------------------------------------------------

export type AuthzReason =
  | "unauthenticated"
  | "is_customer"
  | "inactive_staff"
  | "lookup_failed"
  | "forbidden";

export type AuthzResult =
  | { ok: true; identity: StaffIdentity }
  | { ok: false; reason: AuthzReason };

interface GateOptions {
  strict?: boolean;
}

// ---- Gates ------------------------------------------------------------------

/**
 * Require an active privileged identity meeting a minimum role.
 * owner > admin > staff.
 */
export async function requireRole(
  minimumRole: StaffRole,
  options: GateOptions = {},
): Promise<AuthzResult> {
  const staff = await requireStaff(options);
  if (!staff.ok) return normalizeFailure(staff);

  if (!meetsMinimumRole(staff.identity.role, minimumRole)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, identity: staff.identity };
}

/**
 * Require an active privileged identity holding a specific permission.
 * This is the primary gate for sensitive pages and server actions.
 */
export async function requirePermission(
  permission: AdminPermission,
  options: GateOptions = {},
): Promise<AuthzResult> {
  const staff = await requireStaff(options);
  if (!staff.ok) return normalizeFailure(staff);

  if (!roleHasPermission(staff.identity.role, permission)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, identity: staff.identity };
}

/** Pure permission check for an already-resolved role (re-export wrapper). */
export function hasPermission(
  role: StaffRole | null | undefined,
  permission: AdminPermission,
): boolean {
  return roleHasPermission(role, permission);
}

// ---- Internal ---------------------------------------------------------------

function normalizeFailure(staff: Extract<StaffGuardResult, { ok: false }>): AuthzResult {
  return { ok: false, reason: staff.reason };
}
