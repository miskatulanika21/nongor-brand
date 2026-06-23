import { describe, it, expect } from "vitest";
import {
  productInputSchema,
  categoryInputSchema,
  categoryReorderSchema,
} from "@/lib/catalog-admin.schema";

const validProduct = {
  slug: "rose-kurti",
  name: "Rose Kurti",
  categorySlug: "kurti",
  price: 2500,
};

describe("productInputSchema", () => {
  it("accepts a minimal valid product and applies defaults", () => {
    const r = productInputSchema.safeParse(validProduct);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("draft"); // default
      expect(r.data.stock).toBe(0); // default
      expect(r.data.description).toBe(""); // default
    }
  });

  it("rejects a negative price", () => {
    const r = productInputSchema.safeParse({ ...validProduct, price: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects a non-integer price", () => {
    const r = productInputSchema.safeParse({ ...validProduct, price: 99.5 });
    expect(r.success).toBe(false);
  });

  it("rejects a sale price above the regular price", () => {
    const r = productInputSchema.safeParse({ ...validProduct, price: 1000, salePrice: 1200 });
    expect(r.success).toBe(false);
  });

  it("accepts a sale price equal to the regular price", () => {
    const r = productInputSchema.safeParse({ ...validProduct, price: 1000, salePrice: 1000 });
    expect(r.success).toBe(true);
  });

  it("accepts a null sale price", () => {
    const r = productInputSchema.safeParse({ ...validProduct, salePrice: null });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid slug (uppercase / spaces)", () => {
    expect(productInputSchema.safeParse({ ...validProduct, slug: "Rose Kurti" }).success).toBe(
      false,
    );
    expect(productInputSchema.safeParse({ ...validProduct, slug: "-bad-" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const r = productInputSchema.safeParse({ ...validProduct, status: "published" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing name", () => {
    const r = productInputSchema.safeParse({ ...validProduct, name: "  " });
    expect(r.success).toBe(false);
  });
});

describe("categoryInputSchema", () => {
  it("accepts a valid category with defaults", () => {
    const r = categoryInputSchema.safeParse({ slug: "kurti", name: "Kurti" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sortOrder).toBe(0);
      expect(r.data.isActive).toBe(true);
    }
  });

  it("rejects a negative sort order", () => {
    expect(categoryInputSchema.safeParse({ slug: "kurti", name: "K", sortOrder: -1 }).success).toBe(
      false,
    );
  });
});

describe("categoryReorderSchema", () => {
  it("accepts a list of slug/sortOrder pairs", () => {
    const r = categoryReorderSchema.safeParse([
      { slug: "kurti", sortOrder: 0 },
      { slug: "saree", sortOrder: 1 },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects an empty list", () => {
    expect(categoryReorderSchema.safeParse([]).success).toBe(false);
  });
});
