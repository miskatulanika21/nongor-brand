import { describe, it, expect } from "vitest";
import {
  bannerInputSchema,
  bannerErrorMessage,
  focalPosition,
  toPublicBanner,
  toPublicBanners,
} from "@/lib/banners-shared";

const IMG = "https://test.local/storage/v1/object/public/product-media/x.webp";

const base = {
  title: "Eid Edit",
  image_url: IMG,
};

describe("bannerInputSchema", () => {
  it("accepts a minimal banner and applies defaults", () => {
    const parsed = bannerInputSchema.parse(base);
    expect(parsed.sort_order).toBe(0);
    expect(parsed.is_active).toBe(false);
    expect(parsed.eyebrow ?? null).toBeNull();
  });

  it("normalizes empty optional strings to null", () => {
    const parsed = bannerInputSchema.parse({
      ...base,
      eyebrow: "  ",
      subtitle: "",
      image_alt: "",
      starts_at: "",
    });
    expect(parsed.eyebrow).toBeNull();
    expect(parsed.subtitle).toBeNull();
    expect(parsed.image_alt).toBeNull();
    expect(parsed.starts_at).toBeNull();
  });

  it("requires a headline and an image", () => {
    expect(bannerInputSchema.safeParse({ ...base, title: " " }).success).toBe(false);
    expect(bannerInputSchema.safeParse({ title: "x", image_url: "" }).success).toBe(false);
  });

  it("rejects a CTA label without a destination (and vice versa)", () => {
    expect(bannerInputSchema.safeParse({ ...base, cta_label: "Shop" }).success).toBe(false);
    expect(bannerInputSchema.safeParse({ ...base, cta_to: "/shop" }).success).toBe(false);
    expect(
      bannerInputSchema.safeParse({ ...base, cta_label: "Shop", cta_to: "/shop" }).success,
    ).toBe(true);
  });

  it("rejects external CTA destinations (internal paths only)", () => {
    const bad = bannerInputSchema.safeParse({
      ...base,
      cta_label: "Shop",
      cta_to: "https://evil.example",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a schedule window that ends before it starts", () => {
    const bad = bannerInputSchema.safeParse({
      ...base,
      starts_at: "2026-08-02",
      ends_at: "2026-08-01",
    });
    expect(bad.success).toBe(false);
    const ok = bannerInputSchema.safeParse({
      ...base,
      starts_at: "2026-08-01",
      ends_at: "2026-08-02",
    });
    expect(ok.success).toBe(true);
  });

  it("bounds sort_order to 0–1000", () => {
    expect(bannerInputSchema.safeParse({ ...base, sort_order: -1 }).success).toBe(false);
    expect(bannerInputSchema.safeParse({ ...base, sort_order: 1001 }).success).toBe(false);
    expect(bannerInputSchema.safeParse({ ...base, sort_order: "42" }).success).toBe(true);
  });
});

describe("bannerErrorMessage", () => {
  it("maps known codes and degrades unknown ones to the generic message", () => {
    expect(bannerErrorMessage("image_not_in_library")).toMatch(/media library/i);
    expect(bannerErrorMessage("banner_not_found")).toMatch(/no longer exists/i);
    expect(bannerErrorMessage("something_new")).toBe(bannerErrorMessage("internal_error"));
    expect(bannerErrorMessage(undefined)).toBe(bannerErrorMessage("internal_error"));
  });
});

describe("toPublicBanner(s)", () => {
  const raw = {
    id: "3e0a4be5-9d3e-4a53-b7a5-3a0a0a0a0a0a",
    eyebrow: "New",
    title: "Eid Edit",
    subtitle: "Festive",
    cta_label: "Shop",
    cta_to: "/shop?filter=new-arrivals",
    image_url: IMG,
    image_alt: "alt",
    card_title: "Kurti",
    card_subtitle: "Handmade",
  };

  it("maps snake_case payloads to camelCase", () => {
    const b = toPublicBanner(raw);
    expect(b).not.toBeNull();
    expect(b!.ctaTo).toBe("/shop?filter=new-arrivals");
    expect(b!.imageUrl).toBe(IMG);
    expect(b!.cardSubtitle).toBe("Handmade");
  });

  it("drops rows missing id/title/image and non-objects", () => {
    expect(toPublicBanner({ ...raw, image_url: null })).toBeNull();
    expect(toPublicBanner("nope")).toBeNull();
    const list = toPublicBanners([raw, { junk: true }, null]);
    expect(list).toHaveLength(1);
  });

  it("returns [] for a non-array payload", () => {
    expect(toPublicBanners({ rows: [] })).toEqual([]);
  });

  it("maps and clamps the focal point, defaulting to centre", () => {
    // Present + valid.
    const b = toPublicBanner({ ...raw, focal_x: 0.2, focal_y: 0.8 });
    expect(b!.focalX).toBe(0.2);
    expect(b!.focalY).toBe(0.8);
    // Numeric strings (jsonb numerics can arrive as strings) + out-of-range clamp.
    const c = toPublicBanner({ ...raw, focal_x: "1.5", focal_y: "-3" });
    expect(c!.focalX).toBe(1);
    expect(c!.focalY).toBe(0);
    // Absent → centre.
    const d = toPublicBanner(raw);
    expect(d!.focalX).toBe(0.5);
    expect(d!.focalY).toBe(0.5);
  });
});

describe("focal point (input + css)", () => {
  it("clamps focal_x/focal_y into 0..1 and defaults to 0.5", () => {
    expect(bannerInputSchema.parse(base).focal_x).toBe(0.5);
    expect(bannerInputSchema.parse({ ...base, focal_x: 2, focal_y: -1 })).toMatchObject({
      focal_x: 1,
      focal_y: 0,
    });
    // A garbage value never blocks the save — it falls back to centre.
    expect(bannerInputSchema.parse({ ...base, focal_x: "abc" }).focal_x).toBe(0.5);
  });

  it("renders a CSS object-position string, clamped", () => {
    expect(focalPosition(0, 0)).toBe("0.00% 0.00%");
    expect(focalPosition(0.5, 0.25)).toBe("50.00% 25.00%");
    expect(focalPosition(2, -1)).toBe("100.00% 0.00%");
  });
});
