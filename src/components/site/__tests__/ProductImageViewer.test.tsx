/**
 * DOM-wiring tests for the product image viewer (#10). The deterministic gesture
 * math lives in zoom-math.test.ts; this pins the part that math can't — that the
 * component actually WIRES pointer/keyboard events into that math and updates the
 * image transform: two-finger pinch scales, a two-finger drag pans while zoomed
 * (the constant-distance case), and +/-/0/close controls work. jsdom has no
 * layout, so the viewport/image are given measured sizes.
 */
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductImageViewer } from "@/components/site/ProductImageViewer";

afterEach(cleanup);

const VP_W = 400;
const VP_H = 800;
const IMG_W = 400;
const IMG_H = 600;

function fixLayout() {
  const vp = screen.getByRole("group", { name: /image/i }) as HTMLElement;
  const img = vp.querySelector("img") as HTMLImageElement;
  const define = (el: HTMLElement, w: number, h: number) => {
    Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: w,
        bottom: h,
        width: w,
        height: h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  };
  define(vp, VP_W, VP_H);
  define(img, IMG_W, IMG_H);
  return { vp, img };
}

/** Parse translate3d(txpx, typx, 0) scale(s) from the image's inline transform. */
function transform(img: HTMLImageElement): { tx: number; ty: number; scale: number } {
  const t = img.style.transform;
  const tr = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(t);
  const sc = /scale\(([-\d.]+)\)/.exec(t);
  return { tx: tr ? +tr[1] : 0, ty: tr ? +tr[2] : 0, scale: sc ? +sc[1] : 1 };
}

function renderViewer(images = ["/a.jpg"]) {
  const onOpenChange = vi.fn();
  render(
    <ProductImageViewer
      open
      onOpenChange={onOpenChange}
      images={images}
      index={0}
      onIndexChange={vi.fn()}
      name="Test Product"
    />,
  );
  return { onOpenChange, ...fixLayout() };
}

describe("ProductImageViewer — pointer/pinch wiring (#10)", () => {
  it("two-finger pinch OUT scales the image up", () => {
    const { vp, img } = renderViewer();
    expect(transform(img).scale).toBe(1);

    // Two fingers 100px apart, centred on the viewport.
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 150, clientY: 400 });
    fireEvent.pointerDown(vp, { pointerId: 2, clientX: 250, clientY: 400 });
    // Widen to 200px apart (2×) — pinchScale(1, 100, 200) = 2.
    fireEvent.pointerMove(vp, { pointerId: 2, clientX: 350, clientY: 400 });

    expect(transform(img).scale).toBeCloseTo(2, 5);
  });

  it("a two-finger drag at constant distance pans while zoomed (no blank space)", () => {
    const { vp, img } = renderViewer();

    // Zoom to 2× first (widen 100 → 200).
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 150, clientY: 400 });
    fireEvent.pointerDown(vp, { pointerId: 2, clientX: 250, clientY: 400 });
    fireEvent.pointerMove(vp, { pointerId: 2, clientX: 350, clientY: 400 });
    const afterPinch = transform(img);
    expect(afterPinch.scale).toBeCloseTo(2, 5);

    // Now slide BOTH fingers left by 60px, keeping them 200px apart (constant
    // distance → scale unchanged, midpoint moves → pan).
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 90, clientY: 400 });
    fireEvent.pointerMove(vp, { pointerId: 2, clientX: 290, clientY: 400 });
    const afterPan = transform(img);

    expect(afterPan.scale).toBeCloseTo(2, 5); // distance held → no rescale
    expect(afterPan.tx).not.toBe(afterPinch.tx); // midpoint shift → real pan
    // Pan stays clamped inside the rendered image (rendered 2× = 800px wide,
    // viewport 400 → max |tx| = 200); never NaN, never past the letterbox.
    expect(Math.abs(afterPan.tx)).toBeLessThanOrEqual(200 + 1e-6);
    expect(Number.isNaN(afterPan.tx)).toBe(false);
  });

  it("+ / - / 0 controls zoom and reset the transform", () => {
    const { img } = renderViewer();

    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(transform(img).scale).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: /reset zoom/i }));
    expect(transform(img)).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it("keyboard + zooms and 0 resets", () => {
    const { vp, img } = renderViewer();
    fireEvent.keyDown(vp, { key: "+" });
    expect(transform(img).scale).toBeGreaterThan(1);
    fireEvent.keyDown(vp, { key: "0" });
    expect(transform(img).scale).toBe(1);
  });

  it("close button asks to close the viewer", () => {
    const { onOpenChange } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /close image viewer/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
