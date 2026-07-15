/**
 * Unit tests for the fail-closed staging guard (order-workflow #3). The guard's
 * pure decision function must REFUSE on every missing/ambiguous/placeholder/
 * malformed/production input and pass only when a real staging project is proven.
 */
import { describe, it, expect } from "vitest";
// The guard is a plain ESM script; importing it has no side effects (the CLI
// only runs when executed directly).
import {
  evaluateStagingGuard,
  isValidStagingRef,
  projectRefFromUrl,
  PROD_REF,
} from "../../../scripts/staging-guard.mjs";

const STAGING = "abcdefghij0123456789"; // 20 lowercase alphanumerics, not prod
const good = {
  linkedRef: STAGING,
  declaredRef: STAGING,
  supabaseUrl: `https://${STAGING}.supabase.co`,
};

describe("evaluateStagingGuard — passes only for a proven staging project", () => {
  it("passes when linked == declared == url ref, all valid and non-prod", () => {
    expect(evaluateStagingGuard(good)).toEqual({ ok: true, ref: STAGING });
  });
});

describe("evaluateStagingGuard — fails closed", () => {
  const cases: Array<[string, Parameters<typeof evaluateStagingGuard>[0]]> = [
    ["missing .env.staging (declaredRef null)", { ...good, declaredRef: null }],
    ["placeholder declared ref", { ...good, declaredRef: "your-staging-ref" }],
    ["malformed declared ref", { ...good, declaredRef: "too-short" }],
    [
      "declared ref is production",
      {
        ...good,
        declaredRef: PROD_REF,
        linkedRef: PROD_REF,
        supabaseUrl: `https://${PROD_REF}.supabase.co`,
      },
    ],
    ["no linked project", { ...good, linkedRef: null }],
    ["empty linked project", { ...good, linkedRef: "   " }],
    ["malformed linked ref", { ...good, linkedRef: "nope" }],
    ["linked project is production", { ...good, linkedRef: PROD_REF }],
    ["linked != declared", { ...good, linkedRef: "zzzzzzzzzz9999999999" }],
    ["missing VITE_SUPABASE_URL", { ...good, supabaseUrl: null }],
    ["VITE_SUPABASE_URL not a supabase url", { ...good, supabaseUrl: "https://evil.example.com" }],
    [
      "VITE_SUPABASE_URL points at production",
      { ...good, supabaseUrl: `https://${PROD_REF}.supabase.co` },
    ],
    [
      "VITE_SUPABASE_URL ref != declared",
      { ...good, supabaseUrl: "https://zzzzzzzzzz9999999999.supabase.co" },
    ],
  ];
  for (const [name, input] of cases) {
    it(`rejects: ${name}`, () => {
      const r = evaluateStagingGuard(input);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe("string");
      expect((r.error ?? "").length).toBeGreaterThan(0);
    });
  }
});

describe("isValidStagingRef", () => {
  it("accepts a 20-char lowercase alphanumeric non-prod ref", () => {
    expect(isValidStagingRef(STAGING)).toBe(true);
  });
  it("rejects prod, placeholder, empty, and malformed refs", () => {
    expect(isValidStagingRef(PROD_REF)).toBe(false);
    expect(isValidStagingRef("your-staging-ref")).toBe(false);
    expect(isValidStagingRef("")).toBe(false);
    expect(isValidStagingRef("ABCDEFGHIJ0123456789")).toBe(false); // uppercase
    expect(isValidStagingRef("short")).toBe(false);
    expect(isValidStagingRef(undefined)).toBe(false);
  });
});

describe("projectRefFromUrl", () => {
  it("extracts the ref from a Supabase URL", () => {
    expect(projectRefFromUrl(`https://${STAGING}.supabase.co`)).toBe(STAGING);
    expect(projectRefFromUrl(`https://${STAGING}.supabase.in/`)).toBe(STAGING);
  });
  it("returns null for non-Supabase or malformed URLs", () => {
    expect(projectRefFromUrl("https://evil.example.com")).toBeNull();
    expect(projectRefFromUrl("not a url")).toBeNull();
    expect(projectRefFromUrl(null)).toBeNull();
  });
});
