/**
 * Authorization-ordering + actor-attribution tests for the staff mutations
 * (Items 2 & 4).
 *
 * Proves performUpdateStaffRole / performSetStaffActive:
 *   - authorize the BASELINE (admin) BEFORE creating the service-role client or
 *     querying staff_profiles → an unauthorized caller gets NO existence oracle
 *     (the admin client is never even constructed);
 *   - elevate to owner for owner-sensitive changes;
 *   - attribute authz.denied audits to the verified actor (null only when the
 *     caller was unauthenticated).
 *
 * The REAL meetsMinimumRole is used; only I/O boundaries are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireRoleMock, createAdminMock, writeAuditMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  createAdminMock: vi.fn(),
  writeAuditMock: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-start", () => {
  const builder: { validator: () => unknown; handler: (fn: unknown) => unknown } = {
    validator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@tanstack/react-start/server", () => ({ setResponseHeaders: vi.fn() }));
vi.mock("@/lib/server/env.server", () => ({
  getPublicSupabaseEnv: () => ({ siteUrl: "http://localhost:3000" }),
  isAdminMfaEnforced: () => false, // step-up is a no-op here; tested separately
}));
vi.mock("@/lib/server/security.server", () => ({
  checkCsrfOrigin: () => true,
  getClientIp: () => null,
  safeServerLog: vi.fn(),
}));
vi.mock("@/lib/server/rbac.server", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/server/supabase-admin.server", () => ({
  createAdminSupabaseClient: createAdminMock,
}));
vi.mock("@/lib/server/audit.server", () => ({ writeAudit: writeAuditMock }));

import { performUpdateStaffRole, performSetStaffActive } from "@/lib/server/staff-ops.server";

function staffIdentity(role: "staff" | "admin" | "owner", userId: string) {
  return {
    kind: "staff" as const,
    userId,
    email: null,
    name: null,
    role,
    staffProfileId: 1,
    isActive: true as const,
  };
}

function makeAdmin(target: { role: string } | null, rpcError: unknown = null) {
  const rpcSpy = vi.fn(async () => ({ error: rpcError }));
  const fromSpy = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: target, error: null }) }) }),
  }));
  const client = { from: fromSpy, schema: () => ({ rpc: rpcSpy }) };
  return { client, fromSpy, rpcSpy };
}

const ROLE_CHANGE = {
  targetUserId: "11111111-1111-1111-1111-111111111111",
  newRole: "staff" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  writeAuditMock.mockResolvedValue(undefined);
});

describe("performUpdateStaffRole — authorization ordering (no existence oracle)", () => {
  it("unauthenticated caller: never builds the admin client; denial audited with null actor", async () => {
    requireRoleMock.mockResolvedValue({ ok: false, reason: "unauthenticated", actorId: null });

    const r = await performUpdateStaffRole(ROLE_CHANGE);

    expect(r.success).toBe(false);
    expect(createAdminMock).not.toHaveBeenCalled(); // no privileged query → no oracle
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "authz.denied", actorId: null }),
    );
  });

  it("customer caller: no privileged query; denial attributed to the verified actor", async () => {
    requireRoleMock.mockResolvedValue({ ok: false, reason: "is_customer", actorId: "cust-1" });

    const r = await performUpdateStaffRole(ROLE_CHANGE);

    expect(r.success).toBe(false);
    expect(createAdminMock).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "authz.denied", actorId: "cust-1" }),
    );
  });

  it("staff caller without permission: no privileged query; actor attributed", async () => {
    requireRoleMock.mockResolvedValue({ ok: false, reason: "forbidden", actorId: "staff-1" });

    const r = await performUpdateStaffRole(ROLE_CHANGE);

    expect(r.success).toBe(false);
    expect(createAdminMock).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "authz.denied", actorId: "staff-1" }),
    );
  });

  it("admin managing an ordinary staff member: allowed", async () => {
    requireRoleMock.mockResolvedValue({ ok: true, identity: staffIdentity("admin", "admin-1") });
    const admin = makeAdmin({ role: "staff" });
    createAdminMock.mockReturnValue(admin.client);

    const r = await performUpdateStaffRole(ROLE_CHANGE);

    expect(r.success).toBe(true);
    expect(admin.rpcSpy).toHaveBeenCalledTimes(1);
  });

  it("admin attempting an owner-sensitive change: denied, RPC never called", async () => {
    requireRoleMock.mockResolvedValue({ ok: true, identity: staffIdentity("admin", "admin-1") });
    const admin = makeAdmin({ role: "owner" }); // target is an owner
    createAdminMock.mockReturnValue(admin.client);

    const r = await performUpdateStaffRole(ROLE_CHANGE);

    expect(r.success).toBe(false);
    expect(admin.rpcSpy).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "authz.denied", actorId: "admin-1" }),
    );
  });

  it("owner performing an owner-sensitive change: allowed", async () => {
    requireRoleMock.mockResolvedValue({ ok: true, identity: staffIdentity("owner", "owner-1") });
    const admin = makeAdmin({ role: "owner" });
    createAdminMock.mockReturnValue(admin.client);

    const r = await performUpdateStaffRole({ ...ROLE_CHANGE, newRole: "owner" });

    expect(r.success).toBe(true);
    expect(admin.rpcSpy).toHaveBeenCalledTimes(1);
  });

  it("missing target only reachable AFTER authorization", async () => {
    requireRoleMock.mockResolvedValue({ ok: true, identity: staffIdentity("admin", "admin-1") });
    const admin = makeAdmin(null); // no such staff row
    createAdminMock.mockReturnValue(admin.client);

    const r = await performUpdateStaffRole(ROLE_CHANGE);

    expect(r).toEqual({ success: false, error: "Staff member not found." });
    // The lookup ran only because the caller was already authorized.
    expect(admin.fromSpy).toHaveBeenCalled();
  });
});

describe("performSetStaffActive — authorization ordering", () => {
  const DEACTIVATE = { targetUserId: "22222222-2222-2222-2222-222222222222", active: false };

  it("unauthenticated caller: never builds the admin client", async () => {
    requireRoleMock.mockResolvedValue({ ok: false, reason: "unauthenticated", actorId: null });

    const r = await performSetStaffActive(DEACTIVATE);

    expect(r.success).toBe(false);
    expect(createAdminMock).not.toHaveBeenCalled();
  });

  it("admin deactivating an owner: denied; admin deactivating staff: allowed", async () => {
    // owner target → denied for admin
    requireRoleMock.mockResolvedValue({ ok: true, identity: staffIdentity("admin", "admin-1") });
    const ownerTarget = makeAdmin({ role: "owner" });
    createAdminMock.mockReturnValue(ownerTarget.client);
    expect((await performSetStaffActive(DEACTIVATE)).success).toBe(false);
    expect(ownerTarget.rpcSpy).not.toHaveBeenCalled();

    // staff target → allowed
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ ok: true, identity: staffIdentity("admin", "admin-1") });
    const staffTarget = makeAdmin({ role: "staff" });
    createAdminMock.mockReturnValue(staffTarget.client);
    expect((await performSetStaffActive(DEACTIVATE)).success).toBe(true);
    expect(staffTarget.rpcSpy).toHaveBeenCalledTimes(1);
  });
});
