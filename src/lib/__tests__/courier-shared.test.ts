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
    // Every expectation below is transcribed from the providers' published docs.
    // If one fails, check the doc before changing the assertion — these exist to
    // stop the vocabulary drifting back to plausible-sounding invented values.

    // ── SteadFast ────────────────────────────────────────────────────────
    // Source: portal.packzy.com API doc, "Delivery Statuses" table (11 values),
    // and the merchant panel's webhook Response Documentation (5 of them).

    it("maps every documented SteadFast delivery status", async () => {
      const { mapCourierStatusToInternal } = await load();
      const m = (s: string) => mapCourierStatusToInternal("steadfast", s);

      expect(m("pending")).toBe("pending");
      expect(m("in_review")).toBe("in_review");
      expect(m("hold")).toBe("on_hold");
      expect(m("delivered")).toBe("delivered");
      // Balance is added for a partial delivery, so it counts as delivered.
      expect(m("partial_delivered")).toBe("delivered");
      expect(m("cancelled")).toBe("returned_to_merchant");
      expect(m("unknown")).toBe("unknown");
    });

    it("records SteadFast *_approval_pending without transitioning the order", async () => {
      const { mapCourierStatusToInternal } = await load();
      const m = (s: string) => mapCourierStatusToInternal("steadfast", s);

      // Parcel is delivered/cancelled but the balance is not settled and the
      // outcome can still flip during review — record, never transition. None of
      // these map to a transition key (picked_up/in_transit/out_for_delivery/
      // delivered/failed) that api.update_shipment_status acts on.
      expect(m("delivered_approval_pending")).toBe("delivered_approval_pending");
      expect(m("partial_delivered_approval_pending")).toBe("partial_delivered_approval_pending");
      expect(m("cancelled_approval_pending")).toBe("cancelled_approval_pending");
      expect(m("unknown_approval_pending")).toBe("unknown_approval_pending");
    });

    it("accepts the capitalised spelling the SteadFast webhook example uses", async () => {
      const { mapCourierStatusToInternal } = await load();
      // Panel doc's example payload sends "Delivered" though the table lists
      // lowercase snake_case.
      expect(mapCourierStatusToInternal("steadfast", "Delivered")).toBe("delivered");
      expect(mapCourierStatusToInternal("steadfast", "Partial Delivered")).toBe("delivered");
    });

    it("does not invent SteadFast statuses the provider never sends", async () => {
      const { mapCourierStatusToInternal } = await load();
      // in_transit and delivered_to_warehouse were guesses — they appear nowhere
      // in SteadFast's docs. SteadFast has no transit signal at all: parcels go
      // in_review → delivered, which is why the RPC allows courier_booked →
      // delivered directly.
      expect(mapCourierStatusToInternal("steadfast", "in_transit")).toBeNull();
      expect(mapCourierStatusToInternal("steadfast", "delivered_to_warehouse")).toBeNull();
      expect(mapCourierStatusToInternal("steadfast", "xyz_weird")).toBeNull();
    });

    // ── Pathao ───────────────────────────────────────────────────────────
    // Source: merchant.pathao.com/courier/developer-api → Webhook Integration.
    // The status is the payload's `event` field, a dotted-kebab slug.

    it("maps all 24 documented Pathao event slugs", async () => {
      const { mapCourierStatusToInternal } = await load();
      const m = (s: string) => mapCourierStatusToInternal("pathao", s);

      expect(m("order.created")).toBe("booked");
      expect(m("order.updated")).toBe("updated");
      expect(m("order.pickup-requested")).toBe("pickup_requested");
      expect(m("order.assigned-for-pickup")).toBe("pickup_assigned");
      expect(m("order.picked")).toBe("picked_up");
      expect(m("order.pickup-failed")).toBe("pickup_failed");
      expect(m("order.pickup-cancelled")).toBe("pickup_cancelled");
      expect(m("order.at-the-sorting-hub")).toBe("in_transit");
      expect(m("order.in-transit")).toBe("in_transit");
      expect(m("order.received-at-last-mile-hub")).toBe("in_transit");
      expect(m("order.assigned-for-delivery")).toBe("out_for_delivery");
      expect(m("order.delivered")).toBe("delivered");
      expect(m("order.partial-delivery")).toBe("delivered");
      expect(m("order.returned")).toBe("return_initiated");
      expect(m("order.delivery-failed")).toBe("failed");
      expect(m("order.on-hold")).toBe("on_hold");
      expect(m("order.paid")).toBe("paid");
      expect(m("order.paid-return")).toBe("paid_return");
      expect(m("order.exchanged")).toBe("exchanged");
      expect(m("order.return-id-created")).toBe("return_id_created");
      expect(m("order.return-in-transit")).toBe("return_in_transit");
      expect(m("order.returned-to-merchant")).toBe("returned_to_merchant");
      // Account-level events carry no consignment_id and must not touch an order.
      expect(m("store.created")).toBeNull();
      expect(m("store.updated")).toBeNull();
    });

    it("maps the unguessable Pathao slugs to their real meaning", async () => {
      const { mapCourierStatusToInternal } = await load();
      // These are the ones inference gets wrong: the panel labels them
      // "Payment Invoice" and "Exchange", but the slugs are order.paid /
      // order.exchanged — no amount of guessing recovers that.
      expect(mapCourierStatusToInternal("pathao", "order.paid")).toBe("paid");
      expect(mapCourierStatusToInternal("pathao", "order.exchanged")).toBe("exchanged");
    });

    it("routes Pathao delivery failure to `failed`, the RPC's transition key", async () => {
      const { mapCourierStatusToInternal } = await load();
      // api.update_shipment_status transitions on 'failed', NOT 'delivery_failed'.
      // Returning the latter would record an event that never moves the order.
      expect(mapCourierStatusToInternal("pathao", "order.delivery-failed")).toBe("failed");
    });

    it("rejects the guessed Pathao vocabulary that never existed", async () => {
      const { mapCourierStatusToInternal } = await load();
      // The original code expected these; Pathao sends none of them.
      expect(mapCourierStatusToInternal("pathao", "picked_up")).toBeNull();
      expect(mapCourierStatusToInternal("pathao", "out_for_delivery")).toBeNull();
      // Pathao has no plain "Cancelled" — only order.pickup-cancelled.
      expect(mapCourierStatusToInternal("pathao", "Cancelled")).toBeNull();
    });

    it("also accepts the display names the Pathao polling API returns", async () => {
      const { mapCourierStatusToInternal } = await load();
      // /orders/{cid}/info reports order_status as "Pending"/"Delivered", while
      // the webhook reports slugs. Both funnel through this mapper.
      expect(mapCourierStatusToInternal("pathao", "Pending")).toBe("booked");
      expect(mapCourierStatusToInternal("pathao", "Delivered")).toBe("delivered");
      expect(mapCourierStatusToInternal("pathao", "In Transit")).toBe("in_transit");
      expect(mapCourierStatusToInternal("pathao", "Payment Invoice")).toBe("paid");
    });

    // ── Other providers ──────────────────────────────────────────────────

    it("returns null for unknown provider", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("dhl", "delivered")).toBeNull();
    });

    it("manual provider has no automatic status feed → null", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("manual", "delivered")).toBeNull();
    });

    it("returns null for an empty status rather than guessing", async () => {
      const { mapCourierStatusToInternal } = await load();
      expect(mapCourierStatusToInternal("pathao", "")).toBeNull();
      expect(mapCourierStatusToInternal("steadfast", "   ")).toBeNull();
    });
  });

  // ── courierStatusLabel ─────────────────────────────────────────────────

  describe("courierStatusLabel", () => {
    it("returns human label for known SteadFast status", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("steadfast", "delivered")).toBe("Delivered");
      expect(courierStatusLabel("steadfast", "in_review")).toBe("In review");
      expect(courierStatusLabel("steadfast", "delivered_approval_pending")).toBe(
        "Delivered — awaiting approval",
      );
    });

    it("labels Pathao event slugs and display names alike", async () => {
      const { courierStatusLabel } = await load();
      // Rows written before the vocabulary fix may hold either spelling.
      expect(courierStatusLabel("pathao", "order.assigned-for-delivery")).toBe("Out for delivery");
      expect(courierStatusLabel("pathao", "order.paid")).toBe("Payment invoiced");
      // Pathao's own label for this event is "Assigned for Delivery"; the
      // "Out for Delivery" spelling is ours and is deliberately not mapped.
      expect(courierStatusLabel("pathao", "Assigned for Delivery")).toBe("Out for delivery");
    });

    it("returns raw status for unknown status", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("steadfast", "custom_thing")).toBe("custom_thing");
    });

    it("returns raw status for unknown provider", async () => {
      const { courierStatusLabel } = await load();
      expect(courierStatusLabel("fedex", "shipped")).toBe("shipped");
    });

    it("labels our stored internal canonical statuses", async () => {
      const { courierStatusLabel } = await load();
      // These are what we persist in shipments.courier_status now.
      expect(courierStatusLabel("steadfast", "booked")).toBe("Booked");
      expect(courierStatusLabel("pathao", "out_for_delivery")).toBe("Out for delivery");
      expect(courierStatusLabel("steadfast", "returned_to_merchant")).toBe("Returned to merchant");
      expect(courierStatusLabel("steadfast", "on_hold")).toBe("On hold");
    });
  });

  // ── Webhook auth helpers ───────────────────────────────────────────────

  describe("extractBearerToken", () => {
    // SteadFast sends `Authorization: Bearer {your_api_key}` (merchant panel →
    // Webhook Integration → "Webhook Headers"). It never sends X-Webhook-Secret.

    it("extracts the token from a well-formed Bearer header", async () => {
      const { extractBearerToken } = await load();
      expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    });

    it("tolerates scheme casing and extra whitespace", async () => {
      const { extractBearerToken } = await load();
      expect(extractBearerToken("bearer abc123")).toBe("abc123");
      expect(extractBearerToken("BEARER   abc123  ")).toBe("abc123");
    });

    it("returns empty for a missing or non-Bearer header", async () => {
      const { extractBearerToken } = await load();
      // Empty never equals a configured secret, so the caller rejects.
      expect(extractBearerToken(null)).toBe("");
      expect(extractBearerToken(undefined)).toBe("");
      expect(extractBearerToken("")).toBe("");
      expect(extractBearerToken("Basic abc123")).toBe("");
      expect(extractBearerToken("abc123")).toBe("");
      expect(extractBearerToken("Bearer")).toBe("");
      expect(extractBearerToken("Bearer ")).toBe("");
    });

    it("keeps tokens containing spaces or dots intact", async () => {
      const { extractBearerToken } = await load();
      expect(extractBearerToken("Bearer a.b-c_d")).toBe("a.b-c_d");
    });
  });

  describe("isPathaoIntegrationProbe", () => {
    // Pathao POSTs { event: "webhook_integration" } when "Add Webhook" is
    // clicked; the URL is only accepted if we answer 202 + the secret header.

    it("recognises the documented registration probe", async () => {
      const { isPathaoIntegrationProbe } = await load();
      expect(isPathaoIntegrationProbe({ event: "webhook_integration" })).toBe(true);
    });

    it("does not mistake a real event for the probe", async () => {
      const { isPathaoIntegrationProbe } = await load();
      // A real event must fall through to the signature check, not get a 202.
      expect(
        isPathaoIntegrationProbe({ event: "order.delivered", consignment_id: "DL121224VS8TTJ" }),
      ).toBe(false);
      expect(isPathaoIntegrationProbe({})).toBe(false);
      expect(isPathaoIntegrationProbe(null)).toBe(false);
      expect(isPathaoIntegrationProbe("webhook_integration")).toBe(false);
    });
  });

  describe("PATHAO_INTEGRATION_SECRET", () => {
    it("matches the constant Pathao's docs require echoed back", async () => {
      const { PATHAO_INTEGRATION_SECRET } = await load();
      // Hard-coded in Pathao's Webhook Integration doc. If this drifts,
      // registration silently starts failing.
      expect(PATHAO_INTEGRATION_SECRET).toBe("f3992ecc-59da-4cbe-a049-a13da2018d51");
    });
  });

  // ── webhookEventId (idempotency key) ───────────────────────────────────

  describe("webhookEventId", () => {
    it("is deterministic for the same provider + raw body", async () => {
      const { webhookEventId } = await load();
      const body = '{"consignment_id":"CID1","status":"delivered"}';
      const a = await webhookEventId("steadfast", body);
      const b = await webhookEventId("steadfast", body);
      expect(a).toBe(b);
      expect(a.startsWith("steadfast:")).toBe(true);
    });

    it("differs when the body differs (distinct real events process)", async () => {
      const { webhookEventId } = await load();
      const a = await webhookEventId("steadfast", '{"status":"delivered"}');
      const b = await webhookEventId("steadfast", '{"status":"in_transit"}');
      expect(a).not.toBe(b);
    });

    it("differs by provider even for identical bodies", async () => {
      const { webhookEventId } = await load();
      const body = '{"consignment_id":"CID1"}';
      expect(await webhookEventId("steadfast", body)).not.toBe(
        await webhookEventId("pathao", body),
      );
    });

    it("does not embed a clock (two calls far apart still match)", async () => {
      const { webhookEventId } = await load();
      const body = '{"x":1}';
      const a = await webhookEventId("pathao", body);
      await new Promise((r) => setTimeout(r, 5));
      const b = await webhookEventId("pathao", body);
      expect(a).toBe(b);
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
