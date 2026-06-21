/**
 * Post-login destination resolution — server-only.
 *
 * Two layers:
 *   1. resolvePostLoginDestination()  — adapts a verified AuthenticatedIdentity
 *      (from identity.server.ts) and calls the pure resolver. This is what
 *      the login / OAuth / reset flows use.
 *   2. resolveLoginDestination()      — pure, DB-free decision logic, unit
 *      tested in isolation.
 *
 * Rules enforced here (spec §7–§10):
 *   - Defaults: customer → /account, privileged → /admin.
 *   - Privileged accounts may ONLY land on /admin/* — a privileged user with
 *     next=/account or next=/checkout is sent to /admin.
 *   - Privileged users may reach a specific /admin/* page only if their role
 *     holds that page's permission; otherwise → /admin.
 *   - Customers may only land on an approved customer/public route family;
 *     a customer requesting /admin/* is denied (→ /account, adminDenied).
 *   - All `next` values pass canonicalization + strict safe-redirect checks.
 *
 * The .server.ts suffix prevents bundling into the client.
 */
import type { StaffRole } from "@/lib/auth-types";
import { isSafeRedirect, pathOnly } from "@/lib/safe-redirect";
import { roleCanAccessAdminPath } from "@/lib/admin-routes";
import type { AuthenticatedIdentity } from "./identity.server";

// ---- Types ------------------------------------------------------------------

/** User's designation as determined from staff_profiles. */
export type Designation = "customer" | "staff" | "admin" | "owner";

/** Minimal identity shape the pure resolver needs. */
export interface LoginIdentity {
  userId: string;
  email: string | null;
  designation: Designation;
  hasAdminAccess: boolean;
}

export interface DestinationResult {
  destination: string;
  identity: LoginIdentity;
  /** True if the user requested an admin area but was denied for being a customer. */
  adminDenied: boolean;
}

// ---- Approved customer route families (spec §8, §10) ------------------------

/**
 * Route-family allowlist for customer `next` destinations. A customer may
 * only be redirected to one of these families — never an arbitrary path that
 * merely starts with "/".
 */
const CUSTOMER_ROUTE_PREFIXES = [
  "/account",
  "/orders",
  "/order-success",
  "/checkout",
  "/cart",
  "/track",
  "/wishlist",
  "/shop",
  "/product",
] as const;

const CUSTOMER_EXACT_ROUTES = new Set<string>(["/"]);

function isApprovedCustomerRoute(path: string): boolean {
  const p = pathOnly(path);
  if (CUSTOMER_EXACT_ROUTES.has(p)) return true;
  return CUSTOMER_ROUTE_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

// ---- Destination canonicalization & validation ------------------------------

const CANONICAL_DESTINATIONS: Record<string, string> = {
  "/admin/login": "/admin",
};

/** Canonicalize a destination path (e.g. /admin/login → /admin). */
function canonicalize(path: string): string {
  return CANONICAL_DESTINATIONS[pathOnly(path)] ?? path;
}

/**
 * Validate a redirect destination is a safe internal route.
 * Delegates to the canonical isomorphic checker (handles external URLs,
 * protocol-relative, backslash, encoded bypasses, javascript:/data:, and
 * login/admin-login loops).
 */
export function isValidLoginDestination(path: string | undefined | null): path is string {
  return isSafeRedirect(path);
}

function isAdminPath(path: string): boolean {
  const p = pathOnly(path);
  return p === "/admin" || p.startsWith("/admin/");
}

// ---- Pure destination resolver (unit tested) --------------------------------

/**
 * Determine the destination for a user after login.
 *
 * Pure function — no database calls, no side effects. Inactive staff and
 * lookup failures never reach this function; they are denied upstream in
 * identity resolution. So `identity` here is always an active customer or an
 * active privileged account.
 */
export function resolveLoginDestination(
  identity: LoginIdentity,
  requestedNext?: string | null,
): DestinationResult {
  const base = { identity };
  const defaultDestination = identity.hasAdminAccess ? "/admin" : "/account";

  if (!requestedNext) {
    return { ...base, destination: defaultDestination, adminDenied: false };
  }

  const canonical = canonicalize(requestedNext);

  if (!isValidLoginDestination(canonical)) {
    return { ...base, destination: defaultDestination, adminDenied: false };
  }

  const wantsAdmin = isAdminPath(canonical);

  if (identity.hasAdminAccess) {
    // Privileged accounts may ONLY land inside /admin. A privileged user who
    // requests a customer route (e.g. /account, /checkout) is redirected to
    // the admin dashboard instead. (Spec §9.)
    if (!wantsAdmin) {
      return { ...base, destination: "/admin", adminDenied: false };
    }
    // Within /admin, honor the specific page only if the role has permission.
    const role = identity.designation as StaffRole;
    if (!roleCanAccessAdminPath(role, canonical)) {
      return { ...base, destination: "/admin", adminDenied: false };
    }
    return { ...base, destination: canonical, adminDenied: false };
  }

  // Customer.
  if (wantsAdmin) {
    // Requested an admin area without access. (Spec §8.)
    return { ...base, destination: "/account", adminDenied: true };
  }
  if (isApprovedCustomerRoute(canonical)) {
    return { ...base, destination: canonical, adminDenied: false };
  }
  // Safe but not an approved customer family → default.
  return { ...base, destination: "/account", adminDenied: false };
}

// ---- Identity adapter -------------------------------------------------------

/** Map a verified AuthenticatedIdentity to the pure resolver's input shape. */
export function toLoginIdentity(identity: AuthenticatedIdentity): LoginIdentity {
  if (identity.kind === "staff") {
    return {
      userId: identity.userId,
      email: identity.email,
      designation: identity.role,
      hasAdminAccess: true,
    };
  }
  return {
    userId: identity.userId,
    email: identity.email,
    designation: "customer",
    hasAdminAccess: false,
  };
}

/**
 * Canonical post-login destination resolver used by every entry flow
 * (password login, OAuth callback, email confirm, password reset,
 * already-authenticated /login visits).
 */
export function resolvePostLoginDestination(args: {
  identity: AuthenticatedIdentity;
  requestedNext?: string | null;
}): DestinationResult {
  return resolveLoginDestination(toLoginIdentity(args.identity), args.requestedNext);
}
