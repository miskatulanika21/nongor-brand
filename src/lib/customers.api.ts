/**
 * Admin customers API (Stage 4 P8) — read-only directory behind
 * `customers.view`. Same guard shape as listOrdersFn: no-store + permission,
 * then delegate to the service-role repository. Server-only modules are
 * imported inside the handler so they never enter the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { listCustomersSchema } from "@/lib/customers-shared";

export const listCustomersFn = createServerFn({ method: "GET" })
  .validator(listCustomersSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("customers.view");
    if (!authz.ok)
      return { success: false as const, error: "Not authorized.", customers: [], total: 0 };

    const { adminListCustomers } = await import("@/lib/server/customers.server");
    try {
      const result = await adminListCustomers({
        actorId: authz.identity.userId,
        search: data.search,
        limit: data.limit,
        offset: data.offset,
      });
      return { success: true as const, customers: result.customers, total: result.total };
    } catch {
      return {
        success: false as const,
        error: "Could not load customers.",
        customers: [],
        total: 0,
      };
    }
  });
