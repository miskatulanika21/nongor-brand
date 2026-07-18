/**
 * Audit trail — isomorphic types, action taxonomy, display metadata, filters.
 *
 * NO server-only imports — safe for the browser bundle. This module is the
 * SINGLE SOURCE OF TRUTH for the audit action vocabulary: `AUDIT_ACTIONS` is the
 * runtime list, `AuditAction` is its type, and `AUDIT_ACTION_META` is a
 * `Record<AuditAction, …>` so the compiler forces every action to carry a label
 * (no silent drift). The server-side writer (`audit.server.ts`) imports
 * `AuditAction` from here, so the union and the runtime list can never diverge.
 */
import { z } from "zod";

// ── Action taxonomy (canonical) ──────────────────────────────────────────────

/**
 * Every audit action the system writes to `public.audit_logs`. Most are written
 * SQL-side inside the same transaction as the mutation by the `api.*` RPCs
 * (order lifecycle, coupons, shipments, settings, account import); the auth/MFA/
 * staff-login events are written best-effort by `writeAudit`. Extend here when a
 * new sensitive event appears, then add its `AUDIT_ACTION_META` entry (the
 * compiler will require it).
 */
export const AUDIT_ACTIONS = [
  // auth
  "auth.login.success",
  "auth.login.denied",
  "auth.login.failed",
  "auth.logout",
  "auth.password_reset.completed",
  "auth.password_changed",
  "auth.password_change.denied",
  // mfa / security
  "mfa.enroll.started",
  "mfa.enroll.denied",
  "mfa.enroll.failed",
  "mfa.enrolled",
  "mfa.removed",
  "mfa.remove.denied",
  "mfa.challenge.success",
  "mfa.challenge.failed",
  "authz.denied",
  "owner.action",
  // staff
  "staff.invited",
  "staff.provisioned",
  "staff.promoted",
  "staff.activated",
  "staff.deactivated",
  "staff.role_changed",
  // settings / integrations
  "settings.updated",
  "integration.changed",
  // catalog
  "product.created",
  "product.updated",
  "product.status_changed",
  "product.deleted",
  "category.created",
  "category.updated",
  "category.status_changed",
  "category.reordered",
  "category.deleted",
  // inventory
  "inventory.adjusted",
  "inventory.bulk_adjusted",
  // orders / payments
  "order.placed",
  "order.transition",
  "payment.evidence_submitted",
  // coupons
  "coupon.created",
  "coupon.updated",
  "coupon.status_changed",
  "coupon.deleted",
  // customer accounts
  "account.imported",
  "account.deleted",
  // contact inbox
  "contact.status_changed",
  // content (Stage 6)
  "banner.created",
  "banner.updated",
  "banner.status_changed",
  "banner.deleted",
  "page.draft_saved",
  "page.published",
  "page.draft_discarded",
  // founder page (owner-only CMS)
  "founder.draft_saved",
  "founder.published",
  "founder.draft_discarded",
  "size_chart.created",
  "size_chart.updated",
  "size_chart.status_changed",
  "size_chart.deleted",
  // shipments (Stage 5)
  "shipment.booked",
  "shipment.cancelled",
  "shipment.status_updated",
  "shipment.reconciled",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ── Categories + tones for display / filtering ───────────────────────────────

export const AUDIT_CATEGORIES = [
  "auth",
  "security",
  "staff",
  "settings",
  "catalog",
  "inventory",
  "orders",
  "payments",
  "coupons",
  "shipments",
  "account",
  "content",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  auth: "Authentication",
  security: "Security & MFA",
  staff: "Staff & roles",
  settings: "Settings",
  catalog: "Catalog",
  inventory: "Inventory",
  orders: "Orders",
  payments: "Payments",
  coupons: "Coupons",
  shipments: "Courier & shipments",
  account: "Customer accounts",
  content: "Content & banners",
};

/** Visual tone — mirrors the admin badge tones used elsewhere. */
export type AuditTone = "success" | "info" | "warning" | "danger" | "neutral";

export interface AuditActionMeta {
  label: string;
  category: AuditCategory;
  tone: AuditTone;
}

/**
 * Display metadata for every action. Typed as `Record<AuditAction, …>` so the
 * compiler fails the build if a new action is added to `AUDIT_ACTIONS` without a
 * label — that is the parity guarantee.
 */
export const AUDIT_ACTION_META: Record<AuditAction, AuditActionMeta> = {
  "auth.login.success": { label: "Signed in", category: "auth", tone: "success" },
  "auth.login.denied": { label: "Sign-in denied", category: "auth", tone: "warning" },
  "auth.login.failed": { label: "Sign-in failed", category: "auth", tone: "danger" },
  "auth.logout": { label: "Signed out", category: "auth", tone: "neutral" },
  "auth.password_reset.completed": {
    label: "Password reset completed",
    category: "auth",
    tone: "info",
  },
  "auth.password_changed": { label: "Password changed", category: "auth", tone: "info" },
  "auth.password_change.denied": {
    label: "Password change denied",
    category: "auth",
    tone: "warning",
  },
  "mfa.enroll.started": { label: "MFA enrollment started", category: "security", tone: "info" },
  "mfa.enroll.denied": { label: "MFA enrollment denied", category: "security", tone: "warning" },
  "mfa.enroll.failed": { label: "MFA enrollment failed", category: "security", tone: "danger" },
  "mfa.enrolled": { label: "MFA enrolled", category: "security", tone: "success" },
  "mfa.removed": { label: "MFA removed", category: "security", tone: "warning" },
  "mfa.remove.denied": { label: "MFA removal denied", category: "security", tone: "warning" },
  "mfa.challenge.success": { label: "MFA challenge passed", category: "security", tone: "success" },
  "mfa.challenge.failed": { label: "MFA challenge failed", category: "security", tone: "danger" },
  "authz.denied": { label: "Action denied", category: "security", tone: "danger" },
  "owner.action": { label: "Owner action", category: "security", tone: "info" },
  "staff.invited": { label: "Staff invited", category: "staff", tone: "info" },
  "staff.provisioned": { label: "Staff provisioned", category: "staff", tone: "success" },
  "staff.promoted": { label: "Customer promoted to staff", category: "staff", tone: "success" },
  "staff.activated": { label: "Staff activated", category: "staff", tone: "success" },
  "staff.deactivated": { label: "Staff deactivated", category: "staff", tone: "warning" },
  "staff.role_changed": { label: "Staff role changed", category: "staff", tone: "info" },
  "settings.updated": { label: "Settings updated", category: "settings", tone: "info" },
  "integration.changed": { label: "Integration changed", category: "settings", tone: "info" },
  "product.created": { label: "Product created", category: "catalog", tone: "success" },
  "product.updated": { label: "Product updated", category: "catalog", tone: "info" },
  "product.status_changed": { label: "Product status changed", category: "catalog", tone: "info" },
  "product.deleted": { label: "Product deleted", category: "catalog", tone: "danger" },
  "category.created": { label: "Category created", category: "catalog", tone: "success" },
  "category.updated": { label: "Category updated", category: "catalog", tone: "info" },
  "category.status_changed": {
    label: "Category status changed",
    category: "catalog",
    tone: "info",
  },
  "category.reordered": { label: "Categories reordered", category: "catalog", tone: "neutral" },
  "category.deleted": { label: "Category deleted", category: "catalog", tone: "danger" },
  "inventory.adjusted": { label: "Inventory adjusted", category: "inventory", tone: "info" },
  "inventory.bulk_adjusted": {
    label: "Inventory bulk-adjusted",
    category: "inventory",
    tone: "info",
  },
  "order.placed": { label: "Order placed", category: "orders", tone: "success" },
  "order.transition": { label: "Order status changed", category: "orders", tone: "info" },
  "payment.evidence_submitted": {
    label: "Payment evidence submitted",
    category: "payments",
    tone: "info",
  },
  "coupon.created": { label: "Coupon created", category: "coupons", tone: "success" },
  "coupon.updated": { label: "Coupon updated", category: "coupons", tone: "info" },
  "coupon.status_changed": { label: "Coupon status changed", category: "coupons", tone: "info" },
  "coupon.deleted": { label: "Coupon deleted", category: "coupons", tone: "danger" },
  "account.imported": { label: "Account data imported", category: "account", tone: "neutral" },
  "account.deleted": { label: "Account deleted", category: "account", tone: "danger" },
  "contact.status_changed": {
    label: "Contact message updated",
    category: "account",
    tone: "info",
  },
  "banner.created": { label: "Banner created", category: "content", tone: "success" },
  "banner.updated": { label: "Banner updated", category: "content", tone: "info" },
  "banner.status_changed": { label: "Banner status changed", category: "content", tone: "info" },
  "banner.deleted": { label: "Banner deleted", category: "content", tone: "danger" },
  "page.draft_saved": { label: "Page draft saved", category: "content", tone: "neutral" },
  "page.published": { label: "Page published", category: "content", tone: "success" },
  "page.draft_discarded": { label: "Page draft discarded", category: "content", tone: "warning" },
  "founder.draft_saved": { label: "Founder draft saved", category: "content", tone: "neutral" },
  "founder.published": { label: "Founder page published", category: "content", tone: "success" },
  "founder.draft_discarded": {
    label: "Founder draft discarded",
    category: "content",
    tone: "warning",
  },
  "size_chart.created": { label: "Size chart created", category: "catalog", tone: "success" },
  "size_chart.updated": { label: "Size chart updated", category: "catalog", tone: "info" },
  "size_chart.status_changed": {
    label: "Size chart status changed",
    category: "catalog",
    tone: "info",
  },
  "size_chart.deleted": { label: "Size chart deleted", category: "catalog", tone: "danger" },
  "shipment.booked": { label: "Courier booked", category: "shipments", tone: "success" },
  "shipment.cancelled": { label: "Shipment cancelled", category: "shipments", tone: "warning" },
  "shipment.status_updated": {
    label: "Shipment status updated",
    category: "shipments",
    tone: "info",
  },
  "shipment.reconciled": { label: "Shipment reconciled", category: "shipments", tone: "info" },
};

const KNOWN_AUDIT_ACTIONS = new Set<string>(AUDIT_ACTIONS);

/** Is this an action string the system knows about? */
export function isKnownAuditAction(value: string): value is AuditAction {
  return KNOWN_AUDIT_ACTIONS.has(value);
}

/**
 * Human label for any action. Unknown/future actions (e.g. an action written by
 * a newer DB migration than the deployed bundle) degrade to a title-cased
 * version of the raw string rather than throwing — the trail never breaks.
 */
export function auditActionLabel(action: string): string {
  if (isKnownAuditAction(action)) return AUDIT_ACTION_META[action].label;
  return action
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function auditActionTone(action: string): AuditTone {
  return isKnownAuditAction(action) ? AUDIT_ACTION_META[action].tone : "neutral";
}

export function auditActionCategory(action: string): AuditCategory | null {
  return isKnownAuditAction(action) ? AUDIT_ACTION_META[action].category : null;
}

/** Actions belonging to a category, in declaration order (for filter groups). */
export function actionsForCategory(category: AuditCategory): AuditAction[] {
  return AUDIT_ACTIONS.filter((a) => AUDIT_ACTION_META[a].category === category);
}

// ── DTOs (camelCase, mapped from the snake_case RPC payload) ──────────────────

/** JSON-serializable value — audit metadata is arbitrary but always JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface AuditLogRow {
  id: number;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: JsonObject;
  createdAt: string;
}

export interface AuditLogListResult {
  rows: AuditLogRow[];
  total: number;
}

/** Best display name for an actor row: staff name → email → "System" → short id. */
export function auditActorDisplay(row: AuditLogRow): string {
  if (!row.actorId) return "System";
  return row.actorName || row.actorEmail || `${row.actorId.slice(0, 8)}…`;
}

// ── Filter input schema (server fn validator) ────────────────────────────────

export const auditFilterSchema = z.object({
  action: z.string().max(64).optional(),
  targetType: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export type AuditFilterInput = z.infer<typeof auditFilterSchema>;
