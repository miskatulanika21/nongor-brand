/**
 * Tests for the pure post-login destination resolver and the validator.
 * No database or server dependencies.
 */
import { describe, it, expect } from "vitest";
import {
  resolveLoginDestination,
  isValidLoginDestination,
  type LoginIdentity,
} from "@/lib/server/login-destination.server";

function makeIdentity(overrides: Partial<LoginIdentity> = {}): LoginIdentity {
  return {
    userId: "user-123",
    email: "test@example.com",
    designation: "customer",
    hasAdminAccess: false,
    ...overrides,
  };
}

const CUSTOMER = makeIdentity();
const STAFF = makeIdentity({ designation: "staff", hasAdminAccess: true });
const ADMIN = makeIdentity({ designation: "admin", hasAdminAccess: true });
const OWNER = makeIdentity({ designation: "owner", hasAdminAccess: true });

describe("resolveLoginDestination", () => {
  describe("default destinations (no next)", () => {
    it("customer → /account", () => {
      expect(resolveLoginDestination(CUSTOMER).destination).toBe("/account");
    });
    it("staff → /admin", () => {
      expect(resolveLoginDestination(STAFF).destination).toBe("/admin");
    });
    it("admin → /admin", () => {
      expect(resolveLoginDestination(ADMIN).destination).toBe("/admin");
    });
    it("owner → /admin", () => {
      expect(resolveLoginDestination(OWNER).destination).toBe("/admin");
    });
  });

  describe("customer next handling (approved families only)", () => {
    it("customer + /checkout → /checkout", () => {
      expect(resolveLoginDestination(CUSTOMER, "/checkout").destination).toBe("/checkout");
    });
    it("customer + /account/profile → /account/profile", () => {
      expect(resolveLoginDestination(CUSTOMER, "/account/profile").destination).toBe(
        "/account/profile",
      );
    });
    it("customer + /shop → /shop", () => {
      expect(resolveLoginDestination(CUSTOMER, "/shop").destination).toBe("/shop");
    });
    it("customer + non-approved path → /account", () => {
      expect(resolveLoginDestination(CUSTOMER, "/some/random/page").destination).toBe("/account");
    });
    it("customer + /admin → /account + adminDenied", () => {
      const r = resolveLoginDestination(CUSTOMER, "/admin");
      expect(r.destination).toBe("/account");
      expect(r.adminDenied).toBe(true);
    });
    it("customer + /admin/orders → /account + adminDenied", () => {
      const r = resolveLoginDestination(CUSTOMER, "/admin/orders");
      expect(r.destination).toBe("/account");
      expect(r.adminDenied).toBe(true);
    });
  });

  describe("privileged users may only land in /admin", () => {
    it("owner + /checkout → /admin", () => {
      expect(resolveLoginDestination(OWNER, "/checkout").destination).toBe("/admin");
    });
    it("staff + /account → /admin", () => {
      expect(resolveLoginDestination(STAFF, "/account").destination).toBe("/admin");
    });
    it("admin + /wishlist → /admin", () => {
      expect(resolveLoginDestination(ADMIN, "/wishlist").destination).toBe("/admin");
    });
  });

  describe("admin sub-page permission checks", () => {
    it("staff + /admin/orders → /admin/orders (has orders.view)", () => {
      expect(resolveLoginDestination(STAFF, "/admin/orders").destination).toBe("/admin/orders");
    });
    it("staff + /admin/staff → /admin (lacks staff.view)", () => {
      expect(resolveLoginDestination(STAFF, "/admin/staff").destination).toBe("/admin");
    });
    it("staff + /admin/audit → /admin (lacks audit.view)", () => {
      expect(resolveLoginDestination(STAFF, "/admin/audit").destination).toBe("/admin");
    });
    it("admin + /admin/audit → /admin (lacks audit.view)", () => {
      expect(resolveLoginDestination(ADMIN, "/admin/audit").destination).toBe("/admin");
    });
    it("admin + /admin/settings → /admin/settings (has settings.manage)", () => {
      expect(resolveLoginDestination(ADMIN, "/admin/settings").destination).toBe("/admin/settings");
    });
    it("owner + /admin/audit → /admin/audit (owner has all)", () => {
      expect(resolveLoginDestination(OWNER, "/admin/audit").destination).toBe("/admin/audit");
    });
  });

  describe("loop prevention and canonicalization", () => {
    it("/admin/login → /admin for staff", () => {
      expect(resolveLoginDestination(STAFF, "/admin/login").destination).toBe("/admin");
    });
    it("/admin/login → /account + adminDenied for customer", () => {
      const r = resolveLoginDestination(CUSTOMER, "/admin/login");
      expect(r.destination).toBe("/account");
      expect(r.adminDenied).toBe(true);
    });
    it("rejects /login as destination (customer → /account)", () => {
      expect(resolveLoginDestination(CUSTOMER, "/login").destination).toBe("/account");
    });
    it("rejects /login for staff (→ /admin)", () => {
      expect(resolveLoginDestination(STAFF, "/login").destination).toBe("/admin");
    });
  });

  describe("unsafe redirect rejection", () => {
    const cases = [
      "https://evil.com",
      "//evil.com",
      "%2F%2Fevil.com",
      "%252F%252Fevil.com",
      "/test\\evil.com",
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "",
    ];
    for (const c of cases) {
      it(`customer + ${JSON.stringify(c)} → /account`, () => {
        expect(resolveLoginDestination(CUSTOMER, c).destination).toBe("/account");
      });
    }
    it("customer + null → /account", () => {
      expect(resolveLoginDestination(CUSTOMER, null).destination).toBe("/account");
    });
  });
});

describe("isValidLoginDestination", () => {
  it("accepts valid relative paths", () => {
    expect(isValidLoginDestination("/account")).toBe(true);
    expect(isValidLoginDestination("/admin")).toBe(true);
    expect(isValidLoginDestination("/admin/orders")).toBe(true);
  });
  it("rejects loop-causing paths", () => {
    expect(isValidLoginDestination("/login")).toBe(false);
    expect(isValidLoginDestination("/admin/login")).toBe(false);
  });
  it("rejects external / protocol-relative / scheme URLs", () => {
    expect(isValidLoginDestination("https://evil.com")).toBe(false);
    expect(isValidLoginDestination("//evil.com")).toBe(false);
    expect(isValidLoginDestination("javascript:alert(1)")).toBe(false);
    expect(isValidLoginDestination("data:text/html,hi")).toBe(false);
  });
  it("rejects backslash and null/empty", () => {
    expect(isValidLoginDestination("/test\\path")).toBe(false);
    expect(isValidLoginDestination(null)).toBe(false);
    expect(isValidLoginDestination(undefined)).toBe(false);
    expect(isValidLoginDestination("")).toBe(false);
  });
});
