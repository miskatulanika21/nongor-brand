import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headers = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => headers.get(name),
}));

import { getClientIp } from "@/lib/server/security.server";

beforeEach(() => {
  headers.clear();
  vi.stubEnv("VERCEL", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("Vercel rate-limit identity", () => {
  it("ignores a forged Cloudflare header when the platform identifies the caller", () => {
    headers.set("x-vercel-forwarded-for", "198.51.100.10");
    headers.set("x-forwarded-for", "203.0.113.20");
    for (const spoofed of ["192.0.2.1", "192.0.2.2", "arbitrary-bucket"]) {
      headers.set("cf-connecting-ip", spoofed);
      expect(getClientIp()).toBe("198.51.100.10");
    }
  });

  it("supports Vercel's standard forwarded header", () => {
    headers.set("x-forwarded-for", " 198.51.100.10 ");
    headers.set("cf-connecting-ip", "192.0.2.1");
    expect(getClientIp()).toBe("198.51.100.10");
  });

  it("does not mint spoofable buckets when platform headers are missing", () => {
    headers.set("cf-connecting-ip", "192.0.2.1");
    headers.set("x-real-ip", "192.0.2.2");
    expect(getClientIp()).toBeNull();
  });

  it("preserves the existing Cloudflare proxy behavior outside Vercel", () => {
    vi.stubEnv("VERCEL", "");
    headers.set("cf-connecting-ip", "198.51.100.10");
    expect(getClientIp()).toBe("198.51.100.10");
  });
});
