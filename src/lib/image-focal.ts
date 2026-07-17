/**
 * Shared image-framing primitive — a focal point + zoom that keeps a chosen
 * subject in frame under `object-fit: cover` at any aspect ratio, with NO
 * re-cropped file. Reused by banners, product galleries, and any other
 * object-cover surface, so the framing behaviour is identical everywhere.
 *
 * Isomorphic: NO server-only imports (safe in the client bundle), and no React
 * import — {@link focalStyle} returns a plain CSS object the caller spreads into
 * `style`.
 */
import type { CSSProperties } from "react";
import { z } from "zod";

export interface ImageFocal {
  /** Horizontal focal point, 0 (left) … 1 (right). */
  x: number;
  /** Vertical focal point, 0 (top) … 1 (bottom). */
  y: number;
  /** Zoom/scale, 1 (whole image) … {@link MAX_ZOOM} (tight crop). */
  zoom: number;
}

export const MAX_ZOOM = 3;
export const DEFAULT_FOCAL: ImageFocal = { x: 0.5, y: 0.5, zoom: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Coerce loose input (number, numeric string, jsonb) to a finite number or fallback. */
export function toNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Build a clamped ImageFocal from loose inputs, defaulting to centre / no zoom. */
export function toFocal(x: unknown, y: unknown, zoom: unknown): ImageFocal {
  return {
    x: clamp(toNumber(x, 0.5), 0, 1),
    y: clamp(toNumber(y, 0.5), 0, 1),
    zoom: clamp(toNumber(zoom, 1), 1, MAX_ZOOM),
  };
}

/**
 * CSS for an `object-cover` image so the focal point stays framed and zoom crops
 * tighter around it. `object-position` frames the point; `scale()` magnifies
 * around the SAME point (via `transform-origin`) so it stays put. The rendering
 * container MUST clip overflow (`overflow-hidden`) for zoom > 1.
 */
export function focalStyle(f: ImageFocal): CSSProperties {
  const pos = `${(clamp(f.x, 0, 1) * 100).toFixed(2)}% ${(clamp(f.y, 0, 1) * 100).toFixed(2)}%`;
  const zoom = clamp(f.zoom, 1, MAX_ZOOM);
  if (zoom <= 1) return { objectPosition: pos };
  return { objectPosition: pos, transform: `scale(${zoom})`, transformOrigin: pos };
}

// ── Zod fields (shared by every surface's input schema) ──────────────────────
// Clamped, never rejected: a stray coordinate from an older client falls back to
// centre / no-zoom rather than blocking a save.

const clampedField = (fallback: number, lo: number, hi: number) =>
  z.preprocess((v) => clamp(toNumber(v, fallback), lo, hi), z.number().min(lo).max(hi));

export const focalXField = clampedField(0.5, 0, 1);
export const focalYField = clampedField(0.5, 0, 1);
export const zoomField = clampedField(1, 1, MAX_ZOOM);

/** The three focal fields as a spreadable object for a z.object({...}) shape. */
export const focalSchemaShape = {
  focal_x: focalXField,
  focal_y: focalYField,
  zoom: zoomField,
} as const;
