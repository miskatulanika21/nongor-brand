/**
 * MFA enrollment hardening tests (Item 3) for performStartMfaEnrollment.
 *
 * Proves: first-factor enrollment at AAL1; additional-factor enrollment denied
 * at AAL1 but allowed at AAL2; rate-limit enforcement; stale unverified factors
 * are cleaned up (no pile-up); audit actor/action correctness; and that the
 * TOTP secret / QR payload never appear in audit metadata.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireStaffMock, rateLimitMock, writeAuditMock, createClientMock } = vi.hoisted(() => ({
  requireStaffMock: vi.fn(),
  rateLimitMock: vi.fn(),
  writeAuditMock: vi.fn(
    async (_entry: {
      action: string;
      actorId: string | null;
      metadata?: Record<string, unknown>;
    }) => undefined,
  ),
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
vi.mock("@/lib/server/audit.server", () => ({ writeAudit: writeAuditMock }));

import { performStartMfaEnrollment } from "@/lib/mfa.api";

type Factor = { id: string; factor_type: "totp" | "phone"; status: "verified" | "unverified" };

function makeSupabase(opts: {
  factors?: Factor[];
  currentLevel?: "aal1" | "aal2";
  enrollData?: unknown;
  enrollError?: unknown;
  listError?: unknown;
}) {
  const all = opts.factors ?? [];
  // Mirror the SDK: `totp` is the convenience list of VERIFIED totp factors.
  const totp = all.filter((f) => f.factor_type === "totp" && f.status === "verified");
  const listFactors = vi.fn(async () => ({
    data: opts.listError ? null : { all, totp },
    error: opts.listError ?? null,
  }));
  const getAuthenticatorAssuranceLevel = vi.fn(async () => ({
    data: { currentLevel: opts.currentLevel ?? "aal1", nextLevel: opts.currentLevel ?? "aal1" },
    error: null,
  }));
  const enroll = vi.fn(async () => ({
    data: opts.enrollData ?? null,
    error: opts.enrollError ?? null,
  }));
  const unenroll = vi.fn(async () => ({ data: {}, error: null }));
  const client = {
    auth: { mfa: { listFactors, getAuthenticatorAssuranceLevel, enroll, unenroll } },
  };
  return { client, listFactors, getAuthenticatorAssuranceLevel, enroll, unenroll };
}

const ENROLL_OK = {
  id: "factor-new",
  totp: { qr_code: "QR_DATA", uri: "otpauth://totp/x", secret: "TOTPSECRET" },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffMock.mockResolvedValue({
    ok: true,
    identity: { kind: "staff", userId: "s1", role: "admin" },
  });
  rateLimitMock.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  writeAuditMock.mockResolvedValue(undefined);
});

describe("performStartMfaEnrollment", () => {
  it("allows first-factor enrollment at AAL1 and audits initiation WITHOUT secret/QR", async () => {
    const sb = makeSupabase({ factors: [], enrollData: ENROLL_OK });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r).toMatchObject({ success: true, factorId: "factor-new", secret: "TOTPSECRET" });
    expect(sb.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled(); // no verified factor → no aal2 gate
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa.enroll.started", actorId: "s1" }),
    );
    // The audit metadata must NOT contain the secret/QR/uri.
    const meta = JSON.stringify(writeAuditMock.mock.calls.at(-1)?.[0]?.metadata ?? {});
    expect(meta).not.toContain("TOTPSECRET");
    expect(meta).not.toContain("QR_DATA");
    expect(meta).not.toContain("otpauth://");
  });

  it("denies an additional factor at AAL1 (verified factor exists) and does not enroll", async () => {
    const sb = makeSupabase({
      factors: [{ id: "v1", factor_type: "totp", status: "verified" }],
      currentLevel: "aal1",
    });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r).toMatchObject({ success: false, requiresAal2: true });
    expect(sb.enroll).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa.enroll.denied", actorId: "s1" }),
    );
  });

  it("allows an additional factor at AAL2", async () => {
    const sb = makeSupabase({
      factors: [{ id: "v1", factor_type: "totp", status: "verified" }],
      currentLevel: "aal2",
      enrollData: ENROLL_OK,
    });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r).toMatchObject({ success: true, factorId: "factor-new" });
    expect(sb.enroll).toHaveBeenCalledTimes(1);
  });

  it("enforces the rate limit before touching the provider", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, retryAfterSec: 60 });
    const sb = makeSupabase({ enrollData: ENROLL_OK });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r).toEqual({ success: false, error: "Too many attempts." });
    expect(sb.listFactors).not.toHaveBeenCalled();
    expect(sb.enroll).not.toHaveBeenCalled();
  });

  it("cleans up stale unverified factors so they do not pile up", async () => {
    const sb = makeSupabase({
      factors: [
        { id: "u1", factor_type: "totp", status: "unverified" },
        { id: "u2", factor_type: "totp", status: "unverified" },
      ],
      enrollData: ENROLL_OK,
    });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r).toMatchObject({ success: true });
    expect(sb.unenroll).toHaveBeenCalledTimes(2);
    expect(sb.unenroll).toHaveBeenCalledWith({ factorId: "u1" });
    expect(sb.unenroll).toHaveBeenCalledWith({ factorId: "u2" });
    expect(sb.enroll).toHaveBeenCalledTimes(1);
  });

  it("audits a provider failure and returns a generic error", async () => {
    const sb = makeSupabase({ enrollData: null, enrollError: { code: "mfa_disabled" } });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r.success).toBe(false);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mfa.enroll.failed", actorId: "s1" }),
    );
  });

  it("rejects an unauthenticated caller before any provider call", async () => {
    requireStaffMock.mockResolvedValue({ ok: false, reason: "unauthenticated", actorId: null });
    const sb = makeSupabase({ enrollData: ENROLL_OK });
    createClientMock.mockReturnValue(sb.client);

    const r = await performStartMfaEnrollment();

    expect(r).toEqual({ success: false, error: "Not authorized." });
    expect(sb.listFactors).not.toHaveBeenCalled();
  });
});
