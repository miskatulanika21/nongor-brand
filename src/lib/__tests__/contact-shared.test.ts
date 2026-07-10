import { describe, it, expect } from "vitest";
import {
  contactSubmitSchema,
  contactListSchema,
  contactStatusSchema,
  CONTACT_STATUSES,
  CONTACT_REASONS,
  isContactStatus,
  contactErrorMessage,
  CONTACT_ERROR_MESSAGES,
} from "@/lib/contact-shared";

describe("contactSubmitSchema", () => {
  const valid = {
    name: "Ayesha",
    phone: "01712345678",
    reason: "Order Help",
    message: "Where is my order?",
  };

  it("accepts a valid submission (email/orderNumber optional)", () => {
    expect(contactSubmitSchema.safeParse(valid).success).toBe(true);
    expect(
      contactSubmitSchema.safeParse({ ...valid, email: "a@b.com", orderNumber: "NGR-1" }).success,
    ).toBe(true);
    // empty strings are allowed for the optional fields
    expect(contactSubmitSchema.safeParse({ ...valid, email: "", orderNumber: "" }).success).toBe(
      true,
    );
  });

  it("rejects a bad BD phone", () => {
    expect(contactSubmitSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
    expect(contactSubmitSchema.safeParse({ ...valid, phone: "01012345678" }).success).toBe(false);
  });

  it("accepts a BD phone with spaces/dashes", () => {
    expect(contactSubmitSchema.safeParse({ ...valid, phone: "017-1234 5678" }).success).toBe(true);
  });

  it("rejects an unknown reason and empty required fields", () => {
    expect(contactSubmitSchema.safeParse({ ...valid, reason: "Nope" }).success).toBe(false);
    expect(contactSubmitSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(contactSubmitSchema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });

  it("rejects an invalid email when provided", () => {
    expect(contactSubmitSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("all storefront reasons are accepted", () => {
    for (const reason of CONTACT_REASONS) {
      expect(contactSubmitSchema.safeParse({ ...valid, reason }).success).toBe(true);
    }
  });
});

describe("admin schemas + status", () => {
  it("isContactStatus is a precise guard", () => {
    for (const s of CONTACT_STATUSES) expect(isContactStatus(s)).toBe(true);
    expect(isContactStatus("bogus")).toBe(false);
    expect(isContactStatus(null)).toBe(false);
  });

  it("contactListSchema bounds", () => {
    expect(contactListSchema.safeParse({}).success).toBe(true);
    expect(contactListSchema.safeParse({ status: "new", limit: 25 }).success).toBe(true);
    expect(contactListSchema.safeParse({ status: "bad" }).success).toBe(false);
    expect(contactListSchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it("contactStatusSchema requires uuid + valid status", () => {
    expect(
      contactStatusSchema.safeParse({
        id: "11111111-1111-1111-1111-111111111111",
        status: "handled",
      }).success,
    ).toBe(true);
    expect(contactStatusSchema.safeParse({ id: "nope", status: "handled" }).success).toBe(false);
    expect(
      contactStatusSchema.safeParse({ id: "11111111-1111-1111-1111-111111111111", status: "x" })
        .success,
    ).toBe(false);
  });
});

describe("contactErrorMessage", () => {
  it("maps known codes and falls back", () => {
    expect(contactErrorMessage("invalid_contact")).toContain("invalid");
    expect(contactErrorMessage("contact_message_not_found")).toContain("no longer exists");
    expect(contactErrorMessage("whatever")).toContain("Could not send");
    expect(contactErrorMessage(null)).toContain("Could not send");
  });

  it("never leaks raw SQL", () => {
    for (const code of Object.keys(CONTACT_ERROR_MESSAGES)) {
      const msg = contactErrorMessage(code);
      expect(msg).not.toContain("SQLERRM");
      expect(msg).not.toContain("RAISE");
    }
  });
});
