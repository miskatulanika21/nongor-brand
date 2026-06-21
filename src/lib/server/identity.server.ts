/**
 * Centralized server-side identity resolver — the ONE place that turns a
 * verified Supabase session into a typed account identity.
 *
 * Every route guard, server action, and post-login destination decision
 * flows through getAuthenticatedIdentity(). No route may reimplement role
 * resolution.
 *
 * Security invariants (the whole point of this file):
 *   1. The user id always comes from a server-verified session
 *      (getClaims for routine reads, getUser for high-risk ops) — never
 *      from the browser.
 *   2. A successful auth + NO staff_profiles row  → customer.
 *   3. A successful auth + ACTIVE staff row       → staff/admin/owner.
 *   4. An INACTIVE staff row                       → DENIED (not a customer).
 *   5. A staff lookup ERROR (DB/RLS/network)       → FAIL CLOSED (denied).
 *
 * The .server.ts suffix keeps this out of the client bundle.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { safeServerLog } from "./security.server";
import { type StaffRole, isStaffRole } from "@/lib/auth-types";

// ---- Identity model ---------------------------------------------------------

export interface CustomerIdentity {
  kind: "customer";
  userId: string;
  email: string | null;
  name: string | null;
}

export interface StaffIdentity {
  kind: "staff";
  userId: string;
  email: string | null;
  name: string | null;
  role: StaffRole;
  staffProfileId: number;
  isActive: true;
}

/** A successfully resolved, authorized identity. */
export type AuthenticatedIdentity = CustomerIdentity | StaffIdentity;

/** Why identity resolution did not yield an authorized identity. */
export type IdentityDenial =
  | "unauthenticated" // no valid session
  | "inactive_staff" // staff profile exists but is_active = false → deny + sign out
  | "lookup_failed"; // staff lookup errored → fail closed

export type IdentityResult =
  | { ok: true; identity: AuthenticatedIdentity }
  | { ok: false; reason: IdentityDenial };

/** True when the resolved identity is an active privileged account. */
export function isPrivileged(identity: AuthenticatedIdentity): identity is StaffIdentity {
  return identity.kind === "staff";
}

// ---- Core resolver ----------------------------------------------------------

interface ResolveOptions {
  /**
   * When true, verify the session against the Auth server with getUser()
   * (network call) instead of getClaims() (local JWT read). Use for
   * high-risk operations (mutations, privileged actions, post-login).
   */
  strict?: boolean;
}

/**
 * Resolve the current request's identity from its cookies.
 *
 * This is the single authoritative entry point. Callers branch on the
 * discriminated result; they must NOT treat `lookup_failed` or
 * `inactive_staff` as a customer.
 */
export async function getAuthenticatedIdentity(
  options: ResolveOptions = {},
): Promise<IdentityResult> {
  let userId: string;
  let email: string | null;
  let metadataName: string | null;

  try {
    const supabase = createServerSupabaseClient();

    if (options.strict) {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        return { ok: false, reason: "unauthenticated" };
      }
      userId = user.id;
      email = user.email ?? null;
      metadataName = extractName(user.user_metadata, email);
    } else {
      const { data, error } = await supabase.auth.getClaims();
      const sub = data?.claims?.sub;
      if (error || !sub) {
        return { ok: false, reason: "unauthenticated" };
      }
      userId = sub;
      email = (data.claims.email as string | undefined) ?? null;
      metadataName = extractName(
        data.claims.user_metadata as Record<string, unknown> | undefined,
        email,
      );
    }
  } catch (err) {
    // A failure here means we could not even establish identity. Treat as
    // unauthenticated (the caller will redirect to login) rather than
    // leaking a server error.
    safeServerLog("error", "Identity: session read failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "unauthenticated" };
  }

  // Staff-profile lookup. Distinguish three outcomes precisely:
  //   error            → fail closed (lookup_failed)
  //   no row           → customer
  //   row, is_active   → staff/admin/owner   (false → inactive_staff)
  try {
    const supabase = createServerSupabaseClient();
    const { data: profile, error } = await supabase
      .from("staff_profiles")
      .select("id, role, is_active, display_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      // DB / RLS / network error. FAIL CLOSED — do not assume customer.
      safeServerLog("error", "Identity: staff_profiles lookup failed", {
        code: (error as { code?: string }).code ?? "unknown",
      });
      return { ok: false, reason: "lookup_failed" };
    }

    if (!profile) {
      return {
        ok: true,
        identity: { kind: "customer", userId, email, name: metadataName },
      };
    }

    if (profile.is_active !== true) {
      return { ok: false, reason: "inactive_staff" };
    }

    if (!isStaffRole(profile.role)) {
      // A row with an unrecognized role is a data-integrity problem; do not
      // grant privileged access on a value we cannot reason about.
      safeServerLog("error", "Identity: unrecognized staff role", {
        role: String(profile.role),
      });
      return { ok: false, reason: "lookup_failed" };
    }

    return {
      ok: true,
      identity: {
        kind: "staff",
        userId,
        email,
        name: (profile.display_name as string | null) ?? metadataName,
        role: profile.role,
        staffProfileId: profile.id as number,
        isActive: true,
      },
    };
  } catch (err) {
    safeServerLog("error", "Identity: staff lookup threw", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "lookup_failed" };
  }
}

