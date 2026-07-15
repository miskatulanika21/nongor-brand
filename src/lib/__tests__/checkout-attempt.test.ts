/**
 * Tests for the client-held guest token + idempotency attempt persistence
 * (order-workflow #1 + #2) and the isomorphic crypto/signature helpers.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadOrCreateAttempt,
  clearCheckoutAttempt,
  type CheckoutAttempt,
} from "@/lib/checkout-attempt";
import { newGuestToken, sha256Hex, placementSignature } from "@/lib/checkout-shared";

const CUSTOMER = { name: "A", phone: "01712345678", district: "Dhaka", address: "1 Rd" };
const baseSig = () =>
  placementSignature({
    lines: [{ code: "p1", qty: 1 }],
    customer: CUSTOMER,
    zone: "dhaka",
    method: "cod",
  });

describe("loadOrCreateAttempt", () => {
  beforeEach(() => window.localStorage.clear());

  it("reuses the SAME key + token for the same signature (safe replay, no duplicate)", () => {
    const sig = baseSig();
    const a = loadOrCreateAttempt(sig);
    const b = loadOrCreateAttempt(sig);
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    expect(b.guestToken).toBe(a.guestToken);
  });

  it("survives a 'reload' — a fresh read of storage returns the same attempt", () => {
    const sig = baseSig();
    const a = loadOrCreateAttempt(sig);
    // Simulate a new page load: the module reads persisted state, not memory.
    const persisted = JSON.parse(
      window.localStorage.getItem("ng.checkout.attempt")!,
    ) as CheckoutAttempt;
    expect(persisted.idempotencyKey).toBe(a.idempotencyKey);
    expect(loadOrCreateAttempt(sig).guestToken).toBe(a.guestToken);
  });

  it("mints a NEW key + token when the placement signature changes", () => {
    const a = loadOrCreateAttempt(baseSig());
    const changed = placementSignature({
      lines: [{ code: "p1", qty: 2 }], // qty changed → different order
      customer: CUSTOMER,
      zone: "dhaka",
      method: "cod",
    });
    const b = loadOrCreateAttempt(changed);
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
    expect(b.guestToken).not.toBe(a.guestToken);
  });

  it("clearCheckoutAttempt forces a fresh attempt next time", () => {
    const sig = baseSig();
    const a = loadOrCreateAttempt(sig);
    clearCheckoutAttempt();
    const b = loadOrCreateAttempt(sig);
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it("recovers from corrupt storage by minting a fresh attempt", () => {
    window.localStorage.setItem("ng.checkout.attempt", "{not json");
    const a = loadOrCreateAttempt(baseSig());
    expect(a.idempotencyKey).toBeTruthy();
    expect(a.guestToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("newGuestToken", () => {
  it("is 64 hex chars and unique per call", () => {
    const a = newGuestToken();
    const b = newGuestToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("sha256Hex", () => {
  it("matches the known SHA-256 of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("a fresh token hashes to a 64-hex digest (the value stored server-side)", async () => {
    const token = newGuestToken();
    expect(await sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("placementSignature", () => {
  it("is stable for identical input and normalizes the coupon", () => {
    const a = placementSignature({
      lines: [{ code: "p1", qty: 1 }],
      customer: CUSTOMER,
      zone: "dhaka",
      method: "cod",
      coupon: "save10",
    });
    const b = placementSignature({
      lines: [{ code: "p1", qty: 1 }],
      customer: CUSTOMER,
      zone: "dhaka",
      method: "cod",
      coupon: "  SAVE10 ",
    });
    expect(a).toBe(b);
  });

  it("differs when the zone, method, or lines change", () => {
    const base = placementSignature({
      lines: [{ code: "p1", qty: 1 }],
      customer: CUSTOMER,
      zone: "dhaka",
      method: "cod",
    });
    expect(
      placementSignature({
        lines: [{ code: "p1", qty: 1 }],
        customer: CUSTOMER,
        zone: "major",
        method: "cod",
      }),
    ).not.toBe(base);
    expect(
      placementSignature({
        lines: [{ code: "p1", qty: 1 }],
        customer: CUSTOMER,
        zone: "dhaka",
        method: "bkash",
      }),
    ).not.toBe(base);
    expect(
      placementSignature({
        lines: [{ code: "p2", qty: 1 }],
        customer: CUSTOMER,
        zone: "dhaka",
        method: "cod",
      }),
    ).not.toBe(base);
  });
});
