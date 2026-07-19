/**
 * Courier admin API — createServerFn handlers for courier booking/tracking.
 *
 * Reads require `courier.view`; writes go through guardAdminWrite with
 * `courier.manage` permission (CSRF + permission + MFA step-up + rate limit +
 * denial audit). Using the granular courier permissions (not orders.*) keeps the
 * API in lockstep with the nav link (also courier.view) and lets courier work be
 * delegated without granting full order management. Delegates to the service-role
 * repository (courier.server.ts), which calls the REVOKE-d api.* courier RPCs.
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
  createReturnSchema,
  courierAccountSchema,
  courierPaymentSchema,
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
    const authz = await requirePermission("courier.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", shipments: [] };

    const { listShipments } = await import("@/lib/server/courier.server");
    try {
      const shipments = (await listShipments(authz.identity.userId, data.orderId)) as JsonRow[];
      return { success: true as const, shipments };
    } catch (err) {
      // Never swallow silently: a bare `catch {}` here hid a broken
      // api.list_shipments (row_to_jsonb, a function that does not exist) for
      // the entire life of Stage 5 — the page just rendered every booked order
      // as having no shipments, with nothing in any log to explain it.
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "listShipments failed", {
        orderId: data.orderId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return { success: false as const, error: "Could not load shipments.", shipments: [] };
    }
  });

export const listCourierProvidersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("courier.view");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", providers: [] };

  const { listCourierProviders } = await import("@/lib/server/courier.server");
  try {
    const providers = (await listCourierProviders(authz.identity.userId)) as JsonRow[];
    return { success: true as const, providers };
  } catch (err) {
    const { safeServerLog } = await import("@/lib/server/security.server");
    safeServerLog("error", "listCourierProviders failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { success: false as const, error: "Could not load courier providers.", providers: [] };
  }
});

// ── COD reconciliation reads ─────────────────────────────────────────────────
//
// `courier.view`, not `courier.manage`: these only READ money data from the
// courier. Writing it onto a shipment still goes through updateReconciliationFn,
// which requires manage — so seeing what you are owed and asserting it are
// deliberately separate permissions.

export const courierBalanceFn = createServerFn({ method: "GET" })
  .validator(courierAccountSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("courier.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", balance: null };

    const { getCourierBalance } = await import("@/lib/server/courier.server");
    try {
      return await getCourierBalance(data.provider);
    } catch (e) {
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "courierBalance failed", {
        provider: data.provider,
        error: e instanceof Error ? e.message : "unknown",
      });
      return { success: false as const, error: await messageFromCourierError(e), balance: null };
    }
  });

export const courierPaymentsFn = createServerFn({ method: "GET" })
  .validator(courierAccountSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("courier.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", payments: [] };

    const { listCourierPayments } = await import("@/lib/server/courier.server");
    try {
      // Cast to the JSON-safe row shape: server fns must return values the
      // server/client boundary can serialize, and `unknown` is rejected.
      const r = await listCourierPayments(data.provider);
      return { ...r, payments: r.payments as JsonRow[] };
    } catch (e) {
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "courierPayments failed", {
        provider: data.provider,
        error: e instanceof Error ? e.message : "unknown",
      });
      return { success: false as const, error: await messageFromCourierError(e), payments: [] };
    }
  });

export const courierPaymentDetailFn = createServerFn({ method: "GET" })
  .validator(courierPaymentSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("courier.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", payment: null };

    const { getCourierPayment } = await import("@/lib/server/courier.server");
    try {
      const r = await getCourierPayment(data.provider, data.paymentId);
      return { ...r, payment: (r.payment ?? null) as JsonRow | null };
    } catch (e) {
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "courierPaymentDetail failed", {
        provider: data.provider,
        error: e instanceof Error ? e.message : "unknown",
      });
      return { success: false as const, error: await messageFromCourierError(e), payment: null };
    }
  });

// ── Booking ──────────────────────────────────────────────────────────────────

export const bookCourierFn = createServerFn({ method: "POST" })
  .validator(bookCourierSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("courier.manage", "bookCourier", {
      rateLimitAction: "courierWrite",
    });
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

/**
 * Raise a return leg for a delivered/failed forward shipment.
 *
 * `courier.manage` + courierWrite rate limit, same as booking: this moves a real
 * parcel and costs a return fee, so it is a write in every sense.
 */
export const createReturnFn = createServerFn({ method: "POST" })
  .validator(createReturnSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("courier.manage", "createReturn", {
      rateLimitAction: "courierWrite",
    });
    if (!g.ok) return { success: false as const, error: g.error };

    const { createReturnShipment } = await import("@/lib/server/courier.server");
    try {
      const result = await createReturnShipment(g.actorId, data.parentShipmentId, data.reason);
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
        returnRequestId: result.returnRequestId,
        manual: result.manual,
      };
    } catch (e) {
      return { success: false as const, error: await messageFromCourierError(e) };
    }
  });

export const cancelShipmentFn = createServerFn({ method: "POST" })
  .validator(cancelShipmentSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("courier.manage", "cancelShipment", {
      rateLimitAction: "courierWrite",
    });
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
    const g = await guardAdminWrite("courier.manage", "resolveStaleAttempt", {
      rateLimitAction: "courierWrite",
    });
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
    const g = await guardAdminWrite("courier.manage", "pollShipmentStatus", {
      rateLimitAction: "courierWrite",
    });
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
    const g = await guardAdminWrite("courier.manage", "updateReconciliation", {
      rateLimitAction: "courierWrite",
    });
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