// ---- Convenience guards -----------------------------------------------------

/**
 * Require any authenticated user (customer or staff). Inactive staff and
 * lookup failures are still denied — there is no "any logged-in user is
 * fine" escape hatch.
 */
export async function requireAuthenticatedUser(
  options: ResolveOptions = {},
): Promise<IdentityResult> {
  return getAuthenticatedIdentity(options);
}

export type CustomerGuardResult =
  | { ok: true; identity: CustomerIdentity }
  | { ok: false; reason: IdentityDenial | "is_staff" };

/**
 * Require an active CUSTOMER identity for customer-private routes/actions.
 *
 *   unauthenticated → redirect to login (reason: "unauthenticated")
 *   active staff    → belongs in /admin (reason: "is_staff")
 *   inactive staff  → deny + sign out  (reason: "inactive_staff")
 *   lookup failure  → fail closed       (reason: "lookup_failed")
 *   customer        → allow
 */
export async function requireCustomer(options: ResolveOptions = {}): Promise<CustomerGuardResult> {
  const result = await getAuthenticatedIdentity(options);
  if (!result.ok) return result;
  if (result.identity.kind === "staff") {
    return { ok: false, reason: "is_staff" };
  }
  return { ok: true, identity: result.identity };
}

export type StaffGuardResult =
  | { ok: true; identity: StaffIdentity }
  | { ok: false; reason: IdentityDenial | "is_customer" };

/**
 * Require an active privileged identity (staff/admin/owner) for /admin
 * routes and privileged actions.
 *
 *   unauthenticated → redirect to login (reason: "unauthenticated")
 *   customer        → belongs in /account (reason: "is_customer")
 *   inactive staff  → deny + sign out   (reason: "inactive_staff")
 *   lookup failure  → fail closed        (reason: "lookup_failed")
 *   active staff    → allow
 */
export async function requireStaff(options: ResolveOptions = {}): Promise<StaffGuardResult> {
  const result = await getAuthenticatedIdentity(options);
  if (!result.ok) return result;
  if (result.identity.kind === "customer") {
    return { ok: false, reason: "is_customer" };
  }
  return { ok: true, identity: result.identity };
}

/**
 * Best-effort sign-out used when denying inactive staff. Never throws —
 * a failed sign-out must not turn a denial into an allow.
 */
export async function invalidateSession(): Promise<void> {
  try {
    const supabase = createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch (err) {
    safeServerLog("warn", "Identity: sign-out during denial failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

// ---- Helpers ----------------------------------------------------------------

function extractName(
  metadata: Record<string, unknown> | undefined,
  email: string | null,
): string | null {
  const fromMeta =
    (metadata?.full_name as string | undefined) ?? (metadata?.name as string | undefined);
  if (fromMeta && fromMeta.trim()) return fromMeta.trim();
  if (email) return email.split("@")[0];
  return null;
}
