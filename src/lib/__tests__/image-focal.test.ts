import { describe, it, expect } from "vitest";
import { DEFAULT_FOCAL, MAX_ZOOM, focalStyle, toFocal, toNumber } from "@/lib/image-focal";

describe("toNumber", () => {
  it("accepts numbers and numeric strings, falls back otherwise", () => {
    expect(toNumber(0.3, 9)).toBe(0.3);
    expect(toNumber("0.7", 9)).toBe(0.7);
    expect(toNumber("nope", 9)).toBe(9);
    expect(toNumber(undefined, 9)).toBe(9);
    expect(toNumber(NaN, 9)).toBe(9);
  });
});

describe("toFocal", () => {
  it("clamps x/y to 0..1 and zoom to 1..MAX_ZOOM", () => {
    expect(toFocal(0.2, 0.8, 2)).toEqual({ x: 0.2, y: 0.8, zoom: 2 });
    expect(toFocal(-1, 5, 0.1)).toEqual({ x: 0, y: 1, zoom: 1 });
    expect(toFocal(2, -2, 99)).toEqual({ x: 1, y: 0, zoom: MAX_ZOOM });
  });

  it("defaults missing/garbage values to centre / no zoom", () => {
    expect(toFocal(undefined, undefined, undefined)).toEqual(DEFAULT_FOCAL);
    expect(toFocal("x", "y", "z")).toEqual(DEFAULT_FOCAL);
  });
});

describe("focalStyle", () => {
  it("emits object-position and omits the transform at zoom 1", () => {
    const s = focalStyle({ x: 0.5, y: 0.25, zoom: 1 });
    expect(s.objectPosition).toBe("50.00% 25.00%");
    expect(s.transform).toBeUndefined();
    expect(s.transformOrigin).toBeUndefined();
  });

  it("adds scale() + transform-origin at the focal point when zoomed", () => {
    const s = focalStyle({ x: 0.2, y: 0.8, zoom: 2 });
    expect(s.objectPosition).toBe("20.00% 80.00%");
    expect(s.transform).toBe("scale(2)");
    expect(s.transformOrigin).toBe("20.00% 80.00%");
  });

  it("clamps out-of-range input", () => {
    const s = focalStyle({ x: 2, y: -1, zoom: 99 });
    expect(s.objectPosition).toBe("100.00% 0.00%");
    expect(s.transform).toBe(`scale(${MAX_ZOOM})`);
  });
});
