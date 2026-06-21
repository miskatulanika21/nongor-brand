import { describe, it, expect } from "vitest";
import { isSafeRedirect, pathOnly } from "@/lib/safe-redirect";

describe("isSafeRedirect", () => {
  it("accepts internal paths", () => {
    expect(isSafeRedirect("/account")).toBe(true);
    expect(isSafeRedirect("/admin/orders")).toBe(true);
    expect(isSafeRedirect("/")).toBe(true);
    expect(isSafeRedirect("/checkout?step=2")).toBe(true);
  });

  it("rejects external and protocol-relative URLs", () => {
    expect(isSafeRedirect("https://evil.example")).toBe(false);
    expect(isSafeRedirect("http://evil.example")).toBe(false);
    expect(isSafeRedirect("//evil.example")).toBe(false);
  });

  it("rejects backslash bypasses", () => {
    expect(isSafeRedirect("\\\\evil.example")).toBe(false);
    expect(isSafeRedirect("/\\evil.example")).toBe(false);
    expect(isSafeRedirect("/path\\to")).toBe(false);
  });

  it("rejects encoded and double-encoded protocol-relative bypasses", () => {
    expect(isSafeRedirect("%2F%2Fevil.example")).toBe(false);
    expect(isSafeRedirect("%5C%5Cevil.example")).toBe(false);
    expect(isSafeRedirect("%252F%252Fevil.example")).toBe(false);
  });

  it("rejects dangerous schemes", () => {
    expect(isSafeRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirect("data:text/html,x")).toBe(false);
    expect(isSafeRedirect("vbscript:msgbox")).toBe(false);
    expect(isSafeRedirect("file:///etc/passwd")).toBe(false);
  });

  it("rejects newline / control-character injection", () => {
    expect(isSafeRedirect("/account\nSet-Cookie: x=1")).toBe(false);
    expect(isSafeRedirect("/account\r\nLocation: https://evil")).toBe(false);
    expect(isSafeRedirect("/account\x00")).toBe(false);
  });

  it("rejects login loops", () => {
    expect(isSafeRedirect("/login")).toBe(false);
    expect(isSafeRedirect("/admin/login")).toBe(false);
    expect(isSafeRedirect("/login?next=/account")).toBe(false);
  });

  it("rejects null/empty/oversized", () => {
    expect(isSafeRedirect(null)).toBe(false);
    expect(isSafeRedirect(undefined)).toBe(false);
    expect(isSafeRedirect("")).toBe(false);
    expect(isSafeRedirect("/" + "a".repeat(3000))).toBe(false);
  });
});

describe("pathOnly", () => {
  it("strips query and trailing slash", () => {
    expect(pathOnly("/admin/orders?x=1")).toBe("/admin/orders");
    expect(pathOnly("/account/")).toBe("/account");
    expect(pathOnly("/")).toBe("/");
  });
});
