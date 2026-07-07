/**
 * Courier admin API — createServerFn handlers for courier booking/tracking.
 *
 * Reads require `orders.view`; writes go through guardAdminWrite with
 * `orders.manage` permission (CSRF + permission + MFA step-up + rate limit +
 * denial audit). Delegates to the service-role repository (courier.server.ts),
 * which calls the REVOKE-d api.* courier RPCs.
 *
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as orders.api.ts / catalog-admin.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import {
  bookCourierSchema,
  cancelShipmentSchema,
  resolveStaleSchema,
  pollStatusSchema,
  reconciliationSchema,
  listShipmentsSchema,
  courierErrorMessage,
} from "@/lib/courier-shared";

/** Map any thrown courier error to a safe message via the stable code. */
async function messageFromCourierError(e: unknown): Promise<string> {
  const { CourierError } = await import("@/lib/server/courier.server");
  const { courierErrorMessage: errMsg } = await import("@/lib/courier-shared");
  if (e instanceof CourierError) return errMsg(e.code);
  return "Could not complete the courier operation. Please try again.";
}

/** JSON-safe row shape for serialization across the server/client boundary. */
interface JsonRow {
  [key: string]: string | number | boolean | null | JsonRow[] | JsonRow;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const listShipmentsFn = createServerFn({ method: "GET" })
  .validator(listShipmentsSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("orders.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", shipments: [] };

    const { listShipments } = await import("@/lib/server/courier.server");
    try {
      const shipments = (await listShipments(authz.identity.userId, data.orderId)) as JsonRow[];
      return { success: true as const, shipments };
    } catch {
      return { success: false as const, error: "Could not load shipments.", shipments: [] };
    }
  });

export const listCourierProvidersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("orders.view");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", providers: [] };

  const { listCourierProviders } = await import("@/lib/server/courier.server");
  try {
    const providers = (await listCourierProviders(authz.identity.userId)) as JsonRow[];
    return { success: true as const, providers };
  } catch {
    return { success: false as const, error: "Could not load courier providers.", providers: [] };
  }
});

// ── Booking ──────────────────────────────────────────────────────────────────

export const bookCourierFn = createServerFn({ method: "POST" })
  .validator(bookCourierSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "bookCourier");
    if (!g.ok) return { success: false as const, error: g.error };

    // Fetch the order to get booking data
    const { getOrderForBooking } = await import("@/lib/server/orders.server");
    const { bookShipment } = await import("@/lib/server/courier.server");
    try {
      const order = await getOrderForBooking(data.orderId, g.actorId);
      const result = await bookShipment({
        actorId: g.actorId,
        orderId: data.orderId,
        provider: data.provider,
        trackingCode: data.trackingCode,
        note: data.note,
        order,
      });
      if (!result.success) {
        return {
          success: false as const,
          error: result.error ?? courierErrorMessage(null),
          shipmentId: result.shipmentId,
        };
      }
      return {
        success: true as const,
        shipmentId: result.shipmentId,
        trackingCode: result.trackingCode,
      };
    } catch (e) {
      return { success: false as const, error: await messageFromCourierError(e) };
    }
  });

// ── Cancel ────────────────────────────────────────────────────────────────────

export const cancelShipmentFn = createServerFn({ method: "POST" })
  .validator(cancelShipmentSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "cancelShipment");
    if (!g.ok) return { success: false as const, error: g.error };

    const { cancelShipment } = await import("@/lib/server/courier.server");
    try {
      await cancelShipment(g.actorId, data.shipmentId, data.reason);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromCourierError(e) };
    }
  });

// ── Stale recovery ───────────────────────────────────────────────────────────

export const resolveStaleAttemptFn = createServerFn({ method: "POST" })
  .validator(resolveStaleSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "resolveStaleAttempt");
    if (!g.ok) return { success: false as const, error: g.error };

    const { resolveStaleAttempt } = await import("@/lib/server/courier.server");
    try {
      await resolveStaleAttempt(g.actorId, data.shipmentId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromCourierError(e) };
    }
  });

// ── Poll status ──────────────────────────────────────────────────────────────

export const pollShipmentStatusFn = createServerFn({ method: "POST" })
  .validator(pollStatusSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "pollShipmentStatus");
    if (!g.ok) return { success: false as const, error: g.error };

    const { pollShipmentStatus } = await import("@/lib/server/courier.server");
    try {
      const { status } = await pollShipmentStatus(g.actorId, data.shipmentId);
      return { success: true as const, status };
    } catch (e) {
      return { success: false as const, error: await messageFromCourierError(e) };
    }
  });

// ── Reconciliation ───────────────────────────────────────────────────────────

export const updateReconciliationFn = createServerFn({ method: "POST" })
  .validator(reconciliationSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("orders.manage", "updateReconciliation");
    if (!g.ok) return { success: false as const, error: g.error };

    const { updateReconciliation } = await import("@/lib/server/courier.server");
    try {
      await updateReconciliation(g.actorId, data.shipmentId, {
        courierFee: data.courierFee,
        returnFee: data.returnFee,
        codCollectedAt: data.codCollectedAt,
        codSettledAt: data.codSettledAt,
        settlementRef: data.settlementRef,
      });
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromCourierError(e) };
    }
  });
