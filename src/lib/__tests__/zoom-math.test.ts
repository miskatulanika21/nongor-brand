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
  containBox,
  zoomAroundPoint,
} from "@/lib/zoom-math";

describe("containBox — the painted box of an object-contain image", () => {
  it("letterboxes a portrait source into a landscape viewport", () => {
    // 3:4 image in a 1000×500 viewport → height-bound.
    expect(containBox(900, 1200, 1000, 500)).toEqual({ width: 375, height: 500 });
  });

  it("pillarboxes a landscape source into a portrait viewport", () => {
    // 4:3 image in a 400×800 viewport → width-bound.
    expect(containBox(1200, 900, 400, 800)).toEqual({ width: 400, height: 300 });
  });

  it("fills exactly when the ratios match", () => {
    expect(containBox(950, 1198, 475, 599)).toEqual({ width: 475, height: 599 });
  });

  it("upscales a source smaller than the viewport (contain scales both ways)", () => {
    // The regression this replaced: a 950px source must still fill the phone
    // viewport rather than laying out at its density-corrected intrinsic size.
    expect(containBox(100, 100, 400, 800)).toEqual({ width: 400, height: 400 });
  });

  it("falls back to the full viewport before the image has loaded", () => {
    expect(containBox(0, 0, 390, 692)).toEqual({ width: 390, height: 692 });
    expect(containBox(950, 1198, 0, 0)).toEqual({ width: 0, height: 0 });
  });
});

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
