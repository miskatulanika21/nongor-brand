/**
 * Server-only environment validation.
 *
 * The .server.ts suffix prevents Vite from bundling this into the client.
 * On Cloudflare Workers, env binds at REQUEST time, so reads MUST happen
 * inside a function, never at module scope.
 *
 * Split into two tiers:
 *   - getPublicSupabaseEnv()     → normal auth/SSR (anon key only)
 *   - getPrivilegedSupabaseEnv() → admin/system operations (service-role key)
 *
 * Normal login/session operations MUST NOT require the service-role key.
 */

import process from "node:process";

// ---- Types ------------------------------------------------------------------

export interface PublicEnv {
  /** Supabase project URL */
  supabaseUrl: string;
  /** Supabase anon/publishable key (safe for browser) */
  supabaseAnonKey: string;
  /** Public site URL (used for redirects, email links) */
  siteUrl: string;
  /** Node environment */
  nodeEnv: string;
}

export interface PrivilegedEnv extends PublicEnv {
  /** Supabase service-role key (server-only, NEVER in browser) */
  supabaseServiceRoleKey: string;
}

// ---- Public env (normal auth) -----------------------------------------------

/**
 * Read and validate the public Supabase environment variables.
 * These are all that's needed for normal customer and staff auth flows.
 *
 * Call this inside a request handler, never at module scope.
 * @throws {Error} if any required variable is missing.
 */
export function getPublicSupabaseEnv(): PublicEnv {
  const supabaseUrl = requireEnv("VITE_SUPABASE_URL");
  const supabaseAnonKey = requireEnv("VITE_SUPABASE_ANON_KEY");
  const siteUrl = process.env.VITE_SITE_URL || "http://localhost:8080"; // canonical dev port (vite server)
  const nodeEnv = process.env.NODE_ENV || "development";

  return { supabaseUrl, supabaseAnonKey, siteUrl, nodeEnv };
}

// ---- Privileged env (admin operations) --------------------------------------

/**
 * Read and validate ALL Supabase environment variables including the
 * service-role key. Use ONLY for privileged system operations:
 *   - Admin provisioning
 *   - Database seeding
 *   - Migrations
 *
 * NEVER call this for normal customer auth, session reads, or SSR.
 *
 * @throws {Error} if the service-role key is missing.
 */
export function getPrivilegedSupabaseEnv(): PrivilegedEnv {
  const publicEnv = getPublicSupabaseEnv();
  const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return { ...publicEnv, supabaseServiceRoleKey };
}

// ---- Legacy alias (for backward compat during migration) --------------------

/**
 * @deprecated Use getPublicSupabaseEnv() for normal auth,
 *             getPrivilegedSupabaseEnv() for admin operations.
 */
export function getServerEnv(): PrivilegedEnv {
  return getPrivilegedSupabaseEnv();
}

// ---- Utility ----------------------------------------------------------------

/**
 * Returns true when running in production.
 * Safe to call at request time.
 */
export function isProduction(): boolean {
  return (process.env.NODE_ENV || "development") === "production";
}

/**
 * Whether an OAuth provider is offered. The flag is a PUBLIC signal that the
 * provider has been configured in the Supabase dashboard; Supabase holds the
 * actual client secret. Mirrors src/lib/auth-config.ts for the server side.
 */
export function isProviderConfigured(provider: "google" | "facebook"): boolean {
  const flag =
    provider === "google"
      ? process.env.VITE_ENABLE_GOOGLE_OAUTH
      : process.env.VITE_ENABLE_FACEBOOK_OAUTH;
  return flag === "true" || flag === "1";
}

/**
 * Whether mandatory MFA enforcement for owner/admin is turned on for this
 * deployment. Kept OFF by default so enforcement cannot lock out the owner
 * before TOTP MFA is enabled in the Supabase dashboard AND an owner has
 * enrolled. Turn on (ENFORCE_ADMIN_MFA=true) as a documented go-live step.
 */
export function isAdminMfaEnforced(): boolean {
  return process.env.ENFORCE_ADMIN_MFA === "true";
}

// ---- Startup validation -----------------------------------------------------

/**
 * Validate critical environment variables. In production, missing/malformed
 * required variables throw (fail fast). In development, problems are logged
 * but startup proceeds with descriptive guidance — never with an unsafe
 * fallback secret. Call once at server boot. (Spec §35.)
 */
