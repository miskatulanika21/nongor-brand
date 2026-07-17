/**
 * Unit tests for the pure catalog row → Product mapping.
 * No DB / network — exercises mapping invariants and missing-media safety.
 */
import { describe, it, expect } from "vitest";
import {
  toCard,
  toProduct,
  PLACEHOLDER_IMAGE,
  type ProductCardRow,
  type ProductDetailRow,
} from "@/lib/catalog-map";

function cardRow(overrides: Partial<ProductCardRow> = {}): ProductCardRow {
  return {
    code: "p1",
    slug: "maroon-handloom-kurti",
    name: "Maroon Handloom Kurti",
    price: 2890,
    sale_price: 2390,
    stock: 0,
    rating: 4.8,
    review_count: 42,
    is_new: true,
    is_handmade: true,
    is_best_seller: true,
    has_video: true,
    custom_size: true,
    custom_size_charge: 300,
    color: "Maroon",
    colors: ["Maroon", "Ivory"],
    fabric: "Handloom Cotton",
    occasion: "Festive",
    shade: null,
    volume: null,
    skin_type: null,
    category: { slug: "kurti", name: "Kurti" },
    media: [
      { url: "/assets/products/a.jpg", alt: "a", is_primary: false, sort_order: 1 },
      { url: "/assets/products/primary.jpg", alt: "p", is_primary: true, sort_order: 0 },
    ],
    sizes: [
      { size: "M", quantity: 5, sort_order: 2 },
      { size: "S", quantity: 3, sort_order: 1 },
    ],
    ...overrides,
  };
}

describe("toCard", () => {
  it("preserves the legacy code as Product.id and derives type/category", () => {
    const p = toCard(cardRow());
    expect(p.id).toBe("p1");
    expect(p.type).toBe("kurti");
    expect(p.category).toBe("Kurti");
    expect(p.salePrice).toBe(2390);
  });

  it("resolves the primary image and orders the gallery by sort_order", () => {
    const p = toCard(cardRow());
    expect(p.image).toBe("/assets/products/primary.jpg");
    expect(p.gallery).toEqual(["/assets/products/primary.jpg", "/assets/products/a.jpg"]);
  });

  it("derives canonical stock from size rows and builds an ordered sizeStock map", () => {
    const p = toCard(cardRow());
    expect(p.stock).toBe(8); // 3 + 5, overriding row.stock=0
    expect(p.sizeStock).toEqual({ S: 3, M: 5 });
    expect(Object.keys(p.sizeStock!)).toEqual(["S", "M"]); // sort_order 1 then 2
  });

  it("uses row.stock and no sizeStock when there are no size rows", () => {
    const p = toCard(cardRow({ sizes: [], stock: 22 }));
    expect(p.stock).toBe(22);
    expect(p.sizeStock).toBeUndefined();
  });

  it("never throws on missing media — falls back to a placeholder", () => {
    const p = toCard(cardRow({ media: [] }));
    expect(p.image).toBe(PLACEHOLDER_IMAGE);
    expect(p.gallery).toEqual([PLACEHOLDER_IMAGE]);
  });

  it("carries the PRIMARY image's focal point + zoom (clamped, string-safe)", () => {
    const p = toCard(
      cardRow({
        media: [
          { url: "/a.jpg", alt: "a", is_primary: false, sort_order: 1, focal_x: 0.9, focal_y: 0.9 },
          {
            url: "/primary.jpg",
            alt: "p",
            is_primary: true,
            sort_order: 0,
            focal_x: "0.3",
            focal_y: "0.7",
            zoom: "2",
          },
        ],
      }),
    );
    // Primary wins, jsonb numeric strings coerce.
    expect(p.imageFocal).toEqual({ x: 0.3, y: 0.7, zoom: 2 });
  });

  it("defaults focal to centre / no zoom when the primary omits it", () => {
    const p = toCard(cardRow());
    expect(p.imageFocal).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });

  it("keeps a null sale price as null", () => {
    const p = toCard(cardRow({ sale_price: null }));
    expect(p.salePrice).toBeNull();
  });

  it("normalizes a category returned as an array (PostgREST embed)", () => {
    const p = toCard(cardRow({ category: [{ slug: "saree", name: "Saree" }] }));
    expect(p.type).toBe("saree");
    expect(p.category).toBe("Saree");
  });
});

function detailRow(overrides: Partial<ProductDetailRow> = {}): ProductDetailRow {
  return {
    ...cardRow(),
    description: "A deep maroon handloom kurti.",
    care: "Hand wash cold.",
    blouse_piece: null,
    length: null,
    work_type: null,
    stitched: null,
    pieces_included: null,
    expiry: null,
    batch: null,
    ingredients: null,
    how_to_use: null,
    safety: null,
    reviews: [
      {
        id: "rev-old",
        author_name: "Old Reviewer",
        rating: 4,
        body: "Older",
        created_at: "2026-04-02T00:00:00Z",
      },
      {
        id: "rev-new",
        author_name: "New Reviewer",
        rating: 5,
        body: "Newer",
        created_at: "2026-05-12T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("toProduct", () => {
  it("maps full detail including description, care and gallery", () => {
    const p = toProduct(detailRow());
    expect(p.id).toBe("p1");
    expect(p.description).toBe("A deep maroon handloom kurti.");
    expect(p.care).toBe("Hand wash cold.");
    expect(p.image).toBe("/assets/products/primary.jpg");
  });

  it("maps reviews newest-first with a trimmed date", () => {
    const p = toProduct(detailRow());
    expect(p.reviews?.map((r) => r.id)).toEqual(["rev-new", "rev-old"]);
    expect(p.reviews?.[0]).toMatchObject({
      name: "New Reviewer",
      rating: 5,
      date: "2026-05-12",
      text: "Newer",
    });
  });

  it("returns undefined reviews when there are none", () => {
    const p = toProduct(detailRow({ reviews: [] }));
    expect(p.reviews).toBeUndefined();
  });
});
