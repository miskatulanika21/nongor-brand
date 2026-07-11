import { describe, it, expect } from "vitest";
import {
  CMS_PAGE_SLUGS,
  isCmsPageSlug,
  pageDraftSchema,
  pageErrorMessage,
  toPublicSitePage,
} from "@/lib/pages-shared";

describe("pageDraftSchema", () => {
  const base = { slug: "delivery-policy", title: "Delivery Policy", body_md: "## Body" };

  it("accepts a valid draft and normalizes empty optionals to null", () => {
    const parsed = pageDraftSchema.parse({ ...base, eyebrow: "  ", description: "" });
    expect(parsed.eyebrow).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it("only accepts the fixed CMS slugs", () => {
    for (const slug of CMS_PAGE_SLUGS) {
      expect(pageDraftSchema.safeParse({ ...base, slug }).success).toBe(true);
    }
    expect(pageDraftSchema.safeParse({ ...base, slug: "return-policy" }).success).toBe(false);
    expect(isCmsPageSlug("payment-policy")).toBe(true);
    expect(isCmsPageSlug("terms")).toBe(false);
  });

  it("requires a title and a body, and bounds their lengths", () => {
    expect(pageDraftSchema.safeParse({ ...base, title: " " }).success).toBe(false);
    expect(pageDraftSchema.safeParse({ ...base, body_md: "" }).success).toBe(false);
    expect(pageDraftSchema.safeParse({ ...base, title: "x".repeat(161) }).success).toBe(false);
    expect(pageDraftSchema.safeParse({ ...base, eyebrow: "x".repeat(81) }).success).toBe(false);
  });
});

describe("pageErrorMessage", () => {
  it("maps known codes and degrades unknown ones", () => {
    expect(pageErrorMessage("no_draft_to_publish")).toMatch(/no draft/i);
    expect(pageErrorMessage("page_not_found")).toMatch(/not CMS-editable/i);
    expect(pageErrorMessage("mystery_code")).toBe(pageErrorMessage("internal_error"));
    expect(pageErrorMessage(null)).toBe(pageErrorMessage("internal_error"));
  });
});

describe("toPublicSitePage", () => {
  it("maps a payload and requires slug/title/body", () => {
    const page = toPublicSitePage({
      slug: "delivery-policy",
      eyebrow: "Shipping",
      title: "Delivery Policy",
      description: null,
      body_md: "## Charges",
    });
    expect(page).not.toBeNull();
    expect(page!.bodyMd).toBe("## Charges");
    expect(page!.description).toBeNull();

    expect(toPublicSitePage(null)).toBeNull();
    expect(toPublicSitePage({ slug: "x", title: "y", body_md: null })).toBeNull();
  });
});
