/**
 * Tests for the centralized identity resolver (identity.server.ts).
 *
 * These exercise the discriminated outcomes of getAuthenticatedIdentity, the
 * requireCustomer/requireStaff guards, and invalidateSession — for BOTH the
 * injected-client path (same request as an auth mutation) and the non-injected
 * path (later cookie-bearing requests: account/admin guards, session summary).
 *
 * The minimal IdentityClient interface lets each mock be a small object literal
 * — no full Supabase client, no `any`, no casts. The per-request client factory
 * is mocked via vi.hoisted so the non-injected path is both controllable and
 * assertable (we can prove ONE client is created and reused).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, safeServerLogMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  safeServerLogMock: vi.fn(),
}));

vi.mock("@/lib/server/supabase.server", () => ({
  createServerSupabaseClient: createClientMock,
}));
vi.mock("@/lib/server/security.server", () => ({
  safeServerLog: safeServerLogMock,
}));

import {
  getAuthenticatedIdentity,
  requireCustomer,
  requireStaff,
  invalidateSession,
  type IdentityClient,
} from "@/lib/server/identity.server";

// ---- Mock client builder ----------------------------------------------------

interface ClientBehavior {
  user?: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null;
  userError?: unknown;
  claims?: { sub?: string; email?: unknown; user_metadata?: unknown } | null;
  claimsError?: unknown;
  staffRow?: { id: number; role: unknown; is_active: unknown; display_name: unknown } | null;
  staffError?: unknown;
  signOut?: () => Promise<{ error: unknown }>;
}

function makeClient(b: ClientBehavior = {}) {
  const getUser = vi.fn(async () => ({
    data: { user: b.user ?? null },
    error: b.userError ?? null,
  }));
  const getClaims = vi.fn(async () => ({
    data: b.claims ? { claims: b.claims } : null,
    error: b.claimsError ?? null,
  }));
  const signOut = vi.fn(b.signOut ?? (async () => ({ error: null })));
  const maybeSingle = vi.fn(async () => ({
    data: b.staffRow ?? null,
    error: b.staffError ?? null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client: IdentityClient = { auth: { getUser, getClaims, signOut }, from };
  return { client, getUser, getClaims, signOut, from, select, eq, maybeSingle };
}

const activeStaff = { id: 7, role: "admin", is_active: true, display_name: "Boss" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Injected client: strict (getUser) path ---------------------------------

describe("getAuthenticatedIdentity — injected client (strict)", () => {
  it("active staff row → staff identity with role and profile id", async () => {
    const { client } = makeClient({ user: { id: "u1", email: "a@b.com" }, staffRow: activeStaff });
    const result = await getAuthenticatedIdentity({ strict: true, client });
    expect(result).toEqual({
      ok: true,
      identity: {
        kind: "staff",
        userId: "u1",
        email: "a@b.com",
        name: "Boss",
        role: "admin",
        staffProfileId: 7,
        isActive: true,
      },
    });
    // Never creates a fresh cookie-derived client when one is injected.
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("authenticated with NO staff row → customer", async () => {
    const { client } = makeClient({
      user: { id: "u2", email: "c@d.com", user_metadata: { full_name: "Cathy" } },
      staffRow: null,
    });
    const result = await getAuthenticatedIdentity({ strict: true, client });
    expect(result).toEqual({
      ok: true,
      identity: { kind: "customer", userId: "u2", email: "c@d.com", name: "Cathy" },
    });
  });

  it("inactive staff row → inactive_staff (never customer)", async () => {
    const { client } = makeClient({
      user: { id: "u3" },
      staffRow: { id: 1, role: "admin", is_active: false, display_name: null },
    });
    expect(await getAuthenticatedIdentity({ strict: true, client })).toEqual({
      ok: false,
      reason: "inactive_staff",
    });
  });

  it("explicit staff lookup error (RLS denial / DB error) → lookup_failed (never customer)", async () => {
    const { client } = makeClient({
      user: { id: "u4" },
      staffRow: null,
      staffError: { code: "42501", message: "permission denied for table staff_profiles" },
    });
    expect(await getAuthenticatedIdentity({ strict: true, client })).toEqual({
      ok: false,
      reason: "lookup_failed",
    });
  });

  it("unrecognized role value → lookup_failed", async () => {
    const { client } = makeClient({
      user: { id: "u5" },
      staffRow: { id: 2, role: "wizard", is_active: true, display_name: "X" },
    });
    expect(await getAuthenticatedIdentity({ strict: true, client })).toEqual({
      ok: false,
      reason: "lookup_failed",
    });
  });

  it("no verified user (getUser error/null) → unauthenticated", async () => {
    const { client, from } = makeClient({ user: null, userError: { message: "no session" } });
    expect(await getAuthenticatedIdentity({ strict: true, client })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    // Short-circuits before the staff lookup.
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to email local-part when no metadata name", async () => {
    const { client } = makeClient({ user: { id: "u6", email: "jane@x.com" }, staffRow: null });
    const result = await getAuthenticatedIdentity({ strict: true, client });
    expect(result.ok && result.identity.name).toBe("jane");
  });
});

// ---- Injected client: non-strict (getClaims) path ---------------------------

describe("getAuthenticatedIdentity — injected client (non-strict)", () => {
  it("claims with sub + active staff row → staff", async () => {
    const { client, getUser, getClaims } = makeClient({
      claims: { sub: "u1", email: "a@b.com", user_metadata: { full_name: "Boss" } },
      staffRow: activeStaff,
    });
    const result = await getAuthenticatedIdentity({ client });
    expect(result.ok && result.identity.kind).toBe("staff");
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("claims error → unauthenticated", async () => {
    const { client } = makeClient({ claims: null, claimsError: { message: "bad jwt" } });
    expect(await getAuthenticatedIdentity({ client })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("no claims sub → unauthenticated", async () => {
    const { client } = makeClient({ claims: null });
    expect(await getAuthenticatedIdentity({ client })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });
});

// ---- Non-injected path (later cookie-bearing requests) ----------------------
// Guards (account/admin) and the session summary all delegate to these
// primitives via a per-request client. The implementation change here is that
// ONE internal client is created and reused for both the session check and the
// staff lookup — assert that explicitly.

describe("getAuthenticatedIdentity — non-injected (per-request client)", () => {
  it("strict: creates exactly one client and reuses it for auth + staff lookup", async () => {
    const m = makeClient({ user: { id: "u1", email: "a@b.com" }, staffRow: activeStaff });
    createClientMock.mockReturnValue(m.client);

    const result = await getAuthenticatedIdentity({ strict: true });

    expect(result.ok && result.identity.kind).toBe("staff");
    expect(createClientMock).toHaveBeenCalledTimes(1); // single client
    expect(m.getUser).toHaveBeenCalledTimes(1);
    expect(m.from).toHaveBeenCalledTimes(1); // same client used for the lookup
  });

  it("non-strict: customer resolves via getClaims with one client", async () => {
    const m = makeClient({ claims: { sub: "u9", email: "c@d.com" }, staffRow: null });
    createClientMock.mockReturnValue(m.client);

    const result = await getAuthenticatedIdentity();
    expect(result).toEqual({
      ok: true,
      identity: { kind: "customer", userId: "u9", email: "c@d.com", name: "c" },
    });
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it("strict: explicit lookup error still fails closed on the per-request path", async () => {
    const m = makeClient({ user: { id: "u1" }, staffError: { code: "500" } });
    createClientMock.mockReturnValue(m.client);
    expect(await getAuthenticatedIdentity({ strict: true })).toEqual({
      ok: false,
      reason: "lookup_failed",
    });
  });
});

// ---- requireCustomer / requireStaff mapping ---------------------------------

describe("requireCustomer / requireStaff", () => {
  it("customer: requireCustomer allows, requireStaff → is_customer", async () => {
    const customer = () =>
      makeClient({ user: { id: "u1", email: "c@d.com" }, staffRow: null }).client;
    expect((await requireCustomer({ strict: true, client: customer() })).ok).toBe(true);
    expect(await requireStaff({ strict: true, client: customer() })).toEqual({
      ok: false,
      reason: "is_customer",
    });
  });

  it("staff: requireStaff allows, requireCustomer → is_staff", async () => {
    const staff = () => makeClient({ user: { id: "u1" }, staffRow: activeStaff }).client;
    expect((await requireStaff({ strict: true, client: staff() })).ok).toBe(true);
    expect(await requireCustomer({ strict: true, client: staff() })).toEqual({
      ok: false,
      reason: "is_staff",
    });
  });

  it("denials pass through unchanged (inactive_staff)", async () => {
    const { client } = makeClient({
      user: { id: "u1" },
      staffRow: { id: 1, role: "admin", is_active: false, display_name: null },
    });
    expect(await requireStaff({ strict: true, client })).toEqual({
      ok: false,
      reason: "inactive_staff",
    });
  });
});

// ---- invalidateSession ------------------------------------------------------

describe("invalidateSession", () => {
  it("uses the supplied client, signs out with local scope, creates no fresh client", async () => {
    const { client, signOut } = makeClient();
    await invalidateSession(client);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("swallows a thrown sign-out error (never turns a denial into an allow) and logs", async () => {
    const { client, signOut } = makeClient({
      signOut: async () => {
        throw new Error("network down");
      },
    });
    await expect(invalidateSession(client)).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(safeServerLogMock).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("sign-out"),
      expect.anything(),
    );
  });

  it("tolerates a resolved sign-out error without throwing", async () => {
    const { client } = makeClient({
      signOut: async () => ({ error: { message: "already gone" } }),
    });
    await expect(invalidateSession(client)).resolves.toBeUndefined();
  });

  it("falls back to a per-request client when none supplied", async () => {
    const m = makeClient();
    createClientMock.mockReturnValue(m.client);
    await invalidateSession();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
