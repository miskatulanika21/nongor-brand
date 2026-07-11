import { describe, it, expect } from "vitest";
import {
  newsletterSubscribeSchema,
  newsletterErrorMessage,
  NEWSLETTER_ERROR_MESSAGES,
} from "@/lib/newsletter-shared";

describe("newsletterSubscribeSchema", () => {
  it("accepts a plain email (whatsapp optional/empty)", () => {
    expect(newsletterSubscribeSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(newsletterSubscribeSchema.safeParse({ email: "a@b.com", whatsapp: "" }).success).toBe(
      true,
    );
  });

  it("accepts a valid BD whatsapp (spaces/dashes tolerated)", () => {
    expect(
      newsletterSubscribeSchema.safeParse({ email: "a@b.com", whatsapp: "01712345678" }).success,
    ).toBe(true);
    expect(
      newsletterSubscribeSchema.safeParse({ email: "a@b.com", whatsapp: "017-1234 5678" }).success,
    ).toBe(true);
  });

  it("rejects a bad email or bad whatsapp", () => {
    expect(newsletterSubscribeSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(
      newsletterSubscribeSchema.safeParse({ email: "a@b.com", whatsapp: "12345" }).success,
    ).toBe(false);
    expect(
      newsletterSubscribeSchema.safeParse({ email: "a@b.com", whatsapp: "01012345678" }).success,
    ).toBe(false);
  });
});

describe("newsletterErrorMessage", () => {
  it("maps the stable code and falls back generically", () => {
    expect(newsletterErrorMessage("invalid_subscription")).toContain("doesn't look right");
    expect(newsletterErrorMessage("whatever")).toContain("Could not save");
    expect(newsletterErrorMessage(null)).toContain("Could not save");
  });

  it("never leaks raw SQL", () => {
    for (const code of Object.keys(NEWSLETTER_ERROR_MESSAGES)) {
      const msg = newsletterErrorMessage(code);
      expect(msg).not.toContain("SQLERRM");
      expect(msg).not.toContain("RAISE");
    }
  });
});
