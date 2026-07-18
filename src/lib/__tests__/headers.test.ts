/**
 * Tests for withSecurityHeaders (Item A — security-header Response rebuild).
 *
 * Proves the rebuilt Response carries the expected headers AND preserves
 * status, statusText, redirects/Location, multiple Set-Cookie entries, and a
 * streaming body — the properties that an in-place header mutation could drop
 * or that a naive rebuild could lose.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  withSecurityHeaders,
  isPublicCacheableRequest,
  withPublicCache,
} from "@/lib/server/headers.server";

const html = () => new Response("<html></html>", { headers: { "content-type": "text/html" } });
const req = (url: string, init?: RequestInit) => new Request(`https://nongorr.com${url}`, init);
const AUTH_COOKIE = "sb-xomjxtmhkglhuiccekld-auth-token=abc; other=1";

// CSP_ENFORCE_STRICT is stubbed by individual tests; never leak it across them.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withSecurityHeaders", () => {
  it("adds the baseline security headers to an HTML response", () => {
    const out = withSecurityHeaders(html(), false);
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
    expect(out.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(out.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(out.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("adds CSP only to HTML, not to other content types", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const out = withSecurityHeaders(json, false);
    expect(out.headers.get("Content-Security-Policy")).toBeNull();
    // The lighter headers still apply to non-HTML responses.
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("adds HSTS only in production", () => {
    expect(withSecurityHeaders(html(), false).headers.get("Strict-Transport-Security")).toBeNull();
    expect(withSecurityHeaders(html(), true).headers.get("Strict-Transport-Security")).toContain(
      "max-age=",
    );
  });

  it("preserves status and statusText", () => {
    const res = new Response("teapot", { status: 418, statusText: "I'm a teapot" });
    const out = withSecurityHeaders(res, false);
    expect(out.status).toBe(418);
    expect(out.statusText).toBe("I'm a teapot");
  });

  it("preserves a redirect's status and Location header", () => {
    const res = new Response(null, { status: 302, headers: { location: "/login" } });
    const out = withSecurityHeaders(res, false);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("/login");
  });

  it("preserves multiple Set-Cookie headers", () => {
    const res = html();
    res.headers.append("set-cookie", "a=1; Path=/");
    res.headers.append("set-cookie", "b=2; Path=/");
    const out = withSecurityHeaders(res, false);
    const cookies = out.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies).toContain("a=1; Path=/");
    expect(cookies).toContain("b=2; Path=/");
  });

  it("preserves a streaming response body", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk1"));
        controller.enqueue(new TextEncoder().encode("chunk2"));
        controller.close();
      },
    });
    const res = new Response(stream, { headers: { "content-type": "text/html" } });
    const out = withSecurityHeaders(res, false);
    expect(out.headers.get("Content-Security-Policy")).toContain("default-src");
    expect(await out.text()).toBe("chunk1chunk2");
  });

  // ---- Stage 7 P1: nonce + strict Report-Only CSP ----

  it("emits no Report-Only header when no nonce is supplied", () => {
    const out = withSecurityHeaders(html(), false);
    expect(out.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    // Enforced policy is unchanged (still permissive).
    expect(out.headers.get("Content-Security-Policy")).toContain("'unsafe-inline'");
  });

  it("emits a strict Report-Only policy carrying the nonce when supplied", () => {
    const out = withSecurityHeaders(html(), false, "abc123==");
    const enforced = out.headers.get("Content-Security-Policy") ?? "";
    const reportOnly = out.headers.get("Content-Security-Policy-Report-Only") ?? "";
    // Enforced stays permissive so hydration never breaks.
    expect(enforced).toContain("'unsafe-inline'");
    // Report-Only is the strict, nonce-based policy.
    expect(reportOnly).toContain("'nonce-abc123=='");
    expect(reportOnly).toContain("'strict-dynamic'");
    expect(reportOnly).toContain("report-uri /api/csp-report");
    // upgrade-insecure-requests is a no-op (and console-warns) in a report-only
    // policy, so it must NOT appear there — only in the enforced policy.
    expect(reportOnly).not.toContain("upgrade-insecure-requests");
    expect(enforced).toContain("upgrade-insecure-requests");
  });

  it("does not attach CSP to non-HTML even with a nonce", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const out = withSecurityHeaders(json, false, "abc123==");
    expect(out.headers.get("Content-Security-Policy")).toBeNull();
    expect(out.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  // ---- Hashed CSP for edge-cached pages (nonce-free by construction) ----

  it("emits a hashed Report-Only policy when script hashes are supplied", () => {
    const out = withSecurityHeaders(html(), false, undefined, ["'sha256-AAA='", "'sha256-BBB='"]);
    const enforced = out.headers.get("Content-Security-Policy") ?? "";
    const reportOnly = out.headers.get("Content-Security-Policy-Report-Only") ?? "";
    expect(enforced).toContain("'unsafe-inline'");
    expect(reportOnly).toContain("'sha256-AAA='");
    expect(reportOnly).toContain("'sha256-BBB='");
    // 'self' must survive: it is what allows the parser-inserted external bundle
    // once 'unsafe-inline' is gone.
    expect(reportOnly).toContain("script-src 'self'");
    // strict-dynamic would make 'self' ignored and block that bundle.
    expect(reportOnly).not.toContain("'strict-dynamic'");
  });

  it("drops 'unsafe-inline' from script-src when a hashed policy is enforced", () => {
    vi.stubEnv("CSP_ENFORCE_STRICT", "true");
    const out = withSecurityHeaders(html(), false, undefined, ["'sha256-AAA='"]);
    const enforced = out.headers.get("Content-Security-Policy") ?? "";
    const scriptSrc = enforced.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).toContain("'sha256-AAA='");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(out.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("FAILS OPEN to the permissive policy when no hashes could be extracted", () => {
    // A cached page whose hashes we failed to compute must keep working. Emitting
    // a hash policy with no hashes would block every script on a response that is
    // then served from cache to every visitor.
    vi.stubEnv("CSP_ENFORCE_STRICT", "true");
    const out = withSecurityHeaders(html(), false, undefined, []);
    expect(out.headers.get("Content-Security-Policy")).toContain("'unsafe-inline'");
    expect(out.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("prefers the nonce policy over hashes when both are somehow present", () => {
    vi.stubEnv("CSP_ENFORCE_STRICT", "true");
    const out = withSecurityHeaders(html(), false, "abc123==", ["'sha256-AAA='"]);
    const enforced = out.headers.get("Content-Security-Policy") ?? "";
    expect(enforced).toContain("'nonce-abc123=='");
    expect(enforced).not.toContain("'sha256-AAA='");
  });
});

describe("isPublicCacheableRequest", () => {
  it("caches anonymous GETs of public pages", () => {
    expect(isPublicCacheableRequest(req("/"))).toBe(true);
    expect(isPublicCacheableRequest(req("/shop"))).toBe(true);
    expect(isPublicCacheableRequest(req("/shop?category=kurti"))).toBe(true);
    expect(isPublicCacheableRequest(req("/product/maroon-kurti"))).toBe(true);
    expect(isPublicCacheableRequest(req("/about"))).toBe(true);
  });

  it("never caches authenticated requests (auth cookie present)", () => {
    expect(isPublicCacheableRequest(req("/", { headers: { cookie: AUTH_COOKIE } }))).toBe(false);
    expect(isPublicCacheableRequest(req("/shop", { headers: { cookie: AUTH_COOKIE } }))).toBe(
      false,
    );
  });

  it("never caches private routes, even anonymous", () => {
    for (const p of ["/account", "/cart", "/checkout", "/wishlist", "/admin", "/login", "/api/x"]) {
      expect(isPublicCacheableRequest(req(p))).toBe(false);
    }
  });

  it("only caches GET/HEAD", () => {
    expect(isPublicCacheableRequest(req("/", { method: "POST" }))).toBe(false);
    expect(isPublicCacheableRequest(req("/", { method: "HEAD" }))).toBe(true);
  });

  it("ignores non-auth cookies (analytics, consent)", () => {
    expect(
      isPublicCacheableRequest(req("/", { headers: { cookie: "ph_id=1; consent=yes" } })),
    ).toBe(true);
  });
});

describe("withPublicCache", () => {
  it("promotes a plain 200 HTML response to a shared edge cache", () => {
    const out = withPublicCache(withSecurityHeaders(html(), true));
    expect(out.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=86400",
    );
    expect(out.headers.get("Pragma")).toBeNull();
    expect(out.headers.get("Expires")).toBeNull();
  });

  it("refuses to cache a response that sets a cookie", () => {
    const res = new Response("<html></html>", {
      headers: { "content-type": "text/html", "set-cookie": "sb-x-auth-token=1" },
    });
    const out = withPublicCache(res);
    expect(out.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
  });

  it("refuses to cache a non-200 or non-HTML response", () => {
    const redirect = new Response(null, { status: 302, headers: { location: "/login" } });
    expect(withPublicCache(redirect).headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
    const json = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    expect(withPublicCache(json).headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
  });
});
