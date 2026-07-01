/**
 * Orders admin API — createServerFn handlers for the admin fulfilment loop.
 *
 * Reads require `orders.view`; every write goes through guardAdminWrite (CSRF +
 * strict permission + MFA step-up + rate limit + denial audit) before delegating
 * to the service-role repository (orders.server.ts), which calls the REVOKE-d
 * api.* order RPCs. Payment verify/reject gate on `payments.verify`; lifecycle
 * transitions on `orders.manage`. The canonical `order.transition` audit is
 * written inside the RPC, in the same transaction as the status change.
 *
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as catalog-admin.api.ts / checkout.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import {
  listOrdersSchema,
  orderIdSchema,
  transitionOrderSchema,
  rejectPaymentSchema,
  cancelOrderSchema,
  returnOrderSchema,
  listMyOrdersSchema,
  trackOrderSchema,
} from "@/lib/orders-shared";

/** Map any thrown repo error to a safe, granular message via the stable code. */
async function messageFromOrderError(e: unknown): Promise<string> {
  const { OrderError } = await import("@/lib/server/orders.server");
  const { orderErrorMessage } = await import("@/lib/orders-shared");
  if (e instanceof OrderError) return orderErrorMessage(e.code);
  return "Could not complete the change. Please try again.";
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const listOrdersFn = createServerFn({ method: "GET" })
  .validator(listOrdersSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("orders.view");
    if (!authz.ok)
      return { success: false as const, error: "Not authorized.", orders: [], total: 0 };

    const { listOrders } = await import("@/lib/server/orders.server");
    try {
      const result = await listOrders({
        actorId: authz.identity.userId,
        status: data.status,
        search: data.search,
        limit: data.limit,
        offset: data.offset,
      });
      return { success: true as const, orders: result.orders, total: result.total };
    } catch {
      return { success: false as const, error: "Could not load orders.", orders: [], total: 0 };
    }
  });

export const adminOrderStatsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("orders.view");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", stats: null };

  const { adminOrderStats } = await import("@/lib/server/orders.server");
  try {
    const stats = await adminOrderStats(authz.identity.userId);
    return { success: true as const, stats };
  } catch {
    return { success: false as const, error: "Could not load dashboard stats.", stats: null };
  }
});

export const getOrderDetailFn = createServerFn({ method: "GET" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("orders.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", order: null };

    const { getOrderDetail } = await import("@/lib/server/orders.server");
    try {
      const order = await getOrderDetail(data.orderId, authz.identity.userId);
      return { success: true as const, order };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e), order: null };
    }
  });

// ── Lifecycle transitions ────────────────────────────────────────────────────

export const transitionOrderFn = createServerFn({ method: "POST" })
  .validator(transitionOrderSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "transitionOrder");
    if (!g.ok) return { success: false as const, error: g.error };

    const { transitionOrder } = await import("@/lib/server/orders.server");
    try {
      const result = await transitionOrder({
        orderId: data.orderId,
        toStatus: data.toStatus,
        actorId: g.actorId,
        reason: data.reason,
        expectedVersion: data.expectedVersion,
        restock: data.restock,
      });
      return { success: true as const, result };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e) };
    }
  });

export const verifyPaymentFn = createServerFn({ method: "POST" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("payments.verify", "verifyPayment");
    if (!g.ok) return { success: false as const, error: g.error };

    const { verifyPayment } = await import("@/lib/server/orders.server");
    try {
      const result = await verifyPayment(data.orderId, g.actorId);
      return { success: true as const, result };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e) };
    }
  });

export const rejectPaymentFn = createServerFn({ method: "POST" })
  .validator(rejectPaymentSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("payments.verify", "rejectPayment");
    if (!g.ok) return { success: false as const, error: g.error };

    const { rejectPayment } = await import("@/lib/server/orders.server");
    try {
      const result = await rejectPayment(data.orderId, data.reason, g.actorId);
      return { success: true as const, result };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e) };
    }
  });

export const confirmCodFn = createServerFn({ method: "POST" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "confirmCod");
    if (!g.ok) return { success: false as const, error: g.error };

    const { confirmCod } = await import("@/lib/server/orders.server");
    try {
      const result = await confirmCod(data.orderId, g.actorId);
      return { success: true as const, result };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e) };
    }
  });

export const cancelOrderFn = createServerFn({ method: "POST" })
  .validator(cancelOrderSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "cancelOrder");
    if (!g.ok) return { success: false as const, error: g.error };

    const { cancelOrder } = await import("@/lib/server/orders.server");
    try {
      const result = await cancelOrder(data.orderId, g.actorId, data.reason);
      return { success: true as const, result };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e) };
    }
  });

export const returnOrderFn = createServerFn({ method: "POST" })
  .validator(returnOrderSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "returnOrder");
    if (!g.ok) return { success: false as const, error: g.error };

    const { returnOrder } = await import("@/lib/server/orders.server");
    try {
      const result = await returnOrder(data.orderId, g.actorId, data.restock ?? false, data.reason);
      return { success: true as const, result };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e) };
    }
  });

// ── Customer-facing reads ────────────────────────────────────────────────────

export const listMyOrdersFn = createServerFn({ method: "GET" })
  .validator(listMyOrdersSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");

    const supabase = createServerSupabaseClient();
    const idn = await getAuthenticatedIdentity({ strict: false, client: supabase });
    if (!idn.ok) {
      return {
        success: false as const,
        error: "Please sign in to view your orders.",
        orders: [],
        total: 0,
      };
    }

    const { listMyOrders } = await import("@/lib/server/orders.server");
    try {
      const res = await listMyOrders(idn.identity.userId, data.limit, data.offset);
      return { success: true as const, orders: res.orders, total: res.total };
    } catch {
      return {
        success: false as const,
        error: "Could not load your orders.",
        orders: [],
        total: 0,
      };
    }
  });

export const getMyOrderFn = createServerFn({ method: "GET" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");

    const supabase = createServerSupabaseClient();
    const idn = await getAuthenticatedIdentity({ strict: false, client: supabase });
    if (!idn.ok) {
      return { success: false as const, error: "Please sign in to view this order.", order: null };
    }

    const { getMyOrder } = await import("@/lib/server/orders.server");
    try {
      const order = await getMyOrder(data.orderId, idn.identity.userId);
      return { success: true as const, order };
    } catch (e) {
      return { success: false as const, error: await messageFromOrderError(e), order: null };
    }
  });

export const trackOrderFn = createServerFn({ method: "POST" })
  .validator(trackOrderSchema)
  .handler(async ({ data }) => {
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin.", result: null };
    }
    const rl = await checkIndependentRateLimit("trackOrder", { ip: getClientIp() });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage(), result: null };

    const { trackOrder } = await import("@/lib/server/orders.server");
    try {
      const result = await trackOrder(data.orderNo, data.token);
      return { success: true as const, result };
    } catch {
      // Any failure (wrong number/token) collapses to one non-oracular message.
      return {
        success: false as const,
        error: "We couldn't find an order matching those details.",
        result: null,
      };
    }
  });
