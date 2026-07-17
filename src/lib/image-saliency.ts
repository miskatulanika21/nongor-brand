/**
 * Client-only "where's the subject?" helper for Focal Studio's auto-frame.
 *
 * Two strategies, best-first:
 *   1. The browser's FaceDetector (Shape Detection API) when available — ideal
 *      for model/product-on-person shots.
 *   2. An edge-energy saliency centroid computed on a downscaled canvas — a
 *      dependency-free fallback that works everywhere and usually lands on the
 *      busiest region (the product, not a plain backdrop).
 *
 * Reading pixels needs a CORS-clean image; if the source taints the canvas or
 * fails to load, every function resolves to null so the caller can fall back
 * silently. Only ever called in the browser (on a button click).
 */

/** A suggested focal point, normalized 0..1. Never includes zoom. */
export interface SuggestedFocal {
  x: number;
  y: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}

interface FaceBox {
  boundingBox: { x: number; y: number; width: number; height: number };
}
interface FaceDetectorLike {
  detect(img: CanvasImageSource): Promise<FaceBox[]>;
}

async function detectFaceFocal(img: HTMLImageElement): Promise<SuggestedFocal | null> {
  const Ctor = (globalThis as { FaceDetector?: new (o?: unknown) => FaceDetectorLike })
    .FaceDetector;
  if (typeof Ctor !== "function") return null;
  try {
    const faces = await new Ctor({ fastMode: true, maxDetectedFaces: 5 }).detect(img);
    if (!faces || faces.length === 0) return null;
    // Largest face wins — usually the primary subject.
    const best = faces.reduce((a, b) =>
      b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height
        ? b
        : a,
    );
    const bb = best.boundingBox;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    return { x: clamp01((bb.x + bb.width / 2) / w), y: clamp01((bb.y + bb.height / 2) / h) };
  } catch {
    return null;
  }
}

function saliencyFocal(img: HTMLImageElement): SuggestedFocal | null {
  try {
    const w = 64;
    const h = Math.max(1, Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h); // throws if the canvas is tainted

    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    // Weight each interior pixel by its gradient magnitude (edge energy) and take
    // the weighted centroid — the "centre of visual interest".
    let sum = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = lum[i + 1] - lum[i - 1];
        const gy = lum[i + w] - lum[i - w];
        const mag = Math.sqrt(gx * gx + gy * gy);
        sum += mag;
        sx += mag * x;
        sy += mag * y;
      }
    }
    if (sum === 0) return null;
    return { x: clamp01(sx / sum / (w - 1)), y: clamp01(sy / sum / (h - 1)) };
  } catch {
    return null;
  }
}

/**
 * Suggest a focal point for an image URL, or null if it can't be determined
 * (image failed to load, or a cross-origin source tainted the canvas). Prefers
 * a detected face, then falls back to the saliency centroid.
 */
export async function suggestFocal(src: string): Promise<SuggestedFocal | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(src);
  } catch {
    return null;
  }
  return (await detectFaceFocal(img)) ?? saliencyFocal(img);
}
