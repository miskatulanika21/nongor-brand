/**
 * Cart behavior: canonical line identity + dedup (#8) and hydration that is
 * independent of the wishlist account partition (#6). These guard the money
 * path against duplicate lines and against login/logout clobbering a live cart.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { StoreProvider, useStore } from "@/lib/store";

beforeEach(() => {
  localStorage.clear();
});

const base = {
  productId: "p1",
  name: "Maroon Kurti",
  image: "/a.jpg",
  price: 2390,
  qty: 1,
};

describe("cart line identity + dedup (#8)", () => {
  it("merges quantity for identical ready-size configurations", () => {
    const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });
    act(() => result.current.addToCart({ ...base, size: "M" }));
    act(() => result.current.addToCart({ ...base, size: "M" }));
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].qty).toBe(2);
    expect(result.current.cartCount).toBe(2);
  });

  it("keeps different sizes as distinct lines", () => {
    const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });
    act(() => result.current.addToCart({ ...base, size: "M" }));
    act(() => result.current.addToCart({ ...base, size: "L" }));
    expect(result.current.cart).toHaveLength(2);
  });

  it("merges identical custom measurements but separates different ones", () => {
    const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });
    const custom = { Bust: "36", Waist: "30" };
    act(() => result.current.addToCart({ ...base, customSize: custom, customCharge: 300 }));
    act(() => result.current.addToCart({ ...base, customSize: { ...custom }, customCharge: 300 }));
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].qty).toBe(2);

    act(() =>
      result.current.addToCart({
        ...base,
        customSize: { Bust: "38", Waist: "30" },
        customCharge: 300,
      }),
    );
    expect(result.current.cart).toHaveLength(2);
  });

  it("dedupes save-for-later and merges back into an existing cart line", () => {
    const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });
    act(() => result.current.addToCart({ ...base, size: "M" }));
    act(() => result.current.addToCart({ ...base, size: "L" }));
    const mId = result.current.cart.find((c) => c.size === "M")!.id;

    // Save the M line, then add another M to the cart.
    act(() => result.current.saveForLater(mId));
    expect(result.current.savedForLater).toHaveLength(1);
    act(() => result.current.addToCart({ ...base, size: "M" }));

    // Moving the saved M back must merge into the existing M cart line, not dup.
    const savedId = result.current.savedForLater[0].id;
    act(() => result.current.moveToCart(savedId));
    const mLines = result.current.cart.filter((c) => c.size === "M");
    expect(mLines).toHaveLength(1);
    expect(mLines[0].qty).toBe(2);
    expect(result.current.savedForLater).toHaveLength(0);
  });
});

describe("cart hydration is independent of the wishlist partition (#6)", () => {
  // A harness whose session flips guest → signed-in on demand, exercising the
  // real login transition (which changes the wishlist partition key).
  function Harness() {
    const [signedIn, setSignedIn] = useState(false);
    const session = signedIn
      ? { isAuthenticated: true as const, userId: "user-123" }
      : { isAuthenticated: false as const, userId: null };
    return (
      <StoreProvider session={session}>
        <Probe onLogin={() => setSignedIn(true)} />
      </StoreProvider>
    );
  }

  function Probe({ onLogin }: { onLogin: () => void }) {
    const { cart, cartHydrated, cartCount, addToCart } = useStore();
    return (
      <div>
        <span data-testid="hydrated">{String(cartHydrated)}</span>
        <span data-testid="count">{cartCount}</span>
        <button onClick={() => addToCart({ ...base, size: "S" })}>add</button>
        <button onClick={onLogin}>login</button>
        <span data-testid="len">{cart.length}</span>
      </div>
    );
  }

  it("exposes cartHydrated and keeps the cart intact across login", () => {
    localStorage.setItem(
      "nongorr_cart",
      JSON.stringify([
        { id: "p1-1", productId: "p1", name: "Kurti", image: "/a.jpg", price: 100, qty: 3 },
      ]),
    );

    render(<Harness />);
    expect(screen.getByTestId("hydrated").textContent).toBe("true");
    expect(screen.getByTestId("count").textContent).toBe("3");

    act(() => screen.getByText("add").click());
    expect(screen.getByTestId("count").textContent).toBe("4");

    // Logging in flips the wishlist partition — the cart must NOT be re-read
    // from storage (which would drop the just-added item).
    act(() => screen.getByText("login").click());
    expect(screen.getByTestId("count").textContent).toBe("4");
  });
});
