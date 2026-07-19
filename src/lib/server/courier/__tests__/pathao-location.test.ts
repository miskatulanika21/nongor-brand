/**
 * Pathao booking payload — explicit city/zone vs auto-address.
 *
 * The whole point of syncing Pathao's City → Zone → Area tree is to stop
 * depending on their parser reading a free-text Bangladeshi address. A
 * mis-parse does not error: it routes the parcel to the wrong hub, and on COD
 * that comes back as a return fee we pay.
 *
 * These pin the fallback contract, which matters as much as the happy path: a
 * missing id must degrade to auto-address, never to a broken or half-specified
 * booking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";
import type { CourierBookingRequest } from "@/lib/server/courier/types";

const ENV_SNAPSHOT = { ...process.env };

function capture() {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("issue-token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      }
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ type: "success", data: { consignment_id: "C1" } }));
    }),
  );
  return calls;
}

const BASE: CourierBookingRequest = {
  orderNo: "NGR-2026-000029",
  recipientName: "Test Cust",
  recipientPhone: "01700000000",
  recipientAddress: "House 12, Road 27, Dhanmondi",
  district: "Dhaka",
  codAmount: 4780,
};

beforeEach(() => {
  vi.resetModules();
  process.env.PATHAO_SANDBOX_ENABLED = "false";
  process.env.PATHAO_CLIENT_ID = "id";
  process.env.PATHAO_CLIENT_SECRET = "secret";
  process.env.PATHAO_USERNAME = "u@example.com";
  process.env.PATHAO_PASSWORD = "p";
  process.env.PATHAO_STORE_ID = "410847";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ENV_SNAPSHOT };
});

describe("pathaoAdapter.book — explicit location", () => {
  it("sends recipient_city and recipient_zone when both are resolved", async () => {
    const calls = capture();
    const { pathaoAdapter } = await import("@/lib/server/courier/pathao.server");

    await pathaoAdapter.book({
      ...BASE,
      recipientCityId: 1,
      recipientZoneId: 52,
      recipientAreaId: 9,
    });

    expect(calls[0]).toMatchObject({
      recipient_city: 1,
      recipient_zone: 52,
      recipient_area: 9,
    });
  });

  it("sends city and zone without area when no area was chosen", async () => {
    const calls = capture();
    const { pathaoAdapter } = await import("@/lib/server/courier/pathao.server");

    await pathaoAdapter.book({ ...BASE, recipientCityId: 1, recipientZoneId: 52 });

    expect(calls[0].recipient_city).toBe(1);
    expect(calls[0].recipient_zone).toBe(52);
    expect(calls[0]).not.toHaveProperty("recipient_area");
  });
});

describe("pathaoAdapter.book — auto-address fallback", () => {
  it("omits all location ids when none are resolved", async () => {
    const calls = capture();
    const { pathaoAdapter } = await import("@/lib/server/courier/pathao.server");

    await pathaoAdapter.book(BASE);

    expect(calls[0]).not.toHaveProperty("recipient_city");
    expect(calls[0]).not.toHaveProperty("recipient_zone");
    expect(calls[0]).not.toHaveProperty("recipient_area");
    // …and the address is still there for Pathao to parse.
    expect(calls[0].recipient_address).toBe("House 12, Road 27, Dhanmondi");
  });

  it("omits a zone that arrives without its city", async () => {
    // Pathao rejects a zone without its city. A half-resolved location must
    // fall back to auto-address rather than send an invalid pair.
    const calls = capture();
    const { pathaoAdapter } = await import("@/lib/server/courier/pathao.server");

    await pathaoAdapter.book({ ...BASE, recipientZoneId: 52 });

    expect(calls[0]).not.toHaveProperty("recipient_zone");
    expect(calls[0]).not.toHaveProperty("recipient_city");
  });

  it("omits an area that arrives without a zone", async () => {
    const calls = capture();
    const { pathaoAdapter } = await import("@/lib/server/courier/pathao.server");

    await pathaoAdapter.book({ ...BASE, recipientCityId: 1, recipientAreaId: 9 });

    expect(calls[0]).not.toHaveProperty("recipient_area");
    expect(calls[0]).not.toHaveProperty("recipient_city");
  });
});
