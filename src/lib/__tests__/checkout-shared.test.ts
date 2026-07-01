import { describe, it, expect } from "vitest";
import {
  cartToQuoteLines,
  cartToPlaceLines,
  normalizeMeasures,
  checkoutErrorMessage,
  availableMethods,
  enabledMethodList,
  isManualMethod,
  newIdempotencyKey,
  MANUAL_METHODS,
} from "@/lib/checkout-shared";
import type { CartItem } from "@/lib/store";
import type { PublicSettings } from "@/lib/settings.schema";

function item(partial: Partial<CartItem>): CartItem {
  return {
    id: "c1",
    productId: "NGR-001",
    name: "Kurti",
    image: "/k.jpg",
    price: 1000,
    qty: 1,
    ...partial,
  };
}

const settings = (over: Partial<PublicSettings>): PublicSettings =>
  ({
    cod_enabled: true,
    payment_methods_enabled: ["bkash"],
    ...over,
  }) as PublicSettings;

describe("cartToQuoteLines", () => {
  it("maps productId → code and carries size + qty", () => {
    const lines = cartToQuoteLines([item({ productId: "NGR-007", size: "M", qty: 2 })]);
    expect(lines).toEqual([{ code: "NGR-007", size: "M", qty: 2 }]);
  });

  it("omits size when absent (custom-size / one-size items)", () => {
    const lines = cartToQuoteLines([item({ size: undefined })]);
    expect(lines[0]).not.toHaveProperty("size");
  });

  it("drops non-positive quantities and truncates fractional qty", () => {
    const lines = cartToQuoteLines([
      item({ id: "a", qty: 0 }),
      item({ id: "b", qty: -3 }),
      item({ id: "c", qty: 2.9 }),
    ]);
    expect(lines).toEqual([{ code: "NGR-001", qty: 2 }]);
  });

  it("drops items without a productId/code", () => {
    expect(cartToQuoteLines([item({ productId: "" })])).toEqual([]);
  });

  it("never carries measurements (measurements are place-only)", () => {
    const lines = cartToQuoteLines([
      item({ size: "Custom", customSize: { Bust: "36", Waist: "30" } }),
    ]);
    expect(lines[0]).not.toHaveProperty("measures");
  });
});

describe("normalizeMeasures", () => {
  it("returns undefined for empty / whitespace-only maps", () => {
    expect(normalizeMeasures(undefined)).toBeUndefined();
    expect(normalizeMeasures({})).toBeUndefined();
    expect(normalizeMeasures({ Bust: "  ", "  ": "30" })).toBeUndefined();
  });

  it("trims labels + values and drops empty entries", () => {
    expect(normalizeMeasures({ "  Bust  ": "  36 in ", Waist: "", Hip: "40" })).toEqual({
      Bust: "36 in",
      Hip: "40",
    });
  });
});

describe("cartToPlaceLines", () => {
  it("attaches normalized measurements from customSize", () => {
    const lines = cartToPlaceLines([
      item({ productId: "NGR-009", size: "Custom", customSize: { Bust: "36", Waist: "30" } }),
    ]);
    expect(lines).toEqual([
      { code: "NGR-009", size: "Custom", qty: 1, measures: { Bust: "36", Waist: "30" } },
    ]);
  });

  it("omits measures for ready-size lines without customSize", () => {
    const lines = cartToPlaceLines([item({ size: "M" })]);
    expect(lines[0]).not.toHaveProperty("measures");
  });

  it("shares code/size/qty and order with cartToQuoteLines (drift-token parity)", () => {
    const cart = [
      item({ id: "a", productId: "NGR-1", size: "M", qty: 2 }),
      item({ id: "b", productId: "NGR-2", size: "Custom", customSize: { Bust: "34" }, qty: 1 }),
    ];
    const quote = cartToQuoteLines(cart);
    const place = cartToPlaceLines(cart).map(({ measures: _m, ...l }) => l);
    expect(place).toEqual(quote);
  });
});

describe("checkoutErrorMessage", () => {
  it("maps a known code to its message", () => {
    expect(checkoutErrorMessage("out_of_stock")).toMatch(/sold out|stock/i);
    expect(checkoutErrorMessage("price_changed")).toMatch(/price/i);
  });

  it("falls back to a generic message for unknown/null codes", () => {
    const generic = checkoutErrorMessage(null);
    expect(generic).toBe(checkoutErrorMessage("totally_unknown_code"));
    expect(generic).toMatch(/try again/i);
  });
});

describe("availableMethods / enabledMethodList", () => {
  it("returns a safe default when settings are unavailable", () => {
    expect(availableMethods(null)).toEqual({ cod: true, manual: ["bkash"] });
    expect(enabledMethodList(null)).toEqual(["cod", "bkash"]);
  });

  it("reflects settings and lists COD first", () => {
    const s = settings({ cod_enabled: false, payment_methods_enabled: ["bkash", "nagad"] });
    expect(availableMethods(s)).toEqual({ cod: false, manual: ["bkash", "nagad"] });
    expect(enabledMethodList(s)).toEqual(["bkash", "nagad"]);

    const s2 = settings({ cod_enabled: true, payment_methods_enabled: ["nagad"] });
    expect(enabledMethodList(s2)).toEqual(["cod", "nagad"]);
  });

  it("can yield an empty list when nothing is enabled", () => {
    expect(
      enabledMethodList(settings({ cod_enabled: false, payment_methods_enabled: [] })),
    ).toEqual([]);
  });
});

describe("isManualMethod", () => {
  it("treats bkash/nagad as manual and cod as not", () => {
    expect(MANUAL_METHODS.every(isManualMethod)).toBe(true);
    expect(isManualMethod("cod")).toBe(false);
  });
});

describe("newIdempotencyKey", () => {
  it("returns distinct non-empty keys", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
