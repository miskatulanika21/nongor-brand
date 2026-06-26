/**
 * F-11 — authenticated password change requires re-authentication.
 *
 * Covers performPasswordUpdate on the NON-recovery path (no marker cookie):
 *   - a missing current password is rejected before any update;
 *   - a wrong current password is rejected (+ audited for staff), no update;
 *   - a correct current password proceeds and audits auth.password_changed;
 *   - the current password is verified on a THROWAWAY client (the request's
 *     session client is never used to sign in).
 *
 * The recovery/invite path (no current password, marker present) is covered in
 * auth-password-update.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, getIdentityMock, writeAuditMock, probeSignInMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getIdentityMock: vi.fn(),
  writeAuditMock: vi.fn(async () => undefined),
  probeSignInMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
  const builder: { validator: () => unknown; handler: (fn: unknown) => unknown } = {
    validator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
// No recovery marker → the re-auth (current-password) path.
vi.mock("@tanstack/react-start/server", () => ({
  setResponseHeaders: vi.fn(),
  getCookie: () => undefined,
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("@/lib/server/supabase.server", () => ({ createServerSupabaseClient: createClientMock }));
vi.mock("@/lib/server/identity.server", () => ({ getAuthenticatedIdentity: getIdentityMock }));
vi.mock("@/lib/server/env.server", () => ({
  getPublicSupabaseEnv: () => ({
    supabaseUrl: "http://localhost",
    supabaseAnonKey: "anon",
    siteUrl: "http://localhost:3000",
    nodeEnv: "test",
  }),
  isProduction: () => false,
}));
vi.mock("@/lib/server/security.server", () => ({
  checkCsrfOrigin: () => true,
  getClientIp: () => null,
  safeServerLog: vi.fn(),
}));
vi.mock("@/lib/server/rate-limit.server", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSec: 0 }),
  checkIndependentRateLimit: async () => ({ allowed: true, retryAfterSec: 0 }),
  rateLimitMessage: () => "Too many attempts.",
}));
vi.mock("@/lib/server/audit.server", () => ({ writeAudit: writeAuditMock }));
// The throwaway verification client.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: probeSignInMock,
      signOut: vi.fn(async () => ({ error: null })),
    },
  }),
}));

import { performPasswordUpdate } from "@/lib/server/auth.server";

const STAFF_PW = "NongorrStaff2026X";

function staff(role: "staff" | "admin" | "owner" = "admin") {
  return {
    ok: true as const,
    identity: {
      kind: "staff" as const,
      userId: "s1",
      email: "s@d.com",
      name: "Sam",
      role,
      staffProfileId: "uuid-1",
      isActive: true as const,
    },
  };
}
function customer() {
  return {
    ok: true as const,
    identity: { kind: "customer" as const, userId: "u1", email: "c@d.com", name: "Cathy" },
  };
}
function clientOk() {
  return { auth: { updateUser: vi.fn(async () => ({ error: null })) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  writeAuditMock.mockResolvedValue(undefined);
  probeSignInMock.mockResolvedValue({ error: null }); // current password valid by default
});

describe("performPasswordUpdate — authenticated change (F-11)", () => {
  it("rejects when no current password is supplied and there is no recovery marker", async () => {
    const client = clientOk();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(customer());

    const r = await performPasswordUpdate({ password: "newpass12", confirm: "newpass12" });

    expect(r).toEqual({ success: false, error: "Enter your current password to change it." });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password and audits the denial for staff", async () => {
    probeSignInMock.mockResolvedValue({ error: { message: "invalid" } });
    const client = clientOk();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(staff("admin"));

    const r = await performPasswordUpdate({
      password: STAFF_PW,
      confirm: STAFF_PW,
      currentPassword: "wrong-current",
    });

    expect(r).toEqual({ success: false, error: "Your current password is incorrect." });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.password_change.denied", actorId: "s1" }),
    );
  });

  it("proceeds with a correct current password and audits auth.password_changed", async () => {
    const client = clientOk();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(staff("admin"));

    const r = await performPasswordUpdate({
      password: STAFF_PW,
      confirm: STAFF_PW,
      currentPassword: "right-current",
    });

    expect(r).toMatchObject({ success: true, destination: "/admin" });
    expect(probeSignInMock).toHaveBeenCalledWith({ email: "s@d.com", password: "right-current" });
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.password_changed", actorId: "s1" }),
    );
  });

  it("verifies the current password on a throwaway client, not the session client", async () => {
    const client = clientOk();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(customer());

    await performPasswordUpdate({
      password: "newpass12",
      confirm: "newpass12",
      currentPassword: "right-current",
    });

    // The session client only updates; it is never used to sign in.
    expect(client).not.toHaveProperty("auth.signInWithPassword");
    expect(probeSignInMock).toHaveBeenCalledTimes(1);
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
  });
});
