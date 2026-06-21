/**
 * Orchestration regression tests for the three same-request auth transactions
 * extracted into auth.api.ts: performEmailLogin, performOAuthCallback,
 * performEmailConfirm.
 *
 * The bug class (Issue A): identity resolution after authentication used a
 * FRESH cookie-derived client that could not see the just-issued session.
 * These tests prove the fix at the orchestration level:
 *   - each flow creates exactly ONE Supabase client,
 *   - runs the auth mutation on it,
 *   - threads THAT SAME instance into getAuthenticatedIdentity, and
 *   - on denial, threads it into invalidateSession.
 *
 * The dynamically-imported server modules are mocked, so no network/cookies are
 * touched and the tests stay pure units.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, getIdentityMock, invalidateMock, writeAuditMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getIdentityMock: vi.fn(),
  invalidateMock: vi.fn(async () => undefined),
  writeAuditMock: vi.fn(async () => undefined),
}));

// Keep the createServerFn wrapper trivial so importing auth.api.ts does not
// pull in the server runtime — we test the extracted plain functions directly.
vi.mock("@tanstack/react-start", () => {
  const builder: { validator: () => unknown; handler: (fn: unknown) => unknown } = {
    validator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@tanstack/react-start/server", () => ({ setResponseHeaders: vi.fn() }));

vi.mock("@/lib/server/supabase.server", () => ({
  createServerSupabaseClient: createClientMock,
}));
vi.mock("@/lib/server/identity.server", () => ({
  getAuthenticatedIdentity: getIdentityMock,
  invalidateSession: invalidateMock,
}));
vi.mock("@/lib/server/env.server", () => ({
  getPublicSupabaseEnv: () => ({
    supabaseUrl: "http://localhost",
    supabaseAnonKey: "anon",
    siteUrl: "http://localhost:3000",
    nodeEnv: "test",
  }),
}));
vi.mock("@/lib/server/security.server", () => ({
  checkCsrfOrigin: () => true,
  getClientIp: () => null,
  safeServerLog: vi.fn(),
}));
vi.mock("@/lib/server/rate-limit.server", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSec: 0 }),
  rateLimitMessage: () => "Too many attempts.",
}));
vi.mock("@/lib/server/audit.server", () => ({ writeAudit: writeAuditMock }));
vi.mock("@/lib/server/login-destination.server", () => ({
  resolvePostLoginDestination: () => ({ destination: "/admin", adminDenied: false }),
}));

import { performEmailLogin, performOAuthCallback, performEmailConfirm } from "@/lib/auth.api";

const STAFF = {
  ok: true as const,
  identity: {
    kind: "staff" as const,
    userId: "u1",
    email: "a@b.com",
    name: "Boss",
    role: "admin" as const,
    staffProfileId: 1,
    isActive: true as const,
  },
};

type AuthResult = { error: { message: string } | null };

function fakeClient() {
  return {
    auth: {
      signInWithPassword: vi.fn(async (): Promise<AuthResult> => ({ error: null })),
      exchangeCodeForSession: vi.fn(async (): Promise<AuthResult> => ({ error: null })),
      verifyOtp: vi.fn(async (): Promise<AuthResult> => ({ error: null })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateMock.mockResolvedValue(undefined);
  writeAuditMock.mockResolvedValue(undefined);
});

// ---- performEmailLogin ------------------------------------------------------

describe("performEmailLogin", () => {
  it("creates one client, signs in on it, and threads THAT client into identity resolution", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(STAFF);

    const result = await performEmailLogin({ email: "a@b.com", password: "secret" });

    expect(result.success).toBe(true);
    expect(createClientMock).toHaveBeenCalledTimes(1); // no extra fresh client
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(getIdentityMock).toHaveBeenCalledWith({ strict: true, client });
  });

  it("on denial, threads the SAME client into invalidateSession", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue({ ok: false, reason: "lookup_failed" });

    const result = await performEmailLogin({ email: "a@b.com", password: "secret" });

    expect(result.success).toBe(false);
    expect(invalidateMock).toHaveBeenCalledWith(client);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it("does not resolve identity when credentials are rejected", async () => {
    const client = fakeClient();
    client.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "bad creds" } });
    createClientMock.mockReturnValue(client);

    const result = await performEmailLogin({ email: "a@b.com", password: "wrong" });

    expect(result.success).toBe(false);
    expect(getIdentityMock).not.toHaveBeenCalled();
  });
});

// ---- performOAuthCallback ---------------------------------------------------

describe("performOAuthCallback", () => {
  it("exchanges the code and threads THAT client into identity resolution", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(STAFF);

    const result = await performOAuthCallback({ code: "abc" });

    expect(result.success).toBe(true);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(getIdentityMock).toHaveBeenCalledWith({ strict: true, client });
  });

  it("on denial, threads the SAME client into invalidateSession", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue({ ok: false, reason: "inactive_staff" });

    const result = await performOAuthCallback({ code: "abc" });

    expect(result.redirect).toBe("/login?notice=inactive");
    expect(invalidateMock).toHaveBeenCalledWith(client);
  });

  it("does not resolve identity when the code exchange fails", async () => {
    const client = fakeClient();
    client.auth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "bad code" } });
    createClientMock.mockReturnValue(client);

    const result = await performOAuthCallback({ code: "bad" });

    expect(result.success).toBe(false);
    expect(getIdentityMock).not.toHaveBeenCalled();
  });
});

// ---- performEmailConfirm ----------------------------------------------------

describe("performEmailConfirm", () => {
  it("verifies the OTP and threads THAT client into identity resolution (email)", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(STAFF);

    const result = await performEmailConfirm({ token_hash: "tok", type: "email" });

    expect(result.success).toBe(true);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "tok", type: "email" });
    expect(getIdentityMock).toHaveBeenCalledWith({ strict: true, client });
  });

  it("magic link also threads the same verification client", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(STAFF);

    await performEmailConfirm({ token_hash: "tok", type: "magiclink" });

    expect(getIdentityMock).toHaveBeenCalledWith({ strict: true, client });
  });

  it("recovery routes to the STANDALONE update-password screen without resolving identity", async () => {
    const client = fakeClient();
    createClientMock.mockReturnValue(client);

    const result = await performEmailConfirm({ token_hash: "tok", type: "recovery" });

    expect(result).toMatchObject({
      success: true,
      type: "recovery",
      destination: "/auth/update-password",
    });
    expect(getIdentityMock).not.toHaveBeenCalled();
  });

  it("invalid token does not resolve identity", async () => {
    const client = fakeClient();
    client.auth.verifyOtp.mockResolvedValueOnce({ error: { message: "expired" } });
    createClientMock.mockReturnValue(client);

    const result = await performEmailConfirm({ token_hash: "tok", type: "email" });

    expect(result.success).toBe(false);
    expect(getIdentityMock).not.toHaveBeenCalled();
  });
});
