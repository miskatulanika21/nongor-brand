/**
 * Centralized permission registry — single source of truth for RBAC.
 *
 * Used by BOTH:
 *   - Server-side authorization (requirePermission / hasPermission)
 *   - Admin navigation visibility (filtering the sidebar/menu)
 *
 * Isomorphic: NO server-only imports, safe for the browser bundle.
 * Hiding a nav link is a UX convenience only — the server guard is the
 * real boundary. Both read from this same map so they can never drift.
 */
import { type StaffRole, STAFF_ROLES } from "@/lib/auth-types";

// ---- Permission catalog -----------------------------------------------------

/**
 * Every privileged capability in the admin area.
 * Add a permission here, grant it to roles below, then enforce it in the
 * matching route guard / server action. Names are `<area>.<verb>`.
 */
export const ADMIN_PERMISSIONS = [
  "dashboard.view",
  "orders.view",
  "orders.manage",
  "customers.view",
  "customers.manage",
  "courier.view",
  "courier.manage",
  "products.view",
  "products.manage",
  "categories.manage",
  "inventory.view",
  "inventory.manage",
  "payments.view",
  "payments.verify",
  "coupons.manage",
  "reviews.manage",
  "messages.view",
  "messages.manage",
  "content.manage",
  "media.manage",
  "policies.manage",
  "sizes.manage",
  "reports.view",
  "settings.manage",
  "staff.view",
  "staff.manage",
  "audit.view",
  "security.manage",
  "integrations.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// ---- Role → permission grants -----------------------------------------------

/**
 * Staff: operational access for daily order fulfillment only.
 * No staff/owner management, audit, security, integrations, settings,
 * payments, or content. (Spec §15.)
 */
const STAFF_PERMISSIONS: readonly AdminPermission[] = [
  "dashboard.view",
  "orders.view",
  "orders.manage",
  "customers.view",
  "courier.view",
  "courier.manage",
  "products.view",
  "inventory.view",
  "inventory.manage",
  // Read the customer contact inbox (triage/mark-handled is admin+).
  "messages.view",
];

/**
 * Admin: broad operational + management access, but explicitly NOT
 * owner-only powers (owner role assignment, security, integrations, audit
 * are withheld; admin gets staff.view + a constrained staff.manage that the
 * server further restricts to non-owner targets).
 */
const ADMIN_ROLE_PERMISSIONS: readonly AdminPermission[] = [
  "dashboard.view",
  "orders.view",
  "orders.manage",
  "customers.view",
  "customers.manage",
  "courier.view",
  "courier.manage",
  "products.view",
  "products.manage",
  "categories.manage",
  "inventory.view",
  "inventory.manage",
  "payments.view",
  "payments.verify",
  "coupons.manage",
  "reviews.manage",
  "messages.view",
  "messages.manage",
  "content.manage",
  "media.manage",
  "policies.manage",
  "sizes.manage",
  "reports.view",
  "settings.manage",
  "staff.view",
  "staff.manage",
];

/** Owner: full authorized access to every permission. */
const OWNER_PERMISSIONS: readonly AdminPermission[] = [...ADMIN_PERMISSIONS];

/**
 * The authoritative role → permission set.
 * Frozen so it cannot be mutated at runtime.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<AdminPermission>> = Object.freeze({
  staff: new Set(STAFF_PERMISSIONS),
  admin: new Set(ADMIN_ROLE_PERMISSIONS),
  owner: new Set(OWNER_PERMISSIONS),
});

// ---- Lookups ----------------------------------------------------------------

/**
 * Does the given role hold the given permission?
 * An unknown/undefined role holds nothing (fail closed).
 */
export function roleHasPermission(
  role: StaffRole | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!role) return false;
  const set = ROLE_PERMISSIONS[role];
  return set ? set.has(permission) : false;
}

/** All permissions for a role, as an array (handy for debugging/tests). */
export function permissionsForRole(role: StaffRole | null | undefined): AdminPermission[] {
  if (!role) return [];
  const set = ROLE_PERMISSIONS[role];
  return set ? [...set] : [];
}

/**
 * Owner-exclusive permissions (held by owner but NOT by admin).
 * These gate the owner-only safety boundaries (security, audit,
 * integrations, owner role assignment) regardless of nav visibility.
 */
export const OWNER_ONLY_PERMISSIONS: readonly AdminPermission[] = ADMIN_PERMISSIONS.filter(
  (p) => ROLE_PERMISSIONS.owner.has(p) && !ROLE_PERMISSIONS.admin.has(p),
);

/** Type guard for untrusted permission strings. */
export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

// Re-export role list for consumers that filter by role.
export { STAFF_ROLES };
