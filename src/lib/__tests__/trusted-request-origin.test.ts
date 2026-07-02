/**
 * getTrustedRequestOrigin — picks the request's own origin for same-origin
 * redirect building (OAuth PKCE callback), but ONLY when it is in the same
 * allowlist checkCsrfOrigin enforces. Arbitrary origins must never win.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const headers = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => headers.get(name),
}));

import { getTrustedRequestOrigin } from "@/lib/server/security.server";

const SITE = "https://nongor-brand.vercel.app";
const ALIAS = "https://nongor-brand-nongorr.vercel.app";

beforeEach(() => {
  headers.clear();
  process.env.ADDITIONAL_ALLOWED_ORIGINS = ALIAS;
});

afterEach(() => {
  delete process.env.ADDITIONAL_ALLOWED_ORIGINS;
});

describe("getTrustedRequestOrigin", () => {
  it("returns the canonical origin when the request comes from it", () => {
    headers.set("origin", SITE);
    expect(getTrustedRequestOrigin(SITE)).toBe(SITE);
  });

  it("returns a trusted alias origin so OAuth completes on the same domain", () => {
    headers.set("origin", ALIAS);
    expect(getTrustedRequestOrigin(SITE)).toBe(ALIAS);
  });

  it("falls back to Referer when Origin is absent", () => {
    headers.set("referer", `${ALIAS}/login`);
    expect(getTrustedRequestOrigin(SITE)).toBe(ALIAS);
  });

  it("never returns an untrusted origin (caller falls back to the site URL)", () => {
    headers.set("origin", "https://evil.example.com");
    expect(getTrustedRequestOrigin(SITE)).toBeNull();
  });

  it("ignores an untrusted alias when ADDITIONAL_ALLOWED_ORIGINS is unset", () => {
    delete process.env.ADDITIONAL_ALLOWED_ORIGINS;
    headers.set("origin", ALIAS);
    expect(getTrustedRequestOrigin(SITE)).toBeNull();
  });

  it("returns null when no Origin or Referer is present", () => {
    expect(getTrustedRequestOrigin(SITE)).toBeNull();
  });
});
