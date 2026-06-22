/**
 * Tests for checkIndependentRateLimit (Item B — independent per-IP and
 * per-account rate limits).
 *
 * Proves rotating one dimension cannot bypass the other's bucket, and that the
 * account identifier is normalized. The "login" policy allows 8 attempts per
 * window; each test uses unique IP/account namespaces so the shared in-memory
 * store's buckets never collide across tests.
 */
import { describe, it, expect } from "vitest";
import { checkIndependentRateLimit } from "@/lib/server/rate-limit.server";

const LOGIN_LIMIT = 8;

describe("checkIndependentRateLimit", () => {
  it("per-account bucket blocks even when the IP rotates", async () => {
    const account = "rot-ip@example.com";
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      const r = await checkIndependentRateLimit("login", { ip: `10.1.0.${i}`, account });
      expect(r.allowed).toBe(true);
    }
    // 9th attempt: brand-new IP (fresh per-IP bucket) but same account → the
    // per-account bucket is now over its limit and must block.
    const blocked = await checkIndependentRateLimit("login", { ip: "10.1.0.250", account });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("per-IP bucket blocks even when the account rotates", async () => {
    const ip = "10.2.0.7";
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      const r = await checkIndependentRateLimit("login", { ip, account: `acct-${i}@example.com` });
      expect(r.allowed).toBe(true);
    }
    // 9th attempt: brand-new account (fresh per-account bucket) but same IP →
    // the per-IP bucket is now over its limit and must block.
    const blocked = await checkIndependentRateLimit("login", { ip, account: "fresh@example.com" });
    expect(blocked.allowed).toBe(false);
  });

  it("normalizes the account so case/whitespace variants share one bucket", async () => {
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      const r = await checkIndependentRateLimit("login", {
        ip: `10.3.0.${i}`,
        account: "Norm@Example.com ",
      });
      expect(r.allowed).toBe(true);
    }
    // Different casing + leading whitespace, new IP → must hit the SAME
    // normalized account bucket and be blocked.
    const blocked = await checkIndependentRateLimit("login", {
      ip: "10.3.0.250",
      account: "  norm@example.com",
    });
    expect(blocked.allowed).toBe(false);
  });

  it("allows when both buckets are under their limits", async () => {
    const r = await checkIndependentRateLimit("login", {
      ip: "10.4.0.1",
      account: "fresh-pair@example.com",
    });
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSec).toBe(0);
  });

  it("still enforces a single anonymous bucket when no identifiers are given", async () => {
    // Uses the "register" policy (limit 5) to avoid colliding with login buckets.
    for (let i = 0; i < 5; i++) {
      const r = await checkIndependentRateLimit("register", {});
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkIndependentRateLimit("register", {});
    expect(blocked.allowed).toBe(false);
  });
});
