/**
 * Phase 2 — role-aware post-recovery password update.
 *
 * Tests performPasswordUpdate (the extracted core of the updatePassword server
 * fn). The REAL resolvePostLoginDestination (and its safe-redirect / admin-route
 * permission logic) is used — only the I/O boundaries are mocked — so the
 * role-aware destination + safe-`next` behavior is genuinely exercised:
 *   - customer            → /account (and may NOT use `next` to reach /admin)
 *   - staff/admin/owner   → /admin (a storefront `next` cannot override this)
 *   - denied/expired auth → controlled failure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, getIdentityMock, writeAuditMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getIdentityMock: vi.fn(),
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

vi.mock("@/lib/server/supabase.server", () => ({ createServerSupabaseClient: createClientMock }));
vi.mock("@/lib/server/identity.server", () => ({ getAuthenticatedIdentity: getIdentityMock }));
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
  checkIndependentRateLimit: async () => ({ allowed: true, retryAfterSec: 0 }),
  rateLimitMessage: () => "Too many attempts.",
}));
vi.mock("@/lib/server/audit.server", () => ({ writeAudit: writeAuditMock }));
// NOTE: login-destination.server, safe-redirect, admin-routes, validation are
// intentionally NOT mocked — the real role-aware logic is what we want to test.

import { performPasswordUpdate } from "@/lib/auth.api";

// Strong enough for the privileged (staff) password tier (>=12, mixed classes).
const STAFF_PW = "NongorrStaff2026X";

function customer() {
  return {
    ok: true as const,
    identity: { kind: "customer" as const, userId: "u1", email: "c@d.com", name: "Cathy" },
  };
}
function staff(role: "staff" | "admin" | "owner") {
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

function clientOk() {
  return { auth: { updateUser: vi.fn(async () => ({ error: null })) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  writeAuditMock.mockResolvedValue(undefined);
});

// ---- Role-aware destinations (no next) --------------------------------------

describe("performPasswordUpdate — default role-aware destination", () => {
  it("customer → /account", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(customer());
    const r = await performPasswordUpdate({ password: "whatever1", confirm: "whatever1" });
    expect(r).toMatchObject({ success: true, destination: "/account" });
  });

  it("staff → /admin", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(staff("staff"));
    const r = await performPasswordUpdate({ password: STAFF_PW, confirm: STAFF_PW });
    expect(r).toMatchObject({ success: true, destination: "/admin" });
  });

  it("owner → /admin", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(staff("owner"));
    const r = await performPasswordUpdate({ password: STAFF_PW, confirm: STAFF_PW });
    expect(r).toMatchObject({ success: true, destination: "/admin" });
  });
});

// ---- Role-aware `next` (authorization separate from URL safety) -------------

describe("performPasswordUpdate — role-aware next", () => {
  it("customer next=/admin → /account (privileged route denied)", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(customer());
    const r = await performPasswordUpdate({
      password: "whatever1",
      confirm: "whatever1",
      next: "/admin",
    });
    expect(r).toMatchObject({ success: true, destination: "/account" });
  });

  it("customer next=/orders → /orders (approved customer route honored)", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(customer());
    const r = await performPasswordUpdate({
      password: "whatever1",
      confirm: "whatever1",
      next: "/orders",
    });
    expect(r).toMatchObject({ success: true, destination: "/orders" });
  });

  it("admin next=/account → /admin (storefront next cannot override admin)", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(staff("admin"));
    const r = await performPasswordUpdate({
      password: STAFF_PW,
      confirm: STAFF_PW,
      next: "/account",
    });
    expect(r).toMatchObject({ success: true, destination: "/admin" });
  });

  it("owner next=/admin/orders → /admin/orders (authorized admin sub-page honored)", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(staff("owner"));
    const r = await performPasswordUpdate({
      password: STAFF_PW,
      confirm: STAFF_PW,
      next: "/admin/orders",
    });
    expect(r).toMatchObject({ success: true, destination: "/admin/orders" });
  });

  it("unsafe next (absolute URL) → default destination", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue(customer());
    const r = await performPasswordUpdate({
      password: "whatever1",
      confirm: "whatever1",
      next: "https://evil.example.com",
    });
    expect(r).toMatchObject({ success: true, destination: "/account" });
  });
});

// ---- Denials / failures -----------------------------------------------------

describe("performPasswordUpdate — denials", () => {
  it("unauthenticated → controlled failure, no updateUser", async () => {
    const client = clientOk();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue({ ok: false, reason: "unauthenticated", actorId: null });
    const r = await performPasswordUpdate({ password: "whatever1", confirm: "whatever1" });
    expect(r).toEqual({ success: false, error: "Please sign in again." });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("inactive staff (recovery) → controlled failure", async () => {
    createClientMock.mockReturnValue(clientOk());
    getIdentityMock.mockResolvedValue({ ok: false, reason: "inactive_staff", actorId: "actor-1" });
    const r = await performPasswordUpdate({ password: STAFF_PW, confirm: STAFF_PW });
    expect(r).toEqual({ success: false, error: "Please sign in again." });
  });

  it("reuses the authenticated client for resolution and updateUser", async () => {
    const client = clientOk();
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(customer());
    await performPasswordUpdate({ password: "whatever1", confirm: "whatever1" });
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(getIdentityMock).toHaveBeenCalledWith({ strict: true, client });
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("supabase updateUser error → failure", async () => {
    const client = { auth: { updateUser: vi.fn(async () => ({ error: { message: "boom" } })) } };
    createClientMock.mockReturnValue(client);
    getIdentityMock.mockResolvedValue(customer());
    const r = await performPasswordUpdate({ password: "whatever1", confirm: "whatever1" });
    expect(r).toMatchObject({ success: false });
    expect(r).not.toHaveProperty("destination");
  });
});
