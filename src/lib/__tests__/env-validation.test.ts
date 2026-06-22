/**
 * Regression tests for the env-validation latch (Item 1).
 *
 * The bug: the "validated" flag was set BEFORE validateEnvAtStartup() ran, so a
 * throw in production left the flag latched and every later request bypassed
 * validation. ensureEnvValidated() (in env.server.ts, called by the server
 * entry on each request) now records success only AFTER validation completes.
 *
 * vi.resetModules() gives each test a fresh module-level latch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("ensureEnvValidated — latch ordering", () => {
  it("in production, invalid config throws AND a later request is not bypassed", async () => {
    setEnv({
      NODE_ENV: "production",
      VITE_SUPABASE_URL: undefined,
      VITE_SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });
    const { ensureEnvValidated } = await import("@/lib/server/env.server");

    // Request 1: validation runs and throws.
    expect(() => ensureEnvValidated()).toThrow();
    // Request 2: must STILL throw — a failed validation must not latch as "ok".
    expect(() => ensureEnvValidated()).toThrow();
  });

  it("latches after success: a later call does not re-validate even if env later breaks", async () => {
    setEnv({
      NODE_ENV: "production",
      VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    });
    const { ensureEnvValidated } = await import("@/lib/server/env.server");

    // First call validates successfully and latches.
    expect(() => ensureEnvValidated()).not.toThrow();

    // Break the env, then call again: because success latched, validation is
    // NOT repeated, so it must not throw now.
    setEnv({ VITE_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(() => ensureEnvValidated()).not.toThrow();
  });
});
