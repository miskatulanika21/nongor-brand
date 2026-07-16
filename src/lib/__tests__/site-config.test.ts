import { describe, it, expect } from "vitest";
import { absUrl, SITE_URL } from "@/lib/site-config";

describe("absUrl", () => {
  it("builds an absolute URL from a root-relative path", () => {
    expect(absUrl("/about")).toBe(`${SITE_URL}/about`);
  });

  it("tolerates a missing leading slash", () => {
    expect(absUrl("about")).toBe(`${SITE_URL}/about`);
  });

  it("never produces a double slash", () => {
    expect(absUrl("/")).toBe(`${SITE_URL}/`);
    expect(absUrl("/shop")).not.toContain("//shop");
  });

  it("passes absolute http(s) URLs through untouched", () => {
    // Product images may come from Supabase Storage rather than the bundle.
    const remote = "https://xyz.supabase.co/storage/v1/object/public/product-media/a.webp";
    expect(absUrl(remote)).toBe(remote);
    expect(absUrl("http://example.com/x.png")).toBe("http://example.com/x.png");
  });

  it("preserves the schema.org SearchAction placeholder verbatim", () => {
    // Google requires the literal {search_term_string}; percent-encoding it
    // would silently break the sitelinks searchbox.
    expect(absUrl("/shop?q={search_term_string}")).toBe(`${SITE_URL}/shop?q={search_term_string}`);
  });

  it("exposes SITE_URL without a trailing slash", () => {
    expect(SITE_URL).not.toMatch(/\/$/);
  });
});
