import { describe, it, expect } from "vitest";
import {
  listCustomersSchema,
  customerTags,
  VIP_MIN_SPENT,
  VIP_MIN_ORDERS,
  REPEAT_MIN_ORDERS,
  HIGH_RISK_MIN_RETURNS,
  type AdminCustomer,
} from "@/lib/customers-shared";

/**
 * Admin customers directory (P8) — TS boundary tests. The aggregates
 * themselves (staff gate, counting rules, search, pagination) are asserted at
 * the DB in stage4_db.test.sql §18; here we pin the validator and the derived
 * tag thresholds, which live only in the app.
 */

const base: AdminCustomer = {
  userId: "11111111-1111-1111-1111-111111111111",
  name: "Test Customer",
  phone: "01711111111",
  email: "t@example.com",
  joinedAt: "2026-01-01T00:00:00Z",
  ordersCount: 0,
  lifetimeSpent: 0,
  returnsCount: 0,
  lastOrderAt: null,
  hasCustomSize: false,
};

describe("listCustomersSchema", () => {
  it("accepts empty input and full filters", () => {
    expect(listCustomersSchema.safeParse({}).success).toBe(true);
    expect(
      listCustomersSchema.safeParse({ search: "rumana", limit: 100, offset: 40 }).success,
    ).toBe(true);
  });

  it("rejects out-of-bounds limit/offset and blank search", () => {
    expect(listCustomersSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listCustomersSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listCustomersSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(listCustomersSchema.safeParse({ search: "   " }).success).toBe(false);
    expect(listCustomersSchema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
  });
});

describe("customerTags", () => {
  it("a brand-new account has no tags", () => {
    expect(customerTags(base)).toEqual([]);
  });

  it("repeat kicks in at the threshold; VIP subsumes it", () => {
    expect(customerTags({ ...base, ordersCount: REPEAT_MIN_ORDERS - 1 })).toEqual([]);
    expect(customerTags({ ...base, ordersCount: REPEAT_MIN_ORDERS })).toEqual(["Repeat Customer"]);
    expect(customerTags({ ...base, ordersCount: VIP_MIN_ORDERS })).toEqual(["VIP"]);
    expect(customerTags({ ...base, ordersCount: VIP_MIN_ORDERS })).not.toContain("Repeat Customer");
  });

  it("VIP triggers on spend alone", () => {
    expect(customerTags({ ...base, ordersCount: 1, lifetimeSpent: VIP_MIN_SPENT })).toEqual([
      "VIP",
    ]);
    expect(customerTags({ ...base, ordersCount: 1, lifetimeSpent: VIP_MIN_SPENT - 1 })).toEqual([]);
  });

  it("high risk and custom size stack with loyalty tags", () => {
    const tags = customerTags({
      ...base,
      ordersCount: VIP_MIN_ORDERS,
      returnsCount: HIGH_RISK_MIN_RETURNS,
      hasCustomSize: true,
    });
    expect(tags).toEqual(["VIP", "High Risk", "Custom Size"]);
    expect(customerTags({ ...base, returnsCount: HIGH_RISK_MIN_RETURNS - 1 })).toEqual([]);
  });
});

describe("customers API wiring", () => {
  it("customers.api exposes listCustomersFn", async () => {
    const api = await import("@/lib/customers.api");
    expect(typeof (api as Record<string, unknown>).listCustomersFn).toBe("function");
  });
});
