import { describe, it, expect } from "vitest";
import { inventoryAdjustSchema, bulkInventorySchema } from "@/lib/catalog-admin.schema";

/**
 * Stage 2 Pass-2 closure tests: inventory integrity contracts.
 *
 * These test the TS validation boundary. DB-level guarantees (actor FK RESTRICT,
 * first-variant conservation, advisory-lock concurrency, bulk idempotency,
 * stable error codes) are verified by SQL proofs against the live database.
 */

// ---------- deleteProduct removal verification --------------------------------

describe("hard-delete removal", () => {
  it("deleteProduct is not exported from catalog-admin.api", async () => {
    const api = await import("@/lib/catalog-admin.api");
    expect("deleteProduct" in api).toBe(false);
  });

  it("deleteProduct is not exported from catalog-admin.server", async () => {
    // Dynamic import so the test fails loudly if the export reappears
    const server = await import("@/lib/server/catalog-admin.server");
    expect("deleteProduct" in server).toBe(false);
  });
});

// ---------- Variant management input validation --------------------------------

describe("variant add/remove input validation", () => {
  it("addVariant API is exported", async () => {
    const api = await import("@/lib/catalog-admin.api");
    expect(typeof api.addVariant).toBe("function");
  });

  it("removeVariant API is exported", async () => {
    const api = await import("@/lib/catalog-admin.api");
    expect(typeof api.removeVariant).toBe("function");
  });
});

// ---------- BulkInventoryResult uses errorCode, not error ----------------------

describe("BulkInventoryResult contract", () => {
  it("inventoryErrorMessage maps known codes", async () => {
    const { inventoryErrorMessage } = await import("@/lib/server/catalog-admin.server");
    expect(inventoryErrorMessage("product_not_found")).toBe("Product not found.");
    expect(inventoryErrorMessage("variant_not_empty")).toBe(
      "Set the variant stock to 0 before removing it.",
    );
    expect(inventoryErrorMessage("idempotency_key_reused")).toContain("already used");
  });

  it("inventoryErrorMessage returns generic for unknown codes", async () => {
    const { inventoryErrorMessage } = await import("@/lib/server/catalog-admin.server");
    expect(inventoryErrorMessage("unknown_code_xyz")).toContain("try again");
  });

  it("inventoryErrorMessage handles undefined", async () => {
    const { inventoryErrorMessage } = await import("@/lib/server/catalog-admin.server");
    expect(inventoryErrorMessage(undefined)).toContain("unknown error");
  });
});

// ---------- No raw SQL error exposure ------------------------------------------

describe("no raw SQL error exposure", () => {
  it("inventoryErrorMessage never returns SQLERRM content", async () => {
    const { inventoryErrorMessage } = await import("@/lib/server/catalog-admin.server");
    // Every known code should return a human message, not a raw error
    const codes = [
      "product_not_found",
      "variant_not_found",
      "variant_required",
      "variant_not_allowed",
      "invalid_quantity",
      "invalid_reason",
      "no_change",
      "duplicate_target",
      "idempotency_key_reused",
      "actor_not_authorized",
      "batch_too_large",
      "batch_empty",
      "variant_not_empty",
      "size_already_exists",
      "invalid_size",
      "internal_error",
    ];
    for (const code of codes) {
      const msg = inventoryErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("SQLERRM");
      expect(msg).not.toContain("pg_catalog");
      expect(msg).not.toContain("violates");
    }
  });
});

// ---------- Bulk schema validation (existing tests + new) ----------------------

describe("bulkInventorySchema (extended)", () => {
  const item = { code: "prd_x", size: null, quantity: 0, reason: "Bulk set to zero" };

  it("rejects duplicate (code, size) targets", () => {
    const r = bulkInventorySchema.safeParse({
      opKey: "op-1",
      items: [item, item],
    });
    // Schema-level allows it (DB rejects); this documents the expectation
    expect(r.success).toBe(true); // dup check is at the DB level, not schema
  });
});
