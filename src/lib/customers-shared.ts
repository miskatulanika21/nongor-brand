/**
 * Admin customers directory — isomorphic model (Stage 4 P8).
 *
 * The DB (api.admin_list_customers) owns the aggregates; this module owns the
 * validator for the list server fn and the DERIVED customer tags. Tags are
 * computed from the aggregates on render — never stored — so the thresholds
 * here are the single source of truth for what "VIP" etc. mean.
 */
import { z } from "zod";

/** One directory row as returned by adminListCustomers (camelCase). */
export interface AdminCustomer {
  userId: string;
  /** Profile full_name, else the latest order snapshot name, else "Customer". */
  name: string;
  phone: string | null;
  email: string | null;
  joinedAt: string;
  /** Orders excluding cancelled + expired. */
  ordersCount: number;
  /** Sum of totals over the counted orders (integer BDT). */
  lifetimeSpent: number;
  /** Orders in returned / refund_pending / refund_done. */
  returnsCount: number;
  /** Most recent placed_at across ALL orders (null = never ordered). */
  lastOrderAt: string | null;
  /** Any line item ever carried custom measurements. */
  hasCustomSize: boolean;
}

export interface AdminCustomersResult {
  customers: AdminCustomer[];
  total: number;
}

/** Validator for listCustomersFn (bounds mirror the RPC's clamps). */
export const listCustomersSchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;

// ── Derived tags ─────────────────────────────────────────────────────────────

export type CustomerTag = "VIP" | "Repeat Customer" | "High Risk" | "Custom Size";

/** A customer is VIP once they cross either loyalty threshold. */
export const VIP_MIN_SPENT = 20000;
export const VIP_MIN_ORDERS = 5;
export const REPEAT_MIN_ORDERS = 2;
export const HIGH_RISK_MIN_RETURNS = 2;

/**
 * Derive the badge set for a directory row. Order matters — it is the display
 * order (strongest signal first). VIP subsumes "Repeat Customer" so a heavy
 * buyer doesn't wear two loyalty badges.
 */
export function customerTags(c: AdminCustomer): CustomerTag[] {
  const tags: CustomerTag[] = [];
  const vip = c.lifetimeSpent >= VIP_MIN_SPENT || c.ordersCount >= VIP_MIN_ORDERS;
  if (vip) tags.push("VIP");
  else if (c.ordersCount >= REPEAT_MIN_ORDERS) tags.push("Repeat Customer");
  if (c.returnsCount >= HIGH_RISK_MIN_RETURNS) tags.push("High Risk");
  if (c.hasCustomSize) tags.push("Custom Size");
  return tags;
}
