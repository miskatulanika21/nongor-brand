import { describe, it, expect } from "vitest";
import {
  ROLE_PERMISSIONS,
  roleHasPermission,
  permissionsForRole,
  OWNER_ONLY_PERMISSIONS,
  isAdminPermission,
} from "@/lib/permissions";

describe("permission registry", () => {
  it("owner holds every permission", () => {
    for (const p of permissionsForRole("owner")) {
      expect(roleHasPermission("owner", p)).toBe(true);
    }
    // Owner set is the superset.
    for (const p of ROLE_PERMISSIONS.admin) {
      expect(ROLE_PERMISSIONS.owner.has(p)).toBe(true);
    }
    for (const p of ROLE_PERMISSIONS.staff) {
      expect(ROLE_PERMISSIONS.owner.has(p)).toBe(true);
    }
  });

  it("staff has operational permissions only", () => {
    expect(roleHasPermission("staff", "orders.view")).toBe(true);
    expect(roleHasPermission("staff", "orders.manage")).toBe(true);
    expect(roleHasPermission("staff", "courier.manage")).toBe(true);
    expect(roleHasPermission("staff", "inventory.manage")).toBe(true);
    // Not allowed for staff
    expect(roleHasPermission("staff", "staff.view")).toBe(false);
    expect(roleHasPermission("staff", "settings.manage")).toBe(false);
    expect(roleHasPermission("staff", "audit.view")).toBe(false);
    expect(roleHasPermission("staff", "payments.verify")).toBe(false);
    expect(roleHasPermission("staff", "security.manage")).toBe(false);
    expect(roleHasPermission("staff", "integrations.manage")).toBe(false);
  });

  it("admin has management access but no owner-only powers", () => {
    expect(roleHasPermission("admin", "settings.manage")).toBe(true);
    expect(roleHasPermission("admin", "staff.view")).toBe(true);
    expect(roleHasPermission("admin", "staff.manage")).toBe(true);
    // Owner-only
    expect(roleHasPermission("admin", "audit.view")).toBe(false);
    expect(roleHasPermission("admin", "security.manage")).toBe(false);
    expect(roleHasPermission("admin", "integrations.manage")).toBe(false);
  });

  it("OWNER_ONLY_PERMISSIONS are held by owner but not admin", () => {
    expect(OWNER_ONLY_PERMISSIONS.length).toBeGreaterThan(0);
    for (const p of OWNER_ONLY_PERMISSIONS) {
      expect(ROLE_PERMISSIONS.owner.has(p)).toBe(true);
      expect(ROLE_PERMISSIONS.admin.has(p)).toBe(false);
    }
    expect(OWNER_ONLY_PERMISSIONS).toContain("audit.view");
    expect(OWNER_ONLY_PERMISSIONS).toContain("security.manage");
  });

  it("unknown role holds nothing", () => {
    expect(roleHasPermission(null, "dashboard.view")).toBe(false);
    expect(roleHasPermission(undefined, "dashboard.view")).toBe(false);
  });

  it("isAdminPermission type guard", () => {
    expect(isAdminPermission("orders.view")).toBe(true);
    expect(isAdminPermission("not.a.permission")).toBe(false);
    expect(isAdminPermission(42)).toBe(false);
  });
});
