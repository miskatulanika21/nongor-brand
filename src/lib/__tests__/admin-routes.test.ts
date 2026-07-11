import { describe, it, expect } from "vitest";
import {
  requiredPermissionForAdminPath,
  roleCanAccessAdminPath,
  navForRole,
} from "@/lib/admin-routes";

describe("requiredPermissionForAdminPath", () => {
  it("maps /admin to dashboard.view", () => {
    expect(requiredPermissionForAdminPath("/admin")).toBe("dashboard.view");
  });
  it("maps known sub-routes to their permission", () => {
    expect(requiredPermissionForAdminPath("/admin/orders")).toBe("orders.view");
    expect(requiredPermissionForAdminPath("/admin/staff")).toBe("staff.view");
    expect(requiredPermissionForAdminPath("/admin/audit")).toBe("audit.view");
    expect(requiredPermissionForAdminPath("/admin/settings")).toBe("settings.manage");
  });
  it("matches the most specific prefix and ignores query/trailing slash", () => {
    expect(requiredPermissionForAdminPath("/admin/orders/NGR-1?tab=x")).toBe("orders.view");
    expect(requiredPermissionForAdminPath("/admin/orders/")).toBe("orders.view");
  });
  it("unmapped admin sub-route still requires at least dashboard.view", () => {
    expect(requiredPermissionForAdminPath("/admin/unknown")).toBe("dashboard.view");
  });
  it("keeps the permission guard for hidden (coming-soon) routes", () => {
    // Hidden from the sidebar, but the route must still be permission-mapped so
    // a deep-link can't bypass the guard.
    expect(requiredPermissionForAdminPath("/admin/size-settings")).toBe("sizes.manage");
  });
  it("maps the Stage-6 screens (real now) to their permissions", () => {
    expect(requiredPermissionForAdminPath("/admin/banners")).toBe("content.manage");
    expect(requiredPermissionForAdminPath("/admin/reports")).toBe("reports.view");
  });
  it("returns null for non-admin paths", () => {
    expect(requiredPermissionForAdminPath("/account")).toBeNull();
    expect(requiredPermissionForAdminPath("/")).toBeNull();
  });
});

describe("roleCanAccessAdminPath", () => {
  it("staff can reach operational pages only", () => {
    expect(roleCanAccessAdminPath("staff", "/admin")).toBe(true);
    expect(roleCanAccessAdminPath("staff", "/admin/orders")).toBe(true);
    expect(roleCanAccessAdminPath("staff", "/admin/courier")).toBe(true);
    expect(roleCanAccessAdminPath("staff", "/admin/staff")).toBe(false);
    expect(roleCanAccessAdminPath("staff", "/admin/settings")).toBe(false);
    expect(roleCanAccessAdminPath("staff", "/admin/audit")).toBe(false);
  });
  it("admin can reach management pages but not owner-only", () => {
    expect(roleCanAccessAdminPath("admin", "/admin/settings")).toBe(true);
    expect(roleCanAccessAdminPath("admin", "/admin/staff")).toBe(true);
    expect(roleCanAccessAdminPath("admin", "/admin/audit")).toBe(false);
  });
  it("owner can reach everything", () => {
    expect(roleCanAccessAdminPath("owner", "/admin/audit")).toBe(true);
    expect(roleCanAccessAdminPath("owner", "/admin/settings")).toBe(true);
  });
  it("null role cannot reach admin", () => {
    expect(roleCanAccessAdminPath(null, "/admin")).toBe(false);
  });
});

describe("navForRole", () => {
  it("filters groups/items by permission", () => {
    const staffNav = navForRole("staff");
    const labels = staffNav.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Orders");
    expect(labels).toContain("Courier");
    expect(labels).not.toContain("Staff Roles");
    expect(labels).not.toContain("Audit Logs");
    expect(labels).not.toContain("Settings");
  });
  it("owner sees the full menu", () => {
    const ownerNav = navForRole("owner");
    const labels = ownerNav.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Audit Logs");
    expect(labels).toContain("Staff Roles");
    expect(labels).toContain("Settings");
  });
  it("excludes hidden (coming-soon) items from the sidebar", () => {
    const ownerNav = navForRole("owner");
    const labels = ownerNav.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).not.toContain("Size Settings");
  });
  it("shows the Stage-6 screens (real now) to authorized roles", () => {
    const ownerNav = navForRole("owner");
    const labels = ownerNav.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Banners");
    expect(labels).toContain("Reports");
    // staff lack reports.view — no Reports in their sidebar
    const staffLabels = navForRole("staff").flatMap((g) => g.items.map((i) => i.label));
    expect(staffLabels).not.toContain("Reports");
  });
  it("empty groups are dropped", () => {
    const staffNav = navForRole("staff");
    for (const g of staffNav) expect(g.items.length).toBeGreaterThan(0);
  });
  it("null role gets no nav", () => {
    expect(navForRole(null)).toEqual([]);
  });
});
