/**
 * Vercel Image Optimization URL builders (pure — no React).
 *
 * On Vercel deployments, `/_vercel/image?url=…&w=…&q=…` resizes on demand,
 * negotiates AVIF/WebP per browser, and caches every variant at the edge.
 * The API contract lives in vercel.json's `images` block: `w` MUST be one of
 * `images.sizes` and `q` one of `images.qualities`, or the request 400s —
 * the constants below are the single source the components draw from, and a
 * unit test asserts they stay in sync with vercel.json.
 *
 * `IMAGE_CDN_ENABLED` is baked at build time (Vercel sets VERCEL=1); local
 * dev/preview and CI serve the original files unchanged.
 */

/** Must mirror vercel.json → images.sizes (drift-guarded by test). */
export const IMAGE_SIZES = [256, 384, 640, 750, 828, 1080, 1200, 1920] as const;

/** Must mirror vercel.json → images.qualities (drift-guarded by test). */
export const IMAGE_QUALITIES = [50, 75, 80] as const;

export const DEFAULT_IMAGE_QUALITY = 75;
/** For hero/PDP imagery where fidelity matters most. */
export const HIGH_IMAGE_QUALITY = 80;

export const IMAGE_CDN_ENABLED: boolean = import.meta.env.VERCEL_IMAGES === "1";

/** Can this src go through the optimizer at all (must match config patterns)? */
export function isOptimizable(src: string): boolean {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return false;
  if (/\.svg($|[?#])/i.test(src)) return false;
  if (src.startsWith("/")) return src.startsWith("/assets/");
  try {
    const u = new URL(src);
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".supabase.co") &&
      u.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

export function vercelImageUrl(src: string, width: number, quality: number): string {
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}

/** `srcset` covering the given widths (each must be in IMAGE_SIZES). */
export function buildImageSrcSet(src: string, widths: readonly number[], quality: number): string {
  return widths.map((w) => `${vercelImageUrl(src, w, quality)} ${w}w`).join(", ");
}
