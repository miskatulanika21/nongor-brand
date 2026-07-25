/**
 * Browser-side image → WebP conversion for uploads.
 *
 * Product photos are converted to WebP before they ever reach Storage, so the
 * storefront serves the smaller format everywhere. Conversion is strictly
 * best-effort: if the browser can't encode WebP, the canvas fails, or the
 * result is not actually smaller, the ORIGINAL file is returned unchanged —
 * uploading must never break because of the optimizer.
 *
 * Straight-from-phone photos are also DOWNSCALED to MAX_IMAGE_EDGE on the long
 * side. A 12 MP camera shot is ~4000px wide; the storefront never renders a
 * product image above ~1080 CSS px (≈2160 device px on a 2× phone), so anything
 * past 2400px is bytes the customer pays for and never sees. Downscaling here —
 * rather than lowering the upload cap — is what lets the cap be generous.
 *
 * JPEG/PNG are always converted. WebP/AVIF are already modern formats so they
 * are re-encoded ONLY when oversized. GIF is never touched (it may be animated,
 * and canvas would flatten it to one frame).
 */

export const WEBP_QUALITY = 0.85;
/** Longest edge (px) kept after conversion. */
export const MAX_IMAGE_EDGE = 2400;

const CONVERTIBLE_TYPES = new Set(["image/jpeg", "image/png"]);
const RESIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/** `photo.JPG` → `photo.webp` (pure — unit-tested). */
export function webpFileName(name: string): string {
  const base = name.replace(/\.(jpe?g|png|webp|avif)$/i, "");
  return `${base || "image"}.webp`;
}

/** Should this file type go through WebP conversion at all? */
export function isWebpConvertible(type: string): boolean {
  return CONVERTIBLE_TYPES.has(type);
}

/** May this file type be re-encoded at all (i.e. is it a still image we own)? */
export function isResizable(type: string): boolean {
  return RESIZABLE_TYPES.has(type);
}

/**
 * Fit `w`×`h` inside a `max`-px square, preserving aspect ratio. Returns the
 * input unchanged when it already fits. Pure — unit-tested.
 */
export function fitWithin(
  w: number,
  h: number,
  max = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max || longest === 0) return { width: w, height: h };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

/**
 * Convert a JPEG/PNG file to WebP (alpha preserved) and downscale anything
 * whose long edge exceeds MAX_IMAGE_EDGE. Returns the original file when no
 * work is needed, the browser can't do it, or the result is not smaller.
 */
export async function convertImageToWebP(file: File, quality = WEBP_QUALITY): Promise<File> {
  if (!isResizable(file.type) || typeof document === "undefined") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // corrupt/unsupported image — let the server-side checks speak
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const resizing = width !== bitmap.width || height !== bitmap.height;
    // An already-modern format that is already small enough needs no work.
    if (!isWebpConvertible(file.type) && !resizing) return file;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    // Some browsers silently fall back to PNG when WebP encoding is missing.
    if (!blob || blob.type !== "image/webp") return file;
    // A pure format change that grows the file defeats the purpose — keep the
    // original. When we RESIZED, the smaller pixel dimensions are the point, so
    // the result is kept even in the rare case it encodes no smaller.
    if (!resizing && blob.size >= file.size) return file;

    return new File([blob], webpFileName(file.name), { type: "image/webp" });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
