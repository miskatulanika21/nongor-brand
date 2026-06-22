/**
 * Tests for withSecurityHeaders (Item A — security-header Response rebuild).
 *
 * Proves the rebuilt Response carries the expected headers AND preserves
 * status, statusText, redirects/Location, multiple Set-Cookie entries, and a
 * streaming body — the properties that an in-place header mutation could drop
 * or that a naive rebuild could lose.
 */
import { describe, it, expect } from "vitest";
import { withSecurityHeaders } from "@/lib/server/headers.server";

const html = () => new Response("<html></html>", { headers: { "content-type": "text/html" } });

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
});
