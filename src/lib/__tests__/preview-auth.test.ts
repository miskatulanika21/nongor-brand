import { describe, expect, it } from "vitest";
import { previewOrigin } from "../../../e2e/helpers/preview-auth";

describe("preview credential destination", () => {
  it.each([
    "https://nongor-brand.vercel.app",
    "https://nongor-brand-abc123-nongorr.vercel.app/shop",
    "https://nongor-brand-git-audit-remaining-verification-nongorr.vercel.app",
  ])("accepts this project's deployment: %s", (url) => {
    expect(previewOrigin(url)).toBe(new URL(url).origin);
  });
  it.each([
    undefined,
    "https://nongorr.com",
    "http://nongor-brand.vercel.app",
    "https://nongor-brand.vercel.app.attacker.example",
    "https://another-project.vercel.app",
    "https://nongor-brand-abc-another-team.vercel.app",
    "https://nongor-brand.vercel.app@attacker.example",
    "https://user:password@nongor-brand.vercel.app",
    "https://nongor-brand.vercel.app:444",
    "http://localhost:8091",
  ])("does not send credentials to %s", (url) => {
    expect(previewOrigin(url)).toBeNull();
  });
});
