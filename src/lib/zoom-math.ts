/**
 * Pure geometry for the product image viewer's zoom & pan (AUD-01 / #10).
 *
 * These functions are deliberately DOM-free so the gesture math can be unit
 * tested deterministically (jsdom has no real layout). The component measures
 * the viewport/image and feeds the numbers in.
 *
 * Interaction model (documented, authoritative): a clean single tap/click CYCLES
 * through discrete stops fit → 2× → 3× → fit at the tapped point. This is a
 * deliberate choice over "double-tap to toggle": on a product page a single tap
 * is the cheapest gesture and cycling reaches full 3× in three taps without a
 * timing window. Wheel and +/- zoom continuously; two-finger pinch scales around
 * the pinch midpoint AND translates with the midpoint (two-finger pan) even when
 * the pinch distance is momentarily constant.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
/** Discrete stops a tap cycles through. */
export const ZOOM_STOPS = [1, 2, 3] as const;

export function clampNumber(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The next discrete zoom stop for a tap, wrapping fit → 2× → 3× → fit. */
export function nextZoomStop(current: number): number {
  const i = ZOOM_STOPS.findIndex((v) => Math.abs(v - current) < 0.05);
  return i < 0 ? (current > 1 ? 1 : 2) : ZOOM_STOPS[(i + 1) % ZOOM_STOPS.length];
}

/** Scale from a pinch: start scale × (current distance / start distance). */
export function pinchScale(startScale: number, startDist: number, currentDist: number): number {
  if (startDist <= 0) return startScale;
  return clampNumber(startScale * (currentDist / startDist), ZOOM_MIN, ZOOM_MAX);
}

export interface PanBox {
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

/**
 * The box an `object-fit: contain` image actually paints inside a viewport —
 * i.e. the source aspect ratio letterboxed into `vpW`×`vpH`.
 *
 * The viewer sizes its <img> to the full viewport so its layout size is
 * deterministic (measuring the element would otherwise return the letterbox,
 * and intrinsic sizing is unreliable: a `w`-descriptor srcset reports a
 * DENSITY-CORRECTED intrinsic size, which collapses to a fraction of the real
 * pixels whenever the chosen candidate is wider than the source file). Pan
 * clamping needs the painted box, so it is derived here from the ratio alone —
 * which density correction preserves. Falls back to the full viewport before
 * the image has loaded (natural dimensions still 0).
 */
export function containBox(natW: number, natH: number, vpW: number, vpH: number): Box {
  if (natW <= 0 || natH <= 0 || vpW <= 0 || vpH <= 0) return { width: vpW, height: vpH };
  const scale = Math.min(vpW / natW, vpH / natH);
  return { width: natW * scale, height: natH * scale };
}

/**
 * Clamp a pan offset to the RENDERED image box so it can never be dragged into
 * the surrounding letterbox. Dimensions are the layout (untransformed) sizes;
 * `scale` is the applied CSS scale. At/under fit, pan is pinned to centre.
 */
export function clampPanBox(
  x: number,
  y: number,
  scale: number,
  imgW: number,
  imgH: number,
  vpW: number,
  vpH: number,
): PanBox {
  if (scale <= 1) return { x: 0, y: 0 };
  const maxX = Math.max(0, (imgW * scale - vpW) / 2);
  const maxY = Math.max(0, (imgH * scale - vpH) / 2);
  return { x: clampNumber(x, -maxX, maxX), y: clampNumber(y, -maxY, maxY) };
}

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Zoom to `targetScale` while keeping the focal point (fx, fy — an offset from
 * the viewport centre) visually stationary. Returns the new transform (unclamped
 * — the caller clamps the pan to the image box).
 */
export function zoomAroundPoint(
  view: ViewTransform,
  targetScale: number,
  fx: number,
  fy: number,
): ViewTransform {
  const ns = clampNumber(targetScale, ZOOM_MIN, ZOOM_MAX);
  if (ns === view.scale) return view;
  const r = ns / view.scale;
  return { scale: ns, tx: fx * (1 - r) + view.tx * r, ty: fy * (1 - r) + view.ty * r };
}
