/**
 * Pure gesture-math tests for the product image viewer (AUD-01 / #10). The DOM
 * pointer/pinch wiring is browser-verified; this pins the deterministic math:
 * tap-cycle stops, pan clamping (no blank-space drag), focal-point zoom, and
 * pinch scaling (incl. constant-distance → unchanged scale, i.e. pure pan).
 */
import { describe, it, expect } from "vitest";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  clampNumber,
  nextZoomStop,
  pinchScale,
  clampPanBox,
  zoomAroundPoint,
} from "@/lib/zoom-math";

describe("nextZoomStop — single-tap cycle fit → 2× → 3× → fit", () => {
  it("advances through the stops and wraps", () => {
    expect(nextZoomStop(1)).toBe(2);
    expect(nextZoomStop(2)).toBe(3);
    expect(nextZoomStop(3)).toBe(1); // wraps back to fit
  });
  it("snaps an off-stop scale sensibly", () => {
    expect(nextZoomStop(1.4)).toBe(1); // zoomed past fit → back to fit
    expect(nextZoomStop(1)).toBe(2);
  });
});

describe("pinchScale", () => {
  it("keeps scale unchanged at constant pinch distance (→ pure two-finger pan)", () => {
    expect(pinchScale(2, 200, 200)).toBe(2);
  });
  it("scales proportionally and clamps to [MIN, MAX]", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 100, 400)).toBe(ZOOM_MAX); // 8 → clamped to 3
    expect(pinchScale(2, 400, 100)).toBe(ZOOM_MIN); // 0.5 → clamped to 1
  });
  it("is safe when the start distance is degenerate", () => {
    expect(pinchScale(2, 0, 100)).toBe(2);
  });
});

describe("clampPanBox — never drag into the letterbox", () => {
  it("pins to centre at or below fit", () => {
    expect(clampPanBox(50, 50, 1, 100, 100, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(clampPanBox(50, 50, 0.5, 100, 100, 100, 100)).toEqual({ x: 0, y: 0 });
  });
  it("clamps to the half-overflow of the rendered image", () => {
    // img 100², scale 2 → rendered 200², viewport 100² → max offset (200-100)/2 = 50
    expect(clampPanBox(999, -999, 2, 100, 100, 100, 100)).toEqual({ x: 50, y: -50 });
    expect(clampPanBox(10, -10, 2, 100, 100, 100, 100)).toEqual({ x: 10, y: -10 });
  });
});

describe("zoomAroundPoint — focal point stays put", () => {
  it("returns the same object (no-op) when the scale doesn't change", () => {
    const v = { scale: 2, tx: 5, ty: 5 };
    expect(zoomAroundPoint(v, 2, 30, 30)).toBe(v);
  });
  it("zooming at the centre adds no translation", () => {
    expect(zoomAroundPoint({ scale: 1, tx: 0, ty: 0 }, 2, 0, 0)).toEqual({
      scale: 2,
      tx: 0,
      ty: 0,
    });
  });
  it("zooming at an off-centre focal point translates to keep it stationary", () => {
    // r = 2, tx' = fx*(1-r) + tx*r = 50*(-1) + 0 = -50
    expect(zoomAroundPoint({ scale: 1, tx: 0, ty: 0 }, 2, 50, 0)).toEqual({
      scale: 2,
      tx: -50,
      ty: 0,
    });
  });
  it("clamps the target scale to the allowed range", () => {
    expect(zoomAroundPoint({ scale: 1, tx: 0, ty: 0 }, 9, 0, 0).scale).toBe(ZOOM_MAX);
  });
});

describe("clampNumber", () => {
  it("clamps within bounds", () => {
    expect(clampNumber(5, 0, 3)).toBe(3);
    expect(clampNumber(-5, 0, 3)).toBe(0);
    expect(clampNumber(2, 0, 3)).toBe(2);
  });
});
