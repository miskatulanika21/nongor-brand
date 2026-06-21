/**
 * Auth types shared between client and server.
 * No secrets, no server-only imports.
 */

/** Staff role hierarchy: owner > admin > staff */
export type StaffRole = "owner" | "admin" | "staff";

/** All valid staff roles in descending privilege order. */
export const STAFF_ROLES: readonly StaffRole[] = ["owner", "admin", "staff"] as const;

/** Numeric weight for role comparison. Higher = more privileged. */
const ROLE_WEIGHT: Record<StaffRole, number> = {
  owner: 30,
  admin: 20,
  staff: 10,
};

/**
 * Returns true if `actual` meets or exceeds the `minimum` role.
 * Unknown or undefined roles never satisfy any minimum.
 */
export function meetsMinimumRole(actual: string | null | undefined, minimum: StaffRole): boolean {
  if (!actual) return false;
  const actualWeight = ROLE_WEIGHT[actual as StaffRole];
  const minimumWeight = ROLE_WEIGHT[minimum];
  if (actualWeight === undefined || minimumWeight === undefined) return false;
  return actualWeight >= minimumWeight;
}

/** Safe user data exposed to the client (no raw Supabase objects). */
export interface SafeSessionData {
  /** Supabase Auth user ID */
  userId: string;
  /** User email */
  email: string;
  /** Staff role if the user has one, otherwise null */
  staffRole: StaffRole | null;
  /** Whether the staff account is active */
  staffActive: boolean;
}

/** Minimal claims extracted from JWT for routine auth checks. */
export interface AuthClaims {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  exp?: number;
}

/**
 * Type guard: is the value a valid StaffRole?
 */
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && STAFF_ROLES.includes(value as StaffRole);
}
