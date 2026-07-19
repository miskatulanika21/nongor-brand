/**
 * SteadFast booking payload — what we actually POST to /create_order.
 *
 * Every expectation below is transcribed from SteadFast's own API documentation
 * (merchant portal → API → View API Documentation), re-verified 2026-07-19.
 * Do NOT relax one of these to make a change pass: the Stage 5 tests failed
 * precisely because they asserted our invented vocabulary instead of the
 * provider's real contract, which pinned the bug in place rather than catching
 * it.
 *
 * Documented delivery_type: numeric, 0 = home delivery, 1 = Point Delivery /
 * Steadfast Hub Pick Up. There is no 'normal' — that value was invented, and
 * shipped seeded in courier_providers.default_service_type until the migration
 * 20260719120000 corrected it.
 *
 * No network: fetch is stubbed and the request body is inspected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";
import type { CourierBookingRequest } from "@/lib/server/courier/types";

const ENV_SNAPSHOT = { ...process.env };

/** Stub fetch and capture the JSON body of the request that was sent. */
function captureBooking() {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          status: 200,
          message: "Consignment has been created successfully.",
          consignment: {
            consignment_id: 1424107,
            tracking_code: "15BAEB8A",
            status: "in_review",
          },
        }),
      );
    }),
  );
  return calls;
}

const BASE_REQ: CourierBookingRequest = {
  orderNo: "NGR-2026-000025",
  recipientName: "Test Cust",
  recipientPhone: "01700000000",
  recipientAddress: "Rd 1, Dhanmondi, Dhaka",
  district: "Dhaka",
  codAmount: 2470,
};

beforeEach(() => {
  vi.resetModules();
  process.env.STEADFAST_API_KEY = "test-key";
  process.env.STEADFAST_SECRET_KEY = "test-secret";
  process.env.STEADFAST_BASE_URL = "https://portal.packzy.com/api/v1";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ENV_SNAPSHOT };
});

describe("steadfastAdapter.book — required fields", () => {
  it("sends exactly the documented required parameters", async () => {
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.book(BASE_REQ);

    expect(calls[0]).toMatchObject({
      invoice: "NGR-2026-000025",
      recipient_name: "Test Cust",
      recipient_phone: "01700000000",
      recipient_address: "Rd 1, Dhanmondi, Dhaka",
      cod_amount: 2470,
    });
  });
});

describe("steadfastAdapter.book — optional fields", () => {
  it("sends recipient_email and item_description when provided", async () => {
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.book({
      ...BASE_REQ,
      recipientEmail: "cust@example.com",
      itemDescription: "Nongorr order NGR-2026-000025",
    });

    expect(calls[0].recipient_email).toBe("cust@example.com");
    expect(calls[0].item_description).toBe("Nongorr order NGR-2026-000025");
  });

  it("OMITS recipient_email entirely when absent — never sends an empty string", async () => {
    // SteadFast validates recipient_email as an email; "" is a validation error,
    // so an absent address must drop the key rather than send a blank one.
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.book(BASE_REQ);

    expect(calls[0]).not.toHaveProperty("recipient_email");
  });
});

describe("steadfastAdapter.book — delivery_type guard", () => {
  it("sends delivery_type 0 for home delivery", async () => {
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.book({ ...BASE_REQ, serviceType: "0" });

    expect(calls[0].delivery_type).toBe(0);
  });

  it("sends delivery_type 1 for hub pickup", async () => {
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.book({ ...BASE_REQ, serviceType: "1" });

    expect(calls[0].delivery_type).toBe(1);
  });

  it("DROPS the invented 'normal' service type instead of POSTing it", async () => {
    // The regression this guard exists for: courier_providers shipped seeded
    // with 'normal', a value SteadFast has never accepted. Wiring the column
    // through without this check would send delivery_type:"normal" into a
    // numeric field on every booking.
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.book({ ...BASE_REQ, serviceType: "normal" });

    expect(calls[0]).not.toHaveProperty("delivery_type");
    // …and the booking still succeeds on SteadFast's own default.
    expect(r.success).toBe(true);
  });

  it("drops an out-of-range numeric service type", async () => {
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    // 48 is PATHAO's delivery_type. Cross-provider config must never leak.
    await steadfastAdapter.book({ ...BASE_REQ, serviceType: "48" });

    expect(calls[0]).not.toHaveProperty("delivery_type");
  });

  it("omits delivery_type when no service type is configured", async () => {
    const calls = captureBooking();
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.book(BASE_REQ);

    expect(calls[0]).not.toHaveProperty("delivery_type");
  });
});

describe("steadfastAdapter.createReturn", () => {
  it("posts the consignment id and reason to /create_return_request", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        // Documented response: the return-request row itself, no {status:200} envelope.
        return new Response(
          JSON.stringify({
            id: 1,
            user_id: 1,
            consignment_id: 10000042,
            reason: "damaged",
            status: "pending",
          }),
        );
      }),
    );
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.createReturn!("10000042", "damaged");

    expect(calls[0].url).toContain("/create_return_request");
    expect(calls[0].body).toMatchObject({ consignment_id: "10000042", reason: "damaged" });
    expect(r.success).toBe(true);
    expect(r.returnRequestId).toBe("1");
    expect(r.status).toBe("pending");
  });

  it("omits reason when none is given", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ id: 2, status: "pending" }));
      }),
    );
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    await steadfastAdapter.createReturn!("10000042");

    expect(calls[0]).not.toHaveProperty("reason");
  });

  it("does not throw on the bare-text 'Unauthorized Access' reply", async () => {
    // Same non-JSON failure mode as checkStatus — pinned so a return request can
    // never throw into the booking orchestrator mid-flow.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized Access", { status: 401 })),
    );
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.createReturn!("10000042");

    expect(r.success).toBe(false);
    expect(r.returnRequestId).toBeNull();
    expect(r.rawResponse).toMatchObject({ error: "Unauthorized Access", httpStatus: 401 });
  });

  it("treats a 200 without an id as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Consignment not found" }))),
    );
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.createReturn!("nope");

    expect(r.success).toBe(false);
    expect(r.error).toBe("Consignment not found");
  });
});

describe("steadfast reconciliation reads", () => {
  it("parses the documented balance response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 200, current_balance: 12500 }))),
    );
    const { steadfastGetBalance } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastGetBalance();

    expect(r.success).toBe(true);
    expect(r.balance).toBe(12500);
  });

  it("treats a zero balance as a real value, not a missing one", async () => {
    // The doc's own example response is current_balance: 0. A truthiness check
    // here would report "could not read balance" for every settled merchant.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 200, current_balance: 0 }))),
    );
    const { steadfastGetBalance } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastGetBalance();

    expect(r.success).toBe(true);
    expect(r.balance).toBe(0);
  });

  it("does not throw when balance returns bare text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized Access", { status: 401 })),
    );
    const { steadfastGetBalance } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastGetBalance();

    expect(r.success).toBe(false);
    expect(r.balance).toBeNull();
  });

  it("accepts both a bare array and a wrapped {data:[]} payments payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: 1 }, { id: 2 }]))),
    );
    const mod = await import("@/lib/server/courier/steadfast.server");
    const bare = await mod.steadfastListPayments();
    expect(bare.success).toBe(true);
    expect(bare.payments).toHaveLength(2);

    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 3 }] }))),
    );
    const mod2 = await import("@/lib/server/courier/steadfast.server");
    const wrapped = await mod2.steadfastListPayments();
    expect(wrapped.success).toBe(true);
    expect(wrapped.payments).toHaveLength(1);
  });
});
