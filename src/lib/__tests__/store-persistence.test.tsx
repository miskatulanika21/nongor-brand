/**
 * Regression: the catalog moving to the database must NOT disturb the cart /
 * wishlist persisted in localStorage. The store holds ids only; resolving them
 * to products is a separate display concern. Legacy "p1".."p10" ids must survive
 * hydration even with an empty/absent catalog.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { StoreProvider, useStore } from "@/lib/store";
import type { CartItem } from "@/lib/store";

beforeEach(() => {
  localStorage.clear();
});

describe("store localStorage persistence", () => {
  it("preserves legacy wishlist + cart ids loaded from localStorage", () => {
    const cart: CartItem[] = [
      { id: "p1-123", productId: "p1", name: "Maroon Kurti", image: "/a.jpg", price: 2390, qty: 2 },
      { id: "p10-456", productId: "p10", name: "Foundation", image: "/b.jpg", price: 1280, qty: 1 },
    ];
    localStorage.setItem("nongorr_wishlist", JSON.stringify(["p1", "p3", "p10"]));
    localStorage.setItem("nongorr_cart", JSON.stringify(cart));

    const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });

    // Wishlist ids survive intact and in order.
    expect(result.current.wishlist).toEqual(["p1", "p3", "p10"]);
    expect(result.current.isWishlisted("p3")).toBe(true);

    // Cart product ids survive intact.
    expect(result.current.cart.map((c) => c.productId)).toEqual(["p1", "p10"]);
    expect(result.current.cartCount).toBe(3);

    // And nothing rewrote them to empty in localStorage.
    expect(JSON.parse(localStorage.getItem("nongorr_wishlist")!)).toEqual(["p1", "p3", "p10"]);
    expect(JSON.parse(localStorage.getItem("nongorr_cart")!)).toHaveLength(2);
  });

  it("starts empty (and does not crash) when no localStorage state exists", () => {
    const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });
    expect(result.current.wishlist).toEqual([]);
    expect(result.current.cart).toEqual([]);
  });
});
