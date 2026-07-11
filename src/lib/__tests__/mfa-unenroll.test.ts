/**
 * F-10 — MFA factor removal hardening (performUnenrollMfa).
 *
 * Proves: removal requires a current AAL2 session (an aal1 session is denied +
 * audited, no unenroll call); at aal2 the factor is removed + audited; the
 * rate limit is enforced before any provider call; and the MFA-mandatory-role
 * "keep at least one factor" backstop still holds at aal2.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireStaffMock, rateLimitMock, writeAuditMock, createClientMock } = vi.hoisted(() => ({
  requireStaffMock: vi.fn(),
  rateLimitMock: vi.fn(),
  writeAuditMock: vi.fn(async () => undefined),
  createClientMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
  const builder: { validator: () => unknown; handler: (fn: unknown) => unknown } = {
    validator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@tanstack/react-start/server", () => ({ setResponseHeaders: vi.fn() }));
vi.mock("@/lib/server/supabase.server", () => ({ createServerSupabaseClient: createClientMock }));
vi.mock("@/lib/server/env.server", () => ({
  getPublicSupabaseEnv: () => ({ siteUrl: "http://localhost:3000" }),
}));
vi.mock("@/lib/server/security.server", () => ({
  checkCsrfOrigin: () => true,
  getClientIp: () => "10.0.0.1",
  safeServerLog: vi.fn(),
}));
vi.mock("@/lib/server/identity.server", () => ({ requireStaff: requireStaffMock }));
vi.mock("@/lib/server/rate-limit.server", () => ({
  checkIndependentRateLimit: rateLimitMock,
  rateLimitMessage: () => "Too many attempts.",
}));
vi.mock("@/lib/server/mfa.server", () => ({
  mfaRequiredForRole: (role: string) => role === "owner" || role === "admin",
}));
vi.mock("@/lib/server/audit.server", () => ({ writeAudit: writeAuditMock }));

import { performUnenrollMfa } from "@/lib/server/mfa-ops.server";

type Factor = { id: string; factor_type: "totp"; status: "verified" | "unverified" };

function makeSupabase(opts: { currentLevel?: "aal1" | "aal2"; factors?: Factor[] }) {
  const all = opts.factors ?? [];
  const totp = all.filter((f) => f.factor_type === "totp" && f.status === "verified");
  const getAuthenticatorAssuranceLevel = vi.fn(async () => ({
    data: { currentLevel: opts.currentLevel ?? "aal1", nextLevel: "aal2" },
    error: null,
  }));
  const listFactors = vi.fn(async () => ({ data: { all, totp }, error: null }));
  const unenroll = vi.fn(async () => ({ data: {}, error: null }));
  const client = {
    auth: { mfa: { getAuthenticatorAssuranceLevel, listFactors, unenroll } },
  };
  return { client, getAuthenticatorAssuranceLevel, listFactors, unenroll };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffMock.mockResolvedValue({
    ok: true,
    identity: { kind: "staff", userId: "s1", role: "admin" },
  });
  rateLimitMock.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  writeAuditMock.mockResolvedValue(undefined);
});

describe("performUnenrollMfa (F-10)", () => {
  it("denies removal on an aal1 session and does not unenroll", async () => {
    const sb = makeSupabase({ currentLevel: "aal1" });
    createClientMock.mockReturnValue(sb.client);

    const r = await performUnenrollMfa({ factorId: "f1" });

    expect(r).toMatchObject({ success: false, requiresAal2: true });
    expect(sb.unenroll).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa.remove.denied", actorId: "s1" }),
    );
  });

  it("removes the factor at aal2 (two factors) and audits", async () => {
    const sb = makeSupabase({
      currentLevel: "aal2",
      factors: [
        { id: "f1", factor_type: "totp", status: "verified" },
        { id: "f2", factor_type: "totp", status: "verified" },
      ],
    });
    createClientMock.mockReturnValue(sb.client);

    const r = await performUnenrollMfa({ factorId: "f1" });

    expect(r).toEqual({ success: true });
    expect(sb.unenroll).toHaveBeenCalledWith({ factorId: "f1" });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa.removed", actorId: "s1", targetId: "f1" }),
    );
  });

  it("blocks dropping below one factor for an MFA-mandatory role even at aal2", async () => {
    const sb = makeSupabase({
      currentLevel: "aal2",
      factors: [{ id: "f1", factor_type: "totp", status: "verified" }],
    });
    createClientMock.mockReturnValue(sb.client);

    const r = await performUnenrollMfa({ factorId: "f1" });

    expect(r.success).toBe(false);
    expect(sb.unenroll).not.toHaveBeenCalled();
  });

  it("enforces the rate limit before any provider call", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, retryAfterSec: 60 });
    const sb = makeSupabase({ currentLevel: "aal2" });
    createClientMock.mockReturnValue(sb.client);

    const r = await performUnenrollMfa({ factorId: "f1" });

    expect(r).toEqual({ success: false, error: "Too many attempts." });
    expect(sb.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(sb.unenroll).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before touching the provider", async () => {
    requireStaffMock.mockResolvedValue({ ok: false, reason: "unauthenticated", actorId: null });
    const sb = makeSupabase({ currentLevel: "aal2" });
    createClientMock.mockReturnValue(sb.client);

    const r = await performUnenrollMfa({ factorId: "f1" });

    expect(r).toEqual({ success: false, error: "Not authorized." });
    expect(sb.unenroll).not.toHaveBeenCalled();
  });
});
