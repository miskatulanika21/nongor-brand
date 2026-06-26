import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the demo-commerce flag so the gating is deterministic regardless of the
// test runner's import.meta.env.
vi.mock("@/lib/checkout-mode", () => ({ isDemoCommerceEnabled: vi.fn() }));

import { isDemoCommerceEnabled } from "@/lib/checkout-mode";
import { buildOrderList } from "@/lib/order-ui";

const mockDemo = isDemoCommerceEnabled as unknown as ReturnType<typeof vi.fn>;

describe("buildOrderList demo gating (F-03 / F-04)", () => {
  beforeEach(() => mockDemo.mockReset());

  it("excludes seeded demo orders when demo commerce is OFF (production)", () => {
    mockDemo.mockReturnValue(false);
    // No fabricated demo orders may leak into a real customer's order list.
    expect(buildOrderList([])).toEqual([]);
  });

  it("includes seeded demo orders only when demo commerce is ON", () => {
    mockDemo.mockReturnValue(true);
    const list = buildOrderList([]);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((o) => o.source === "demo")).toBe(true);
  });

  it("always surfaces real device orders regardless of mode", () => {
    const device = [
      {
        id: "NGR-123",
        date: new Date().toISOString(),
        status: "Payment Pending",
        customerName: "A",
        phone: "01700000000",
        district: "Dhaka",
        address: "x",
        items: [],
        subtotal: 0,
        shipping: 0,
        discount: 0,
        total: 0,
        trxId: "",
        paymentStatus: "Pending",
        source: "device",
      },
    ] as Parameters<typeof buildOrderList>[0];
    mockDemo.mockReturnValue(false);
    const list = buildOrderList(device);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("NGR-123");
  });
});
