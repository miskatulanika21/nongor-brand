/**
 * RBAC and auth-types tests.
 *
 * Tests role hierarchy, meetsMinimumRole, and StaffRole type definitions.
 */
import { describe, it, expect } from "vitest";
import { meetsMinimumRole, type StaffRole } from "@/lib/auth-types";

describe("meetsMinimumRole", () => {
  const roles: StaffRole[] = ["staff", "admin", "owner"];

  it("owner meets all roles", () => {
    for (const minimum of roles) {
      expect(meetsMinimumRole("owner", minimum)).toBe(true);
    }
  });

  it("admin meets admin and staff", () => {
    expect(meetsMinimumRole("admin", "staff")).toBe(true);
    expect(meetsMinimumRole("admin", "admin")).toBe(true);
  });

  it("admin does NOT meet owner", () => {
    expect(meetsMinimumRole("admin", "owner")).toBe(false);
  });

  it("staff meets only staff", () => {
    expect(meetsMinimumRole("staff", "staff")).toBe(true);
    expect(meetsMinimumRole("staff", "admin")).toBe(false);
    expect(meetsMinimumRole("staff", "owner")).toBe(false);
  });

  it("same role always meets itself", () => {
    for (const role of roles) {
      expect(meetsMinimumRole(role, role)).toBe(true);
    }
  });
});
