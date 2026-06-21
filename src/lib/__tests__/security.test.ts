/**
 * Security utility tests.
 *
 * Tests PII redaction and generic error helpers.
 * CSRF origin checking is tested separately because it requires request context.
 */
import { describe, it, expect } from "vitest";
import { redactPII, genericAuthError, fieldError } from "@/lib/server/security.server";

describe("redactPII", () => {
  it("redacts email addresses", () => {
    expect(redactPII("User user@example.com failed")).toBe("User [EMAIL_REDACTED] failed");
  });

  it("redacts Bangladesh phone numbers", () => {
    expect(redactPII("Phone: 01712345678")).toBe("Phone: [PHONE_REDACTED]");
    expect(redactPII("Phone: +8801712345678")).toBe("Phone: [PHONE_REDACTED]");
  });

  it("redacts JWT tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactPII(`Token: ${jwt}`)).toBe("Token: [JWT_REDACTED]");
  });

  it("leaves clean strings unchanged", () => {
    expect(redactPII("Login failed for unknown reason")).toBe("Login failed for unknown reason");
  });

  it("handles multiple redactions in one string", () => {
    const result = redactPII("User user@test.com called from 01712345678");
    expect(result).not.toContain("user@test.com");
    expect(result).not.toContain("01712345678");
  });
});

describe("genericAuthError", () => {
  it("returns default message", () => {
    expect(genericAuthError()).toEqual({
      error: "Authentication failed. Please try again.",
    });
  });

  it("returns custom message", () => {
    expect(genericAuthError("Custom error")).toEqual({
      error: "Custom error",
    });
  });
});

describe("fieldError", () => {
  it("returns field-specific error", () => {
    expect(fieldError("email", "Invalid email")).toEqual({
      fieldErrors: { email: "Invalid email" },
    });
  });
});
