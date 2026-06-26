import { describe, it, expect } from "vitest";
import {
  productInputSchema,
  categoryInputSchema,
  categoryReorderSchema,
  productGallerySchema,
  productGallerySaveSchema,
  galleryErrorMessage,
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

describe("productGallerySchema", () => {
  it("accepts an empty gallery", () => {
    expect(productGallerySchema.safeParse([]).success).toBe(true);
  });

  it("accepts up to one primary image", () => {
    const r = productGallerySchema.safeParse([
      { url: "https://x/a.png", isPrimary: true },
      { url: "https://x/b.png" },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects more than one primary image", () => {
    const r = productGallerySchema.safeParse([
      { url: "https://x/a.png", isPrimary: true },
      { url: "https://x/b.png", isPrimary: true },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects more than 12 images", () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ url: `https://x/${i}.png` }));
    expect(productGallerySchema.safeParse(items).success).toBe(false);
  });

  it("rejects duplicate urls", () => {
    const r = productGallerySchema.safeParse([
      { url: "https://x/a.png" },
      { url: "https://x/a.png" },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects an empty url", () => {
    expect(productGallerySchema.safeParse([{ url: "" }]).success).toBe(false);
  });

  it("accepts a null alt", () => {
    expect(productGallerySchema.safeParse([{ url: "https://x/a.png", alt: null }]).success).toBe(
      true,
    );
  });
});

describe("productGallerySaveSchema", () => {
  it("requires a product code", () => {
    expect(productGallerySaveSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("accepts a code with items", () => {
    const r = productGallerySaveSchema.safeParse({
      code: "NB-0001",
      items: [{ url: "https://x/a.png" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an optional expectedRevision", () => {
    const r = productGallerySaveSchema.safeParse({
      code: "NB-0001",
      items: [],
      expectedRevision: 3,
    });
    expect(r.success).toBe(true);
  });
});

describe("galleryErrorMessage", () => {
  it("maps a known code to its message", () => {
    expect(galleryErrorMessage("invalid_media")).toBe(
      "Each image must come from the media library.",
    );
    expect(galleryErrorMessage("duplicate_media")).toBe(
      "An image may appear only once in a gallery.",
    );
    expect(galleryErrorMessage("gallery_conflict")).toBe(
      "This gallery was changed in another session. Refresh and try again.",
    );
  });

  it("falls back to the internal_error message for unknown codes", () => {
    expect(galleryErrorMessage("something_else")).toBe(
      "Could not save the gallery. Please try again.",
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
