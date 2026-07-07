/**
 * Tests for courier-shared.ts — isomorphic courier integration utilities.
 *
 * Covers: status mapping, label resolution, COD computation, customer DTO
 * building, and Zod schema validation.
 */
import { describe, expect, it } from "vitest";

describe("courier-shared", () => {
  // Lazy import to match the project pattern.
  async function load() {
    return import("@/lib/courier-shared");
  }

  // ── mapCourierStatusToInternal ──────────────────────────────────────────

  describe("mapCourierStatusToInternal", () => {
    it("maps SteadFast delivered → delivered", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("steadfast", "delivered")).toBe("delivered");
    });

    it("maps SteadFast in_transit → in_transit", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("steadfast", "in_transit")).toBe("in_transit");
    });

    it("maps SteadFast cancelled → returned_to_merchant", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("steadfast", "cancelled")).toBe("returned_to_merchant");
    });

    it("returns null for unknown SteadFast status", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("steadfast", "xyz_weird")).toBeNull();
    });

    it("maps Pathao Picked Up → picked_up", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("pathao", "Picked Up")).toBe("picked_up");
    });

    it("maps Pathao Out for Delivery → out_for_delivery", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("pathao", "Out for Delivery")).toBe("out_for_delivery");
    });

    it("maps Pathao Delivered → delivered", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("pathao", "Delivered")).toBe("delivered");
    });

    it("maps Pathao Return → returned_to_merchant", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("pathao", "Return")).toBe("returned_to_merchant");
    });

    it("returns null for unknown provider", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("dhl", "delivered")).toBeNull();
    });

    it("normalizes whitespace and casing", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("steadfast", "In Transit")).toBe("in_transit");
      expect(mapCourierStatusToInternal("steadfast", "IN-TRANSIT")).toBe("in_transit");
    });
  });

  // ── courierStatusLabel ─────────────────────────────────────────────────

  describe("courierStatusLabel", () => {
    it("returns human label for known SteadFast status", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("steadfast", "in_transit")).toBe("In transit");
      expect(courierStatusLabel("steadfast", "delivered")).toBe("Delivered");
    });

    it("returns human label for known Pathao status", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("pathao", "Out for Delivery")).toBe("Out for delivery");
    });

    it("returns raw status for unknown status", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("steadfast", "custom_thing")).toBe("custom_thing");
    });

    it("returns raw status for unknown provider", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("fedex", "shipped")).toBe("shipped");
    });
  });

  // ── computeCodAmount ───────────────────────────────────────────────────

  describe("computeCodAmount", () => {
    it("COD with no prior payment → full amount", async () => {
      const { computeCodAmount } = await load();
      const r = computeCodAmount("cod", "pending", 1500);
      expect(r.mode).toBe("cod");
      expect(r.codAmount).toBe(1500);
    });

    it("COD with partial payment → partial_cod", async () => {
      const { computeCodAmount } = await load();
      const r = computeCodAmount("cod", "pending", 1500, 500);
      expect(r.mode).toBe("partial_cod");
      expect(r.codAmount).toBe(1000);
    });

    it("bKash verified → prepaid, 0 COD", async () => {
      const { computeCodAmount } = await load();
      const r = computeCodAmount("bkash", "verified", 2000);
      expect(r.mode).toBe("prepaid");
      expect(r.codAmount).toBe(0);
    });

    it("bKash not verified, no payment → partial_cod with full due", async () => {
      const { computeCodAmount } = await load();
      const r = computeCodAmount("bkash", "pending", 2000, 0);
      expect(r.mode).toBe("partial_cod");
      expect(r.codAmount).toBe(2000);
    });

    it("never returns negative COD", async () => {
      const { computeCodAmount } = await load();
      const r = computeCodAmount("cod", "pending", 100, 500);
      expect(r.codAmount).toBe(0);
    });
  });

  // ── toCustomerShipmentInfo ─────────────────────────────────────────────

  describe("toCustomerShipmentInfo", () => {
    it("builds tracking URL from template", async () => {
      const { toCustomerShipmentInfo } = await load();
      const info = toCustomerShipmentInfo(
        "SteadFast",
        "TRK123",
        "https://steadfast.com.bd/t/{code}",
        "delivered",
        "steadfast",
      );
      expect(info.provider).toBe("SteadFast");
      expect(info.trackingCode).toBe("TRK123");
      expect(info.trackingUrl).toBe("https://steadfast.com.bd/t/TRK123");
      expect(info.friendlyStatus).toBe("Delivered");
    });

    it("returns null tracking URL when no template", async () => {
      const { toCustomerShipmentInfo } = await load();
      const info = toCustomerShipmentInfo("Manual", "M-001", null, "in_transit", "manual");
      expect(info.trackingUrl).toBeNull();
      expect(info.trackingCode).toBe("M-001");
    });

    it("returns null tracking URL when no tracking code", async () => {
      const { toCustomerShipmentInfo } = await load();
      const info = toCustomerShipmentInfo(
        "SteadFast",
        null,
        "https://steadfast.com.bd/t/{code}",
        null,
        "steadfast",
      );
      expect(info.trackingUrl).toBeNull();
    });
  });

  // ── Zod schemas ────────────────────────────────────────────────────────

  describe("schemas", () => {
    it("bookCourierSchema validates a valid booking request", async () => {
      const { bookCourierSchema } = await load();
      const r = bookCourierSchema.safeParse({
        orderId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        provider: "steadfast",
      });
      expect(r.success).toBe(true);
    });

    it("bookCourierSchema rejects missing orderId", async () => {
      const { bookCourierSchema } = await load();
      const r = bookCourierSchema.safeParse({ provider: "steadfast" });
      expect(r.success).toBe(false);
    });

    it("cancelShipmentSchema validates valid cancel", async () => {
      const { cancelShipmentSchema } = await load();
      const r = cancelShipmentSchema.safeParse({
        shipmentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });
      expect(r.success).toBe(true);
    });

    it("listShipmentsSchema validates valid list request", async () => {
      const { listShipmentsSchema } = await load();
      const r = listShipmentsSchema.safeParse({
        orderId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });
      expect(r.success).toBe(true);
    });
  });

  // ── Constants ──────────────────────────────────────────────────────────

  describe("constants", () => {
    it("COURIER_PROVIDERS has 3 providers", async () => {
      const { COURIER_PROVIDERS } = await load();
      expect(COURIER_PROVIDERS).toEqual(["steadfast", "pathao", "manual"]);
    });

    it("BOOKING_STATUSES has 3 statuses", async () => {
      const { BOOKING_STATUSES } = await load();
      expect(BOOKING_STATUSES).toEqual(["pending", "success", "failed"]);
    });

    it("SHIPMENT_KINDS has 3 kinds", async () => {
      const { SHIPMENT_KINDS } = await load();
      expect(SHIPMENT_KINDS).toEqual(["forward", "return", "exchange"]);
    });
  });
});
