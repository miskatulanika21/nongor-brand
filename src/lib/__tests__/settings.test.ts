import { describe, it, expect } from "vitest";
import {
  settingsSaveSchema,
  settingsErrorMessage,
  normalizePublicSettings,
  normalizeAdminSettings,
  announcementState,
  isSafeLinkUrl,
  type PublicSettings,
} from "@/lib/settings.schema";

const fullPublic = {
  store_name: "Nongorr",
  tagline: "Anchored",
  announcement_enabled: true,
  announcement_text: "Eid sale",
  announcement_link: "/shop",
  free_delivery_threshold: 3000,
  delivery_fee_dhaka: 80,
  delivery_fee_major: 100,
  delivery_fee_outside: 130,
  contact_email: "hi@nongorr.com",
  contact_phone: null,
  whatsapp: "8801700000000",
  instagram: null,
  facebook: null,
  tiktok: null,
  return_window_days: 7,
  order_hold_hours: 24,
};

describe("settingsSaveSchema", () => {
  it("coerces numeric strings and trims text", () => {
    const parsed = settingsSaveSchema.parse({
      store_name: "  Shop  ",
      delivery_fee_dhaka: "90",
      announcement_enabled: true,
    });
    expect(parsed.store_name).toBe("Shop");
    expect(parsed.delivery_fee_dhaka).toBe(90);
    expect(parsed.announcement_enabled).toBe(true);
  });

  it("treats an empty optional string as null (clears the field)", () => {
    const parsed = settingsSaveSchema.parse({ tagline: "   ", announcement_link: "" });
    expect(parsed.tagline).toBeNull();
    expect(parsed.announcement_link).toBeNull();
  });

  it("rejects out-of-bounds and over-length values", () => {
    expect(settingsSaveSchema.safeParse({ delivery_fee_dhaka: -1 }).success).toBe(false);
    expect(settingsSaveSchema.safeParse({ return_window_days: 9999 }).success).toBe(false);
    expect(settingsSaveSchema.safeParse({ store_name: "x".repeat(81) }).success).toBe(false);
  });

  it("ignores unknown keys", () => {
    const parsed = settingsSaveSchema.parse({ store_name: "S", nope: "x" } as never);
    expect("nope" in parsed).toBe(false);
  });

  it("rejects dangerous URL schemes on link fields (F-15)", () => {
    for (const field of ["announcement_link", "instagram", "facebook", "tiktok"]) {
      expect(settingsSaveSchema.safeParse({ [field]: "javascript:alert(1)" }).success).toBe(false);
      expect(settingsSaveSchema.safeParse({ [field]: "data:text/html,<script>" }).success).toBe(
        false,
      );
      expect(settingsSaveSchema.safeParse({ [field]: "//evil.com" }).success).toBe(false);
    }
  });

  it("accepts http(s) and site-relative links", () => {
    expect(
      settingsSaveSchema.safeParse({ instagram: "https://instagram.com/nongorr" }).success,
    ).toBe(true);
    expect(settingsSaveSchema.safeParse({ announcement_link: "/shop" }).success).toBe(true);
  });

  it("validates contact_email as an email address", () => {
    expect(settingsSaveSchema.safeParse({ contact_email: "not-an-email" }).success).toBe(false);
    expect(settingsSaveSchema.safeParse({ contact_email: "hi@nongorr.com" }).success).toBe(true);
  });
});

describe("isSafeLinkUrl", () => {
  it("accepts http(s) and site-relative paths", () => {
    expect(isSafeLinkUrl("https://x.com")).toBe(true);
    expect(isSafeLinkUrl("http://x.com")).toBe(true);
    expect(isSafeLinkUrl("/shop")).toBe(true);
  });

  it("rejects dangerous and protocol-relative schemes", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,x")).toBe(false);
    expect(isSafeLinkUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeLinkUrl("//evil.com")).toBe(false);
    expect(isSafeLinkUrl("not a url")).toBe(false);
  });
});

describe("settingsErrorMessage", () => {
  it("maps known codes and falls back to internal_error", () => {
    expect(settingsErrorMessage("actor_not_authorized")).toBe("Not authorized.");
    expect(settingsErrorMessage("invalid_settings")).toMatch(/invalid/i);
    expect(settingsErrorMessage("something_weird")).toBe(settingsErrorMessage("internal_error"));
  });
});

describe("normalizePublicSettings / normalizeAdminSettings", () => {
  it("coerces a full payload; receive numbers are public, admin/audit fields are not", () => {
    const pub = normalizePublicSettings({ ...fullPublic, bkash_number: "01711111111" });
    expect(pub?.store_name).toBe("Nongorr");
    expect(pub?.free_delivery_threshold).toBe(3000);
    // bKash/Nagad RECEIVE numbers are customer-facing → present on the public type.
    expect(pub?.bkash_number).toBe("01711111111");
    expect(pub?.nagad_number).toBeNull();
    // Admin-only / audit fields never leak onto the public projection.
    expect(pub && "payment_instructions" in pub).toBe(false);
    expect(pub && "updated_by" in pub).toBe(false);
  });

  it("returns null for junk and defaults missing numbers", () => {
    expect(normalizePublicSettings(null)).toBeNull();
    expect(normalizePublicSettings("x")).toBeNull();
    const pub = normalizePublicSettings({ store_name: "S" });
    expect(pub?.free_delivery_threshold).toBe(3000);
    expect(pub?.announcement_enabled).toBe(true);
    expect(pub?.tagline).toBeNull();
  });

  it("adds payment + audit fields for the admin projection", () => {
    const adm = normalizeAdminSettings({ ...fullPublic, bkash_number: "01700", updated_by: "u1" });
    expect(adm?.bkash_number).toBe("01700");
    expect(adm?.updated_by).toBe("u1");
    expect(adm?.nagad_number).toBeNull();
  });
});

describe("announcementState", () => {
  const base = normalizePublicSettings(fullPublic) as PublicSettings;

  it("returns fallback when settings are missing", () => {
    expect(announcementState(null)).toEqual({ mode: "fallback" });
  });

  it("returns hidden when the bar is disabled", () => {
    expect(announcementState({ ...base, announcement_enabled: false })).toEqual({ mode: "hidden" });
  });

  it("returns fallback when enabled but text is empty", () => {
    expect(announcementState({ ...base, announcement_text: "   " })).toEqual({ mode: "fallback" });
  });

  it("returns the custom text + link when enabled with text", () => {
    expect(announcementState(base)).toEqual({ mode: "custom", text: "Eid sale", link: "/shop" });
  });
});
