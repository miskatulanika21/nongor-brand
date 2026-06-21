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

// ---- Minimal client surface -------------------------------------------------

/**
 * The minimal structural surface of the Supabase client that identity
 * resolution actually uses.
 *
 * Why this exists:
 *   - The real per-request client returned by createServerSupabaseClient() is
 *     assignable to it, so callers in the SAME request as an auth mutation can
 *     pass their already-authenticated client through (see `client` below).
 *   - Tests can satisfy it with a tiny object literal — they do NOT have to
 *     implement the entire SupabaseClient, and we never need `any` or a broad
 *     unsafe cast to make a mock compile.
 *
 * Return types are intentionally loose (`unknown` / `PromiseLike`) so the real
 * client's richer types remain assignable without casts. Members use method
 * shorthand so parameter checking is bivariant.
 */
export interface IdentityClient {
  auth: {
    getUser(): Promise<{ data: { user: IdentityUser | null }; error: unknown }>;
    getClaims(): Promise<{ data: { claims: IdentityClaims } | null; error: unknown }>;
    signOut(options?: { scope?: "global" | "local" | "others" }): Promise<{ error: unknown }>;
  };
  from(relation: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: StaffProfileRow | null; error: unknown }>;
      };
    };
  };
}

interface IdentityUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

interface IdentityClaims {
  sub?: string;
  email?: unknown;
  user_metadata?: unknown;
}

interface StaffProfileRow {
  id: number;
  role: unknown;
  is_active: unknown;
  display_name: unknown;
}

/**
 * The concrete per-request client type. Accepting `ServerClient | IdentityClient`
 * (rather than annotating the real client AS IdentityClient) keeps both the
 * production call sites and the internal client cheap to type-check: the real
 * client matches ServerClient exactly, and test mocks match IdentityClient —
 * neither direction forces the (deeply recursive) Postgrest generics to be
 * structurally compared, which would otherwise hit TS "instantiation too deep".
 */
type ServerClient = ReturnType<typeof createServerSupabaseClient>;

// ---- Core resolver ----------------------------------------------------------

interface ResolveOptions {
  /**
   * When true, verify the session against the Auth server with getUser()
   * (network call) instead of getClaims() (local JWT read). Use for
   * high-risk operations (mutations, privileged actions, post-login).
   */
  strict?: boolean;
  /**
   * Reuse an already-authenticated client for the WHOLE transaction.
   *
   * Pass this when identity resolution runs in the SAME request as the auth
   * mutation (password login, OAuth code exchange, OTP/magic-link verify): the
   * freshly-issued session lives on that client and on the OUTGOING response
   * cookies, but NOT yet in the incoming request cookies a fresh client would
   * read. Reusing the authenticated client makes both the session check and the
   * staff_profiles lookup run under that session. Omit it on later requests
   * (route guards, header summary), where the session is already in cookies.
   */
  client?: ServerClient | IdentityClient;
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
  // ONE client for the whole transaction. When the caller passes an
  // already-authenticated client (same request as the auth mutation), both the
  // session check and the staff lookup run under that session; otherwise we
  // create a per-request client that reads the incoming request cookies.
  const supabase = options.client ?? createServerSupabaseClient();

  let userId: string;
  let email: string | null;
  let metadataName: string | null;

  try {
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
      email = typeof data.claims.email === "string" ? data.claims.email : null;
      metadataName = extractName(data.claims.user_metadata, email);
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

  // Staff-profile lookup. Distinguish outcomes precisely:
  //   error            → fail closed (lookup_failed)
  //   no row           → customer
  //   row, is_active   → staff/admin/owner   (false → inactive_staff)
  //
  // NOTE: PostgreSQL RLS may silently FILTER a row and return data:null with
  // error:null. We can only distinguish an explicit query error (lookup_failed)
  // from a no-row result (customer) — an RLS-filtered staff row is
  // indistinguishable from a genuine customer here. Correct staff resolution in
  // production therefore depends on the authenticated self-read policy on
  // staff_profiles (user_id = auth.uid()), verified server-side by Antigravity.
  try {
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

    const role = profile.role;
    if (!isStaffRole(role)) {
      // A row with an unrecognized role is a data-integrity problem; do not
      // grant privileged access on a value we cannot reason about.
      safeServerLog("error", "Identity: unrecognized staff role", {
        role: String(role),
      });
      return { ok: false, reason: "lookup_failed" };
    }

    return {
      ok: true,
      identity: {
        kind: "staff",
        userId,
        email,
        name: typeof profile.display_name === "string" ? profile.display_name : metadataName,
        role,
        staffProfileId: profile.id,
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
 * Best-effort sign-out used when denying a just-authenticated request (e.g.
 * inactive staff or a lookup failure during login/OAuth). Never throws —
 * a failed sign-out must not turn a denial into an allow.
 *
 * Pass the SAME authenticated client used by the transaction so the session
 * established in this request is the one cleared. Uses `scope: "local"` so we
 * only clear the current session — a global sign-out would revoke the user's
 * sessions on other devices, which is not this function's responsibility.
 * (Hard cross-device revocation of deactivated staff is a Phase 7 concern.)
 */
export async function invalidateSession(client?: ServerClient | IdentityClient): Promise<void> {
  try {
    const supabase = client ?? createServerSupabaseClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch (err) {
    safeServerLog("warn", "Identity: sign-out during denial failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

// ---- Helpers ----------------------------------------------------------------

function extractName(metadata: unknown, email: string | null): string | null {
  const meta =
    metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : undefined;
  const full = meta?.full_name;
  const name = meta?.name;
  const fromMeta = typeof full === "string" ? full : typeof name === "string" ? name : undefined;
  if (fromMeta && fromMeta.trim()) return fromMeta.trim();
  if (email) return email.split("@")[0];
  return null;
}
