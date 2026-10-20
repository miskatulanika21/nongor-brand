import { describe, expect, it } from "vitest";
import { isTrackingParam, stripTrackingParams } from "@/lib/tracking-params";

describe("isTrackingParam", () => {
  it("matches click ids and any utm_* key, case-insensitively", () => {
    for (const k of ["fbclid", "GCLID", "utm_source", "UTM_Campaign", "ttclid", "_gl"]) {
      expect(isTrackingParam(k)).toBe(true);
    }
  });

  it("never matches params that change the render", () => {
    for (const k of ["q", "category", "filter", "sort", "page", "size", "utm"]) {
      expect(isTrackingParam(k)).toBe(false);
    }
  });
});

describe("stripTrackingParams", () => {
  it("returns null when there is nothing to strip (fast path)", () => {
    expect(stripTrackingParams(new URL("https://nongorr.com/shop?q=kurti"))).toBeNull();
    expect(stripTrackingParams(new URL("https://nongorr.com/"))).toBeNull();
  });

  it("removes only tracking params and keeps the rest in order", () => {
    const out = stripTrackingParams(
      new URL("https://nongorr.com/shop?filter=new-arrivals&fbclid=X1&utm_source=fb&q=saree"),
    );
    expect(out?.toString()).toBe("https://nongorr.com/shop?filter=new-arrivals&q=saree");
  });

  it("collapses two different ad clicks to the same cache key", () => {
    const a = stripTrackingParams(new URL("https://nongorr.com/?fbclid=AAA"));
    const b = stripTrackingParams(new URL("https://nongorr.com/?fbclid=BBB&utm_medium=paid"));
    expect(a?.toString()).toBe("https://nongorr.com/");
    expect(b?.toString()).toBe(a?.toString());
  });

  it("does not mutate the input URL", () => {
    const input = new URL("https://nongorr.com/?gclid=Z");
    stripTrackingParams(input);
    expect(input.search).toBe("?gclid=Z");
  });
});
