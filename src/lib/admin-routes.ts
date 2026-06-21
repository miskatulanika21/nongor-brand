/**
 * Admin route → required-permission map.
 *
 * Single source of truth for:
 *   - Admin sidebar / mobile-menu / quick-action visibility (client)
 *   - Post-login destination permission checks (server)
 *   - Per-page route guards (server)
 *
 * Isomorphic: NO server-only and NO React/icon imports. Icons are mapped to
 * components in the admin layout from the string `icon` keys here so this
 * module stays bundle-safe on both sides.
 */
import type { AdminPermission } from "@/lib/permissions";
import { roleHasPermission } from "@/lib/permissions";
import type { StaffRole } from "@/lib/auth-types";

/** Stable icon identifiers resolved to lucide components in the admin layout. */
export type AdminIconKey =
  | "dashboard"
  | "products"
  | "categories"
  | "inventory"
  | "sizes"
  | "orders"
  | "payments"
  | "courier"
  | "customers"
  | "coupons"
  | "reviews"
  | "banners"
  | "media"
  | "policies"
  | "reports"
  | "settings"
  | "staff"
  | "audit";

export interface AdminNavItem {
  label: string;
  to: string;
  icon: AdminIconKey;
  /** Permission required to see the link AND to load the page. */
  permission: AdminPermission;
}

export interface AdminNavGroup {
  group: string;
  items: AdminNavItem[];
}

/**
 * The full admin navigation, ordered. Each item declares the single
 * permission that gates it. Nav filtering and server guards both read this.
 */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    group: "Overview",
    items: [{ label: "Dashboard", to: "/admin", icon: "dashboard", permission: "dashboard.view" }],
  },
  {
    group: "Catalog",
    items: [
      { label: "Products", to: "/admin/products", icon: "products", permission: "products.view" },
      {
        label: "Categories",
        to: "/admin/categories",
        icon: "categories",
        permission: "categories.manage",
      },
      {
        label: "Inventory",
        to: "/admin/inventory",
        icon: "inventory",
        permission: "inventory.view",
      },
      {
        label: "Size Settings",
        to: "/admin/size-settings",
        icon: "sizes",
        permission: "sizes.manage",
      },
    ],
  },
  {
    group: "Sales",
    items: [
      { label: "Orders", to: "/admin/orders", icon: "orders", permission: "orders.view" },
      { label: "Payments", to: "/admin/payments", icon: "payments", permission: "payments.view" },
      { label: "Courier", to: "/admin/courier", icon: "courier", permission: "courier.view" },
      {
        label: "Customers",
        to: "/admin/customers",
        icon: "customers",
        permission: "customers.view",
      },
      { label: "Coupons", to: "/admin/coupons", icon: "coupons", permission: "coupons.manage" },
    ],
  },
  {
    group: "Content",
    items: [
      { label: "Reviews", to: "/admin/reviews", icon: "reviews", permission: "reviews.manage" },
      { label: "Banners", to: "/admin/banners", icon: "banners", permission: "content.manage" },
      {
        label: "Media Library",
        to: "/admin/media-library",
        icon: "media",
        permission: "media.manage",
      },
      {
        label: "Policies",
        to: "/admin/policies",
        icon: "policies",
        permission: "policies.manage",
      },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Reports", to: "/admin/reports", icon: "reports", permission: "reports.view" },
      { label: "Settings", to: "/admin/settings", icon: "settings", permission: "settings.manage" },
      { label: "Staff Roles", to: "/admin/staff", icon: "staff", permission: "staff.view" },
      { label: "Audit Logs", to: "/admin/audit", icon: "audit", permission: "audit.view" },
    ],
  },
];

/** Flat list of every nav item (ungrouped). */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

/**
 * Resolve the permission required to access an /admin path.
 *
 * Matches the most specific (longest `to`) nav item that prefixes the path.
 * `/admin` itself maps to `dashboard.view`. Returns null for non-admin paths.
 */
export function requiredPermissionForAdminPath(pathname: string): AdminPermission | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (path !== "/admin" && !path.startsWith("/admin/")) return null;

  let best: AdminNavItem | null = null;
  for (const item of ADMIN_NAV_ITEMS) {
    if (path === item.to || path.startsWith(item.to + "/")) {
      if (!best || item.to.length > best.to.length) best = item;
    }
  }
  // Any admin path with no more specific match still requires at least
  // dashboard access (e.g. /admin or an unmapped /admin/* sub-route).
  return best?.permission ?? "dashboard.view";
}

/** Does this role have access to the given /admin path? */
export function roleCanAccessAdminPath(
  role: StaffRole | null | undefined,
  pathname: string,
): boolean {
  const permission = requiredPermissionForAdminPath(pathname);
  if (!permission) return false;
  return roleHasPermission(role, permission);
}

/** Build the role-filtered navigation (used by the admin layout). */
export function navForRole(role: StaffRole | null | undefined): AdminNavGroup[] {
  if (!role) return [];
  return ADMIN_NAV.map((group) => ({
    group: group.group,
    items: group.items.filter((item) => roleHasPermission(role, item.permission)),
  })).filter((group) => group.items.length > 0);
}
