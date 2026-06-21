/**
 * Validation schema tests.
 *
 * Tests login, registration, password strength, email normalization,
 * phone normalization, auth confirm type allowlist, and safe redirect validation.
 */
import { describe, it, expect } from "vitest";
import {
  loginSchema,
  registerSchema,
  passwordUpdateSchema,
  authConfirmSchema,
  emailSchema,
  passwordSchema,
  privilegedPasswordSchema,
  isWeakPassword,
  normalizeBDPhone,
  bdPhoneSchema,
} from "@/lib/validation";
import { isSafeRedirect } from "@/lib/auth.api";

// ---- Login schema -----------------------------------------------------------

describe("loginSchema", () => {
  it("accepts valid email and password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "validpass",
    });
    expect(result.success).toBe(true);
  });

  it("normalizes email to lowercase", () => {
    const result = loginSchema.parse({
      email: " User@Example.COM ",
      password: "validpass",
    });
    expect(result.email).toBe("user@example.com");
  });

  it("rejects missing email", () => {
    const result = loginSchema.safeParse({ email: "", password: "pass" });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "pass123",
    });
    expect(result.success).toBe(false);
  });
});

// ---- Registration schema ----------------------------------------------------

describe("registerSchema", () => {
  const valid = {
    name: "Test User",
    phone: "01712345678",
    email: "test@example.com",
    password: "strong123",
    confirm: "strong123",
  };

  it("accepts valid registration", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({
      ...valid,
      confirm: "different",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short name", () => {
    const result = registerSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid Bangladesh phone", () => {
    const result = registerSchema.safeParse({
      ...valid,
      phone: "12345",
    });
    expect(result.success).toBe(false);
  });
});

// ---- Password strength ------------------------------------------------------

describe("passwordSchema (customer tier)", () => {
  it("accepts an 8+ character non-weak password", () => {
    expect(passwordSchema.safeParse("mistyriver8").success).toBe(true);
  });

  it("rejects passwords shorter than 8", () => {
    expect(passwordSchema.safeParse("abc123").success).toBe(false);
  });

  it("rejects common/weak passwords", () => {
    expect(passwordSchema.safeParse("password123").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });

  it("rejects empty password", () => {
    expect(passwordSchema.safeParse("").success).toBe(false);
  });

  it("rejects extremely long password", () => {
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("privilegedPasswordSchema (staff tier)", () => {
  it("accepts a strong 12+ mixed-class password", () => {
    expect(privilegedPasswordSchema.safeParse("Tr0ubadour-Hill").success).toBe(true);
  });

  it("rejects passwords shorter than 12", () => {
    expect(privilegedPasswordSchema.safeParse("Short1aa").success).toBe(false);
  });

  it("rejects missing character classes", () => {
    expect(privilegedPasswordSchema.safeParse("alllowercaseletters").success).toBe(false);
    expect(privilegedPasswordSchema.safeParse("ALLUPPERCASE1234").success).toBe(false);
  });

  it("rejects common/weak passwords even if long", () => {
    expect(privilegedPasswordSchema.safeParse("Password1234").success).toBe(false);
  });
});

describe("isWeakPassword", () => {
  it("flags denylisted passwords", () => {
    expect(isWeakPassword("password")).toBe(true);
    expect(isWeakPassword("Password123")).toBe(true);
    expect(isWeakPassword("nongorr123")).toBe(true);
  });

  it("flags passwords containing the email local part", () => {
    expect(isWeakPassword("ayeshaBoutique", "ayesha@nongorr.com")).toBe(true);
  });

  it("passes a genuinely strong password", () => {
    expect(isWeakPassword("Tr0ubadour-Hill", "ayesha@nongorr.com")).toBe(false);
  });
});

// ---- Password update schema -------------------------------------------------

describe("passwordUpdateSchema", () => {
  it("accepts matching passwords", () => {
    const result = passwordUpdateSchema.safeParse({
      password: "newpass123",
      confirm: "newpass123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = passwordUpdateSchema.safeParse({
      password: "newpass123",
      confirm: "different",
    });
    expect(result.success).toBe(false);
  });
});

// ---- Email normalization ----------------------------------------------------

describe("emailSchema", () => {
  it("trims whitespace", () => {
    expect(emailSchema.parse("  test@example.com  ")).toBe("test@example.com");
  });

  it("lowercases", () => {
    expect(emailSchema.parse("Test@EXAMPLE.com")).toBe("test@example.com");
  });

  it("rejects non-email", () => {
    expect(emailSchema.safeParse("notanemail").success).toBe(false);
  });
});

// ---- Bangladesh phone normalization -----------------------------------------

describe("normalizeBDPhone", () => {
  it("strips +880 prefix", () => {
    // Bangladesh international: +880 + local number (with leading 0)
    expect(normalizeBDPhone("+88001712345678")).toBe("01712345678");
  });

  it("strips 880 prefix", () => {
    expect(normalizeBDPhone("88001712345678")).toBe("01712345678");
  });

  it("strips dashes and spaces", () => {
    expect(normalizeBDPhone("017-1234-5678")).toBe("01712345678");
  });

  it("passes valid number through", () => {
    expect(normalizeBDPhone("01712345678")).toBe("01712345678");
  });
});

describe("bdPhoneSchema", () => {
  it("accepts valid BD phone", () => {
    expect(bdPhoneSchema.safeParse("01712345678").success).toBe(true);
  });

  it("rejects non-BD phone", () => {
    expect(bdPhoneSchema.safeParse("12345").success).toBe(false);
  });

  it("rejects 010 prefix (invalid operator)", () => {
    expect(bdPhoneSchema.safeParse("01012345678").success).toBe(false);
  });
});

// ---- Auth confirm type allowlist --------------------------------------------

describe("authConfirmSchema", () => {
  it("accepts email type", () => {
    const result = authConfirmSchema.safeParse({
      token_hash: "abc123",
      type: "email",
    });
    expect(result.success).toBe(true);
  });

  it("accepts recovery type", () => {
    const result = authConfirmSchema.safeParse({
      token_hash: "abc123",
      type: "recovery",
    });
    expect(result.success).toBe(true);
  });

  it("accepts magiclink type", () => {
    const result = authConfirmSchema.safeParse({
      token_hash: "abc123",
      type: "magiclink",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const result = authConfirmSchema.safeParse({
      token_hash: "abc123",
      type: "signup",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty token", () => {
    const result = authConfirmSchema.safeParse({
      token_hash: "",
      type: "email",
    });
    expect(result.success).toBe(false);
  });
});

// ---- Safe redirect validation -----------------------------------------------

describe("isSafeRedirect", () => {
  it("allows simple internal path", () => {
    expect(isSafeRedirect("/account")).toBe(true);
  });

  it("allows nested internal path", () => {
    expect(isSafeRedirect("/admin/orders")).toBe(true);
  });

  it("allows root path", () => {
    expect(isSafeRedirect("/")).toBe(true);
  });

  it("rejects protocol-relative URL", () => {
    expect(isSafeRedirect("//malicious.example")).toBe(false);
  });

  it("rejects absolute URL", () => {
    expect(isSafeRedirect("https://malicious.example")).toBe(false);
  });

  it("rejects javascript: protocol", () => {
    expect(isSafeRedirect("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: protocol", () => {
    expect(isSafeRedirect("data:text/html,<h1>evil</h1>")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeRedirect("")).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isSafeRedirect(null as unknown as string)).toBe(false);
    expect(isSafeRedirect(undefined as unknown as string)).toBe(false);
  });
});
