/**
 * Browser-side image → WebP conversion for uploads.
 *
 * Product photos are converted to WebP before they ever reach Storage, so the
 * storefront serves the smaller format everywhere. Conversion is strictly
 * best-effort: if the browser can't encode WebP, the canvas fails, or the
 * result is not actually smaller, the ORIGINAL file is returned unchanged —
 * uploading must never break because of the optimizer.
 *
 * Only JPEG/PNG are converted. WebP/AVIF are already modern formats and GIF
 * may be animated (canvas would flatten it to one frame).
 */

export const WEBP_QUALITY = 0.85;

const CONVERTIBLE_TYPES = new Set(["image/jpeg", "image/png"]);

/** `photo.JPG` → `photo.webp` (pure — unit-tested). */
export function webpFileName(name: string): string {
  const base = name.replace(/\.(jpe?g|png)$/i, "");
  return `${base || "image"}.webp`;
}

/** Should this file type go through WebP conversion at all? */
export function isWebpConvertible(type: string): boolean {
  return CONVERTIBLE_TYPES.has(type);
}

/**
 * Convert a JPEG/PNG file to WebP (alpha preserved). Returns the original
 * file when conversion is not applicable, not supported, or not smaller.
 */
export async function convertImageToWebP(file: File, quality = WEBP_QUALITY): Promise<File> {
  if (!isWebpConvertible(file.type) || typeof document === "undefined") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // corrupt/unsupported image — let the server-side checks speak
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    // Some browsers silently fall back to PNG when WebP encoding is missing.
    if (!blob || blob.type !== "image/webp") return file;
    // A conversion that grows the file defeats the purpose — keep the original.
    if (blob.size >= file.size) return file;

    return new File([blob], webpFileName(file.name), { type: "image/webp" });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
