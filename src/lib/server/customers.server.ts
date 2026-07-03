/**
 * Admin customers repository — SERVER ONLY (Stage 4 P8).
 *
 * Wraps the service-role client over api.admin_list_customers (REVOKE-d from
 * anon/authenticated; active-staff assert inside the RPC). Authorization
 * (customers.view) is enforced upstream in customers.api.ts; this layer only
 * does the system call + snake→camel mapping, same shape as orders.server.ts.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import type { AdminCustomer, AdminCustomersResult } from "@/lib/customers-shared";

interface RawCustomerRow {
  user_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  joined_at: string;
  orders_count: number;
  lifetime_spent: number;
  returns_count: number;
  last_order_at: string | null;
  has_custom_size: boolean;
}

function mapCustomer(r: RawCustomerRow): AdminCustomer {
  return {
    userId: r.user_id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    joinedAt: r.joined_at,
    ordersCount: r.orders_count,
    lifetimeSpent: r.lifetime_spent,
    returnsCount: r.returns_count,
    lastOrderAt: r.last_order_at,
    hasCustomSize: r.has_custom_size === true,
  };
}

export interface ListCustomersArgs {
  actorId: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function adminListCustomers(args: ListCustomersArgs): Promise<AdminCustomersResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("admin_list_customers", {
    p_actor: args.actorId,
    p_search: args.search ?? null,
    p_limit: args.limit ?? 20,
    p_offset: args.offset ?? 0,
  });
  if (error) throw new Error("admin_list_customers failed");
  const raw = (data ?? { customers: [], total: 0 }) as {
    customers: RawCustomerRow[] | null;
    total: number;
  };
  return {
    customers: (raw.customers ?? []).map(mapCustomer),
    total: raw.total ?? 0,
  };
}
