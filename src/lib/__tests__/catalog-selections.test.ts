import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/supabase.server", () => ({ createServerSupabaseClient: vi.fn() }));

import { selectHomeCollections, selectRelated } from "@/lib/server/catalog.server";
import type { Product } from "@/lib/products";

const card = (id: string, over: Partial<Product> = {}) =>
  ({ id, type: "kurti", isNew: false, isBestSeller: false, isHandmade: false, ...over }) as Product;

describe("selectHomeCollections", () => {
  it("picks at most 4 per rail and 6 lookbook tiles", () => {
    const cards = Array.from({ length: 20 }, (_, i) =>
      card(`p${i}`, { isNew: true, isBestSeller: true, isHandmade: true }),
    );
    const out = selectHomeCollections(cards);
    expect(out.newArrivals).toHaveLength(4);
    expect(out.bestSellers).toHaveLength(4);
    expect(out.customFit).toHaveLength(4);
    expect(out.social).toHaveLength(6);
    expect(out.reviews).toEqual([]);
  });

  it("routes beauty types and handmade kurti to the right rails", () => {
    const out = selectHomeCollections([
      card("a", { type: "serum" }),
      card("b", { type: "kurti", isHandmade: true }),
      card("c", { type: "saree", isHandmade: true }),
    ]);
    expect(out.beauty.map((p) => p.id)).toEqual(["a"]);
    expect(out.customFit.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("selectRelated", () => {
  it("returns same-type products excluding the current one", () => {
    const current = card("x", { type: "saree" });
    const related = selectRelated(
      [current, card("y", { type: "saree" }), card("z", { type: "kurti" })],
      current,
    );
    expect(related.map((p) => p.id)).toEqual(["y"]);
  });
});
