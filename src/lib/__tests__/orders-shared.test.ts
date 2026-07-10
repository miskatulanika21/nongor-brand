import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  ORDER_LANES,
  ALLOWED_TRANSITIONS,
  canTransition,
  nextActions,
  isOrderStatus,
  orderStatusMeta,
  orderErrorMessage,
  ORDER_ERROR_MESSAGES,
  listOrdersSchema,
  orderIdSchema,
  transitionOrderSchema,
  rejectPaymentSchema,
  cancelOrderSchema,
  returnOrderSchema,
  type OrderStatus,
} from "@/lib/orders-shared";

/**
 * Order status model — TS boundary tests. DB-level guarantees (the state machine
 * itself, grants, optimistic concurrency) are asserted in the SQL tests; here we
 * pin the isomorphic model and its PARITY with api.transition_order's CASE arms.
 */

const UUID = "11111111-1111-1111-1111-111111111111";

describe("status set", () => {
  it("has exactly the 17 statuses, unique", () => {
    expect(ORDER_STATUSES).toHaveLength(17);
    expect(new Set(ORDER_STATUSES).size).toBe(17);
  });

  it("isOrderStatus is a precise guard", () => {
    expect(isOrderStatus("confirmed")).toBe(true);
    expect(isOrderStatus("New Order")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
    expect(isOrderStatus(42)).toBe(false);
  });
});

describe("status metadata", () => {
  it("has a complete, valid entry for every status", () => {
    for (const status of ORDER_STATUSES) {
      const meta = orderStatusMeta(status);
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.customerLabel.length).toBeGreaterThan(0);
      expect(ORDER_LANES).toContain(meta.lane);
    }
  });

  it("has no extra keys beyond the 17 statuses", () => {
    expect(Object.keys(ORDER_STATUS_META).sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe("transition parity with api.transition_order", () => {
  // Hand-mirrored from 20260627210936_order_transition_rpc.sql — if the RPC's
  // CASE arms change, this must change too (and so must ALLOWED_TRANSITIONS).
  const RPC_TABLE: Record<OrderStatus, OrderStatus[]> = {
    pending_payment: ["payment_submitted", "cancelled", "expired"],
    payment_submitted: ["confirmed", "payment_rejected", "cancelled", "expired"],
    payment_rejected: ["payment_submitted", "cancelled", "expired"],
    pending_confirmation: ["confirmed", "cancelled", "expired"],
    confirmed: ["processing", "cancelled"],
    processing: ["ready_to_ship", "cancelled"],
    ready_to_ship: ["courier_booked", "shipped", "cancelled"],
    courier_booked: ["shipped", "delivered", "delivery_failed", "cancelled"],
    shipped: ["delivered", "delivery_failed"],
    delivered: ["completed", "returned"],
    completed: ["returned"],
    delivery_failed: ["shipped", "returned"],
    cancelled: [],
    expired: [],
    returned: ["refund_pending"],
    refund_pending: ["refund_done"],
    refund_done: [],
  };

  it("ALLOWED_TRANSITIONS matches the RPC table exactly", () => {
    for (const status of ORDER_STATUSES) {
      expect([...ALLOWED_TRANSITIONS[status]].sort()).toEqual([...RPC_TABLE[status]].sort());
    }
  });

  it("every transition target is itself a valid status", () => {
    for (const status of ORDER_STATUSES) {
      for (const target of ALLOWED_TRANSITIONS[status]) {
        expect(isOrderStatus(target)).toBe(true);
      }
    }
  });

  it("canTransition agrees with the map", () => {
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("shipped", "cancelled")).toBe(false);
    expect(canTransition("refund_done", "refund_pending")).toBe(false);
  });

  it("terminal states allow no transitions", () => {
    for (const terminal of ["cancelled", "expired", "refund_done"] as const) {
      expect(ALLOWED_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });
});

describe("nextActions", () => {
  it("every generic transition action targets an allowed status", () => {
    for (const status of ORDER_STATUSES) {
      for (const action of nextActions(status)) {
        if (action.rpc === "transition") {
          expect(ALLOWED_TRANSITIONS[status]).toContain(action.toStatus);
        }
      }
    }
  });

  it("action keys are unique within a status", () => {
    for (const status of ORDER_STATUSES) {
      const keys = nextActions(status).map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("payment_submitted offers verify + reject(+reason) + cancel", () => {
    const actions = nextActions("payment_submitted");
    const verify = actions.find((a) => a.rpc === "verify_payment");
    const reject = actions.find((a) => a.rpc === "reject_payment");
    expect(verify).toBeDefined();
    expect(reject?.requiresReason).toBe(true);
    expect(actions.some((a) => a.rpc === "cancel")).toBe(true);
  });

  it("pending_confirmation offers confirm_cod", () => {
    expect(nextActions("pending_confirmation").some((a) => a.rpc === "confirm_cod")).toBe(true);
  });

  it("delivered + completed offer a restock-capable return", () => {
    for (const status of ["delivered", "completed"] as const) {
      const ret = nextActions(status).find((a) => a.rpc === "return");
      expect(ret?.allowsRestock).toBe(true);
    }
  });

  it("terminal states yield no actions", () => {
    for (const terminal of ["cancelled", "expired", "refund_done"] as const) {
      expect(nextActions(terminal)).toHaveLength(0);
    }
  });
});

describe("orderErrorMessage", () => {
  it("maps known codes to safe messages", () => {
    expect(orderErrorMessage("order_not_found")).toContain("no longer exists");
    expect(orderErrorMessage("version_conflict")).toContain("updated by someone else");
    expect(orderErrorMessage("invalid_transition")).toContain("isn't allowed");
    expect(orderErrorMessage("actor_not_authorized")).toContain("not authorized");
    expect(orderErrorMessage("payment_not_found")).toContain("payment record");
  });

  it("falls back for unknown / nullish codes", () => {
    expect(orderErrorMessage("internal_error")).toContain("try again");
    expect(orderErrorMessage("whatever")).toContain("try again");
    expect(orderErrorMessage(undefined)).toContain("try again");
    expect(orderErrorMessage(null)).toContain("try again");
  });

  it("never leaks raw SQL for any known code", () => {
    for (const code of Object.keys(ORDER_ERROR_MESSAGES)) {
      const msg = orderErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("SQLERRM");
      expect(msg).not.toContain("RAISE");
      expect(msg).not.toContain("->");
    }
  });
});

describe("server-fn validators", () => {
  it("listOrdersSchema accepts optional filters and rejects bad enum/bounds", () => {
    expect(listOrdersSchema.safeParse({}).success).toBe(true);
    expect(listOrdersSchema.safeParse({ status: "confirmed", limit: 50, offset: 0 }).success).toBe(
      true,
    );
    expect(listOrdersSchema.safeParse({ status: "New Order" }).success).toBe(false);
    expect(listOrdersSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listOrdersSchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(listOrdersSchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("orderIdSchema requires a uuid", () => {
    expect(orderIdSchema.safeParse({ orderId: UUID }).success).toBe(true);
    expect(orderIdSchema.safeParse({ orderId: "nope" }).success).toBe(false);
  });

  it("transitionOrderSchema validates target + optional version/reason/restock", () => {
    expect(transitionOrderSchema.safeParse({ orderId: UUID, toStatus: "shipped" }).success).toBe(
      true,
    );
    expect(
      transitionOrderSchema.safeParse({
        orderId: UUID,
        toStatus: "returned",
        expectedVersion: 3,
        restock: true,
        reason: "damaged",
      }).success,
    ).toBe(true);
    expect(transitionOrderSchema.safeParse({ orderId: UUID, toStatus: "bogus" }).success).toBe(
      false,
    );
    expect(
      transitionOrderSchema.safeParse({ orderId: UUID, toStatus: "shipped", expectedVersion: -1 })
        .success,
    ).toBe(false);
  });

  it("rejectPaymentSchema requires a reason; cancel/return reasons are optional", () => {
    expect(rejectPaymentSchema.safeParse({ orderId: UUID, reason: "wrong trx" }).success).toBe(
      true,
    );
    expect(rejectPaymentSchema.safeParse({ orderId: UUID }).success).toBe(false);
    expect(rejectPaymentSchema.safeParse({ orderId: UUID, reason: "" }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ orderId: UUID }).success).toBe(true);
    expect(returnOrderSchema.safeParse({ orderId: UUID, restock: true }).success).toBe(true);
  });
});

describe("orders API + server module wiring", () => {
  it("orders.api exposes the eight server functions", async () => {
    const api = await import("@/lib/orders.api");
    for (const fn of [
      "listOrdersFn",
      "getOrderDetailFn",
      "transitionOrderFn",
      "verifyPaymentFn",
      "rejectPaymentFn",
      "confirmCodFn",
      "cancelOrderFn",
      "returnOrderFn",
    ]) {
      expect(typeof (api as Record<string, unknown>)[fn]).toBe("function");
    }
  });

  it("OrderError carries a code mapped by orderErrorMessage", async () => {
    const { OrderError } = await import("@/lib/server/orders.server");
    const e = new OrderError("version_conflict");
    expect(e).toBeInstanceOf(Error);
    expect(orderErrorMessage(e.code)).toContain("updated by someone else");
  });
});

describe("customer progress timeline", () => {
  it("maps every status to a step or an exception", async () => {
    const { customerProgress, CUSTOMER_STEPS } = await import("@/lib/orders-shared");
    for (const status of ORDER_STATUSES) {
      const p = customerProgress(status);
      if (p.exception) {
        expect(p.stepIndex).toBe(-1);
      } else {
        expect(p.stepIndex).toBeGreaterThanOrEqual(0);
        expect(p.stepIndex).toBeLessThan(CUSTOMER_STEPS.length);
      }
    }
  });

  it("advances monotonically across the happy path", async () => {
    const { customerProgress } = await import("@/lib/orders-shared");
    const order: OrderStatus[] = [
      "pending_payment",
      "payment_submitted",
      "confirmed",
      "processing",
      "courier_booked",
      "shipped",
      "delivered",
    ];
    const idx = order.map((s) => customerProgress(s).stepIndex);
    expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("flags off-path states as exceptions", async () => {
    const { customerProgress } = await import("@/lib/orders-shared");
    for (const s of [
      "payment_rejected",
      "cancelled",
      "expired",
      "returned",
      "refund_done",
    ] as const) {
      expect(customerProgress(s).exception).toBe(true);
    }
  });
});

describe("customer read validators + wiring", () => {
  it("listMyOrdersSchema + trackOrderSchema validate bounds", async () => {
    const { listMyOrdersSchema, trackOrderSchema } = await import("@/lib/orders-shared");
    expect(listMyOrdersSchema.safeParse({}).success).toBe(true);
    expect(listMyOrdersSchema.safeParse({ limit: 99 }).success).toBe(false);
    expect(trackOrderSchema.safeParse({ orderNo: "NGR-2026-000123", token: "tok" }).success).toBe(
      true,
    );
    expect(trackOrderSchema.safeParse({ orderNo: "", token: "tok" }).success).toBe(false);
    expect(trackOrderSchema.safeParse({ orderNo: "x", token: "" }).success).toBe(false);
  });

  it("orders.api exposes the customer read fns", async () => {
    const api = await import("@/lib/orders.api");
    for (const fn of ["listMyOrdersFn", "getMyOrderFn", "trackOrderFn"]) {
      expect(typeof (api as Record<string, unknown>)[fn]).toBe("function");
    }
  });

  it("defines a trackOrder rate-limit policy", async () => {
    const { RATE_LIMITS } = await import("@/lib/server/rate-limit.server");
    expect(RATE_LIMITS.trackOrder).toBeDefined();
    expect(RATE_LIMITS.trackOrder.limit).toBeGreaterThan(0);
  });
});

describe("guest-order claim (P7)", () => {
  it("claimGuestOrderSchema takes the same capability pair as trackOrderSchema", async () => {
    const { claimGuestOrderSchema } = await import("@/lib/orders-shared");
    expect(
      claimGuestOrderSchema.safeParse({ orderNo: "NGR-2026-000123", token: "tok" }).success,
    ).toBe(true);
    expect(claimGuestOrderSchema.safeParse({ orderNo: "", token: "tok" }).success).toBe(false);
    expect(claimGuestOrderSchema.safeParse({ orderNo: "x", token: "" }).success).toBe(false);
  });

  it("maps order_not_claimable to a safe message and keeps wrong-token non-oracular", () => {
    // Cross-account claims get an explicit message; a wrong token must NOT get
    // its own code — the RPC collapses it into order_not_found so the endpoint
    // can't be used as a token oracle.
    expect(orderErrorMessage("order_not_claimable")).toContain("already linked");
    expect(ORDER_ERROR_MESSAGES).not.toHaveProperty("invalid_token");
    expect(ORDER_ERROR_MESSAGES).not.toHaveProperty("wrong_token");
  });

  it("orders.api exposes claimGuestOrderFn", async () => {
    const api = await import("@/lib/orders.api");
    expect(typeof (api as Record<string, unknown>).claimGuestOrderFn).toBe("function");
  });
});