export function validateEnvAtStartup(): void {
  const problems: string[] = [];

  for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const) {
    if (!process.env[name]) problems.push(`Missing required public variable: ${name}`);
  }

  const url = process.env.VITE_SUPABASE_URL;
  if (url && !/^https:\/\/.+\.supabase\.co\/?$/.test(url) && !url.startsWith("http://localhost")) {
    problems.push("VITE_SUPABASE_URL does not look like a Supabase project URL.");
  }

  // Service-role key is required for privileged operations (provisioning,
  // audit writes). Warn rather than block normal auth if it is absent.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push(
      "SUPABASE_SERVICE_ROLE_KEY is not set — provisioning and audit logging will be unavailable.",
    );
  }

  // A VITE_-prefixed copy of the service-role key would be bundled into the
  // CLIENT by Vite — a critical leak. Detect the misconfigured *variable*.
  if (process.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    problems.push(
      "VITE_SUPABASE_SERVICE_ROLE_KEY is set — the service-role key must never use a VITE_ prefix (it would ship to the browser).",
    );
  }

  // Reject obvious placeholder values so a half-filled .env cannot reach prod.
  const PLACEHOLDER = /your[-_]|changeme|replace[-_]?me|example\.com|xxxx|<.*>/i;
  for (const name of [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const) {
    const v = process.env[name];
    if (v && PLACEHOLDER.test(v)) {
      problems.push(`${name} still contains a placeholder value.`);
    }
  }

  // ── Courier integration (Stage 5) ──────────────────────────────────────────
  // Courier keys are optional (feature is degraded without them). These are
  // non-blocking warnings — they never prevent server startup.
  const courierWarnings: string[] = [];

  if (!process.env.STEADFAST_API_KEY || !process.env.STEADFAST_SECRET_KEY) {
    courierWarnings.push(
      "STEADFAST_API_KEY / STEADFAST_SECRET_KEY not set — SteadFast courier booking will be unavailable.",
    );
  }
  if (!process.env.PATHAO_CLIENT_ID || !process.env.PATHAO_CLIENT_SECRET) {
    if (!process.env.PATHAO_SANDBOX_CLIENT_ID || !process.env.PATHAO_SANDBOX_CLIENT_SECRET) {
      courierWarnings.push(
        "PATHAO_CLIENT_ID / PATHAO_CLIENT_SECRET not set — Pathao courier booking will be unavailable.",
      );
    }
  }

  // Detect leaked courier secrets (VITE_ prefix → bundled to browser)
  // These ARE blocking problems — a leaked secret is a security issue.
  for (const name of [
    "VITE_STEADFAST_API_KEY",
    "VITE_STEADFAST_SECRET_KEY",
    "VITE_PATHAO_CLIENT_ID",
    "VITE_PATHAO_CLIENT_SECRET",
    "VITE_STEADFAST_WEBHOOK_SECRET",
    "VITE_PATHAO_WEBHOOK_SECRET",
  ] as const) {
    if (process.env[name]) {
      problems.push(
        `${name} is set — courier secrets must never use a VITE_ prefix (they would ship to the browser).`,
      );
    }
  }

  // Emit courier warnings (non-blocking, always warn)
  if (courierWarnings.length > 0) {
    console.warn(`[env] Courier warnings:\n  - ${courierWarnings.join("\n  - ")}`);
  }

  if (problems.length === 0) return;

  const message = `[env] Configuration problems:\n  - ${problems.join("\n  - ")}`;
  if (isProduction()) {
    throw new Error(message);
  }
  console.warn(message);
}

let envValidated = false;

/**
 * Idempotent guard around validateEnvAtStartup(), used by the server entry on
 * first request.
 *
 * The success flag is set ONLY AFTER validation completes. If validation throws
 * (misconfigured production), the flag stays false, so a later request re-runs
 * validation and is rejected again — it does not silently bypass validation as
 * a "set the flag first" ordering would. On success the flag latches so the
 * (synchronous, cheap) checks run once.
 */
export function ensureEnvValidated(): void {
  if (envValidated) return;
  validateEnvAtStartup();
  envValidated = true;
}

// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in the value.`,
    );
  }
  return value;
}
