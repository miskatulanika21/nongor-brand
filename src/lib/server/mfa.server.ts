/**
 * MFA policy & assurance-level helpers (server-only).
 *
 * Uses Supabase's built-in TOTP MFA. The application enforces:
 *   owner  → MFA mandatory
 *   admin  → MFA mandatory
 *   staff  → strongly recommended (not blocked)
 *   customer → optional
 *
 * "Mandatory" means: a privileged account whose role requires MFA cannot reach
 * sensitive admin pages or perform sensitive actions on a first-factor (aal1)
 * session. The admin route guard calls mfaGate(); sensitive server actions call
 * requireAssuranceLevel("aal2").
 *
 * NOTE: TOTP MFA must also be enabled in the Supabase project (Dashboard →
 * Authentication → Providers → MFA). When it is disabled, enrollment server
 * functions return a configuration error; this module still resolves the gate
 * to "enroll" so the requirement is visible rather than silently skipped.
 * (Spec §26.)
 *
 * The .server.ts suffix keeps this off the client.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { safeServerLog } from "./security.server";
import type { StaffRole } from "@/lib/auth-types";

export type AssuranceLevel = "aal1" | "aal2";

/** Does this role require MFA to access privileged areas? */
export function mfaRequiredForRole(role: StaffRole): boolean {
  return role === "owner" || role === "admin";
}

export type MfaGateOutcome =
  | "ok" // requirement satisfied (aal2, or role doesn't require it)
  | "enroll" // role requires MFA but no verified factor exists yet
  | "challenge" // verified factor exists but session is still aal1
  | "error"; // could not determine assurance level → fail closed for required roles

export interface MfaStatus {
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
  /** True when at least one verified TOTP factor exists. */
  hasVerifiedFactor: boolean;
}

/**
 * Read the current session's assurance levels and whether a verified factor
 * exists. Returns null if the levels cannot be determined.
 */
export async function getMfaStatus(): Promise<MfaStatus | null> {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return null;

    const currentLevel = (data.currentLevel as AssuranceLevel | null) ?? "aal1";
    const nextLevel = (data.nextLevel as AssuranceLevel | null) ?? "aal1";
    // nextLevel === 'aal2' means a verified factor is available to step up to.
    const hasVerifiedFactor = nextLevel === "aal2";
    return { currentLevel, nextLevel, hasVerifiedFactor };
  } catch (err) {
    safeServerLog("error", "MFA: assurance-level read failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/**
 * Resolve the MFA gate for a privileged role.
 *
 *   role not requiring MFA → "ok" (still allowed; staff is recommended only)
 *   aal2 session           → "ok"
 *   enrolled but aal1      → "challenge"
 *   not enrolled           → "enroll"
 *   indeterminate          → "error" (caller fails closed for required roles)
 */
export async function mfaGate(role: StaffRole): Promise<MfaGateOutcome> {
  if (!mfaRequiredForRole(role)) return "ok";

  const status = await getMfaStatus();
  if (!status) return "error";
  if (status.currentLevel === "aal2") return "ok";
  return status.hasVerifiedFactor ? "challenge" : "enroll";
}

/**
 * Gate for sensitive server actions: require an aal2 session.
 * For roles that don't mandate MFA, a satisfied first factor is accepted.
 */
export async function requireAssuranceLevel(
  role: StaffRole,
  minimum: AssuranceLevel = "aal2",
): Promise<{ ok: true } | { ok: false; outcome: MfaGateOutcome }> {
  if (minimum === "aal1") return { ok: true };
  if (!mfaRequiredForRole(role)) return { ok: true };

  const outcome = await mfaGate(role);
  return outcome === "ok" ? { ok: true } : { ok: false, outcome };
}
