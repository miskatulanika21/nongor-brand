import { describe, it, expect } from "vitest";
import { inventoryAdjustSchema, bulkInventorySchema } from "@/lib/catalog-admin.schema";

/**
 * These cover the TS validation boundary for inventory writes. The DATABASE-level
 * guarantees (concurrency lock, sized/non-sized enforcement, zero-delta refusal,
 * actor/active-staff requirement, append-only ledger, FK RESTRICT, idempotent
 * bulk replay) live in api.set_inventory / api.bulk_set_inventory and are verified
 * by the reproducible rolled-back SQL proofs recorded in the Stage-2 hardening
 * report — they cannot run in Vitest (no live database).
 */
describe("inventoryAdjustSchema", () => {
  const base = { code: "prd_x", size: "M", quantity: 5, reason: "restock" };

  it("accepts a sized adjustment", () => {
    expect(inventoryAdjustSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a non-sized adjustment (size null)", () => {
    expect(inventoryAdjustSchema.safeParse({ ...base, size: null }).success).toBe(true);
  });

  it("rejects a negative quantity", () => {
    expect(inventoryAdjustSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    expect(inventoryAdjustSchema.safeParse({ ...base, quantity: 1.5 }).success).toBe(false);
  });

  it("rejects a blank reason", () => {
    expect(inventoryAdjustSchema.safeParse({ ...base, reason: "  " }).success).toBe(false);
  });

  it("rejects an over-long size", () => {
    expect(inventoryAdjustSchema.safeParse({ ...base, size: "x".repeat(41) }).success).toBe(false);
  });

  it("rejects an over-long note", () => {
    expect(inventoryAdjustSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("bulkInventorySchema", () => {
  const item = { code: "prd_x", size: null, quantity: 0, reason: "Bulk set to zero" };

  it("accepts a bounded batch with an op key", () => {
    const r = bulkInventorySchema.safeParse({ opKey: "op-1", items: [item] });
    expect(r.success).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(bulkInventorySchema.safeParse({ opKey: "op-1", items: [] }).success).toBe(false);
  });

  it("rejects a batch larger than 100", () => {
    const items = Array.from({ length: 101 }, () => item);
    expect(bulkInventorySchema.safeParse({ opKey: "op-1", items }).success).toBe(false);
  });

  it("rejects a missing op key", () => {
    expect(bulkInventorySchema.safeParse({ opKey: "", items: [item] }).success).toBe(false);
  });

  it("rejects an item with a negative quantity", () => {
    const bad = { ...item, quantity: -5 };
    expect(bulkInventorySchema.safeParse({ opKey: "op-1", items: [bad] }).success).toBe(false);
  });
});
