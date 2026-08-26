/**
 * Premium client-side image preparation.
 *
 * The original file is never rewritten. It is uploaded to a private master
 * bucket, while this module emits a public, CDN-compatible delivery master.
 * JPEG/PNG/WebP/AVIF remain byte-for-byte untouched when already suitable;
 * HEIC/HEIF, TIFF and BMP are decoded only when selected and normalized to a
 * high-quality WebP. Oversized web images are reduced to a 4K long edge so the
 * Vercel image engine can safely generate exact-use AVIF/WebP variants.
 */
import {
  ALLOWED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  mediaErrorMessage,
  validateMediaDeliveryFile,
  validateMediaSourceFile,
  type MediaProcessingMode,
  type MediaSourceType,
} from "@/lib/media.schema";

/** High-quality delivery master; final page variants are encoded once by Vercel. */
export const DELIVERY_WEBP_QUALITY = 0.94;
/** 4K is ample for the 2560px premium zoom variant while bounding memory/bytes. */
export const MAX_DELIVERY_EDGE = 4096;
/** Reject decompression bombs before creating a full-size canvas where possible. */
export const MAX_DECODE_PIXELS = 80_000_000;

export type PreparedImage = {
  source: File;
  sourceType: MediaSourceType;
  delivery: File;
  width: number;
  height: number;
  processingMode: Exclude<MediaProcessingMode, "legacy">;
};

export class ImagePreparationError extends Error {
  constructor(public readonly code: string) {
    super(mediaErrorMessage(code));
    this.name = "ImagePreparationError";
  }
}

type DecodedImage = {
  bitmap: ImageBitmap;
  /** EXIF/TIFF orientation. Browser-native decoders return an already oriented bitmap. */
  orientation: number;
};

type DecodeWorkerResponse =
  | { id: number; ok: true; bitmap: ImageBitmap; orientation: number }
  | { id: number; ok: false };

type PendingDecode = {
  resolve: (decoded: DecodedImage) => void;
  reject: () => void;
};

let decodeWorker: Worker | null = null;
let decodeWorkerIdleTimer: ReturnType<typeof setTimeout> | null = null;
let decodeRequestId = 0;
const pendingDecodes = new Map<number, PendingDecode>();

function retireDecodeWorkerSoon(): void {
  if (decodeWorkerIdleTimer) clearTimeout(decodeWorkerIdleTimer);
  decodeWorkerIdleTimer = setTimeout(() => {
    if (pendingDecodes.size > 0) return;
    decodeWorker?.terminate();
    decodeWorker = null;
    decodeWorkerIdleTimer = null;
  }, 30_000);
}

function rejectPendingDecodes(): void {
  for (const pending of pendingDecodes.values()) pending.reject();
  pendingDecodes.clear();
  decodeWorker?.terminate();
  decodeWorker = null;
}

function getDecodeWorker(): Worker {
  if (decodeWorker) return decodeWorker;
  if (typeof Worker !== "function") throw new ImagePreparationError("image_decode_failed");
  decodeWorker = new Worker(new URL("./image-decode.worker.ts", import.meta.url), {
    type: "module",
    name: "nongorr-image-decoder",
  });
  decodeWorker.onmessage = (event: MessageEvent<DecodeWorkerResponse>) => {
    const response = event.data;
    const pending = pendingDecodes.get(response.id);
    if (!pending) return;
    pendingDecodes.delete(response.id);
    if (response.ok) {
      pending.resolve({ bitmap: response.bitmap, orientation: response.orientation });
    } else {
      pending.reject();
    }
    if (pendingDecodes.size === 0) retireDecodeWorkerSoon();
  };
  decodeWorker.onerror = rejectPendingDecodes;
  decodeWorker.onmessageerror = rejectPendingDecodes;
  return decodeWorker;
}

/** Decode CPU-heavy HEIC/TIFF files off the UI thread, one at a time. */
function decodeInWorker(file: File, type: "image/heic" | "image/heif" | "image/tiff") {
  return new Promise<DecodedImage>((resolve, reject) => {
    if (decodeWorkerIdleTimer) {
      clearTimeout(decodeWorkerIdleTimer);
      decodeWorkerIdleTimer = null;
    }
    const id = ++decodeRequestId;
    const fail = () => reject(new ImagePreparationError("image_decode_failed"));
    pendingDecodes.set(id, { resolve, reject: fail });
    try {
      getDecodeWorker().postMessage({ id, file, type });
    } catch {
      pendingDecodes.delete(id);
      fail();
    }
  });
}

/** `photo.HEIC` / `scan.tiff` / `image.png` -> `photo.webp` / etc. */
export function webpFileName(name: string): string {
  const base = name.replace(/\.(jpe?g|jfif|png|webp|avif|bmp|dib|heic|heif|tiff?)$/i, "");
  return `${base || "image"}.webp`;
}

/** Fit `w` x `h` inside a square while preserving aspect ratio. */
export function fitWithin(
  w: number,
  h: number,
  max = MAX_DELIVERY_EDGE,
): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max || longest === 0) return { width: w, height: h };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

export function requiresNormalization(
  type: MediaSourceType,
  size: number,
  width: number,
  height: number,
): boolean {
  return (
    !ALLOWED_MEDIA_TYPES.includes(type as (typeof ALLOWED_MEDIA_TYPES)[number]) ||
    size > MAX_MEDIA_BYTES ||
    Math.max(width, height) > MAX_DELIVERY_EDGE
  );
}

function canonicalSource(file: File, type: MediaSourceType): File {
  if (file.type.toLowerCase() === type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

function assertDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_DECODE_PIXELS
  ) {
    throw new ImagePreparationError("image_decode_failed");
  }
}

function orientedSize(width: number, height: number, orientation: number) {
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

async function decodeImage(file: File, type: MediaSourceType): Promise<DecodedImage> {
  try {
    if (type === "image/heic" || type === "image/heif" || type === "image/tiff") {
      // Prefer a native codec (no download) when the browser has one. Otherwise
      // the shared worker lazily loads libheif/the TIFF decoder off the UI thread.
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        assertDimensions(bitmap.width, bitmap.height);
        return { bitmap, orientation: 1 };
      } catch {
        return await decodeInWorker(file, type);
      }
    }
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    assertDimensions(bitmap.width, bitmap.height);
    return { bitmap, orientation: 1 };
  } catch (error) {
    if (error instanceof ImagePreparationError) throw error;
    throw new ImagePreparationError("image_decode_failed");
  }
}

function drawOriented(
  bitmap: ImageBitmap,
  orientation: number,
  maxEdge: number,
): HTMLCanvasElement {
  const rawWidth = bitmap.width;
  const rawHeight = bitmap.height;
  const oriented = orientedSize(rawWidth, rawHeight, orientation);
  const fitted = fitWithin(oriented.width, oriented.height, maxEdge);
  const ratio = fitted.width / oriented.width;
  const scaledWidth = Math.max(1, Math.round(rawWidth * ratio));
  const scaledHeight = Math.max(1, Math.round(rawHeight * ratio));
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const canvas = document.createElement("canvas");
  canvas.width = swapsAxes ? scaledHeight : scaledWidth;
  canvas.height = swapsAxes ? scaledWidth : scaledHeight;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new ImagePreparationError("image_decode_failed");

  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, scaledWidth, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, scaledWidth, scaledHeight);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, scaledHeight);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, scaledHeight, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, scaledHeight, scaledWidth);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, scaledWidth);
      break;
    default:
      break;
  }
  ctx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);
  return canvas;
}

function canvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

async function encodeDelivery(canvas: HTMLCanvasElement, originalName: string): Promise<File> {
  // Start nearly visually lossless. Lower quality only when needed to satisfy
  // the public-origin ceiling; the private original remains untouched.
  for (const quality of [DELIVERY_WEBP_QUALITY, 0.9, 0.86, 0.82, 0.78]) {
    const blob = await canvasToWebP(canvas, quality);
    if (!blob || blob.type !== "image/webp") continue;
    if (blob.size <= MAX_MEDIA_BYTES) {
      return new File([blob], webpFileName(originalName), { type: "image/webp" });
    }
  }
  throw new ImagePreparationError("delivery_too_large");
}

/**
 * Prepare one source image for the dual-upload flow.
 *
 * GIF remains original to preserve animation. All other images are decoded so
 * corrupt files are rejected and dimensions are trustworthy. A suitable web
 * image is returned unchanged; only non-web or oversized sources are rendered
 * to a premium WebP delivery master.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const sourceCheck = validateMediaSourceFile(file);
  if (!sourceCheck.ok) throw new ImagePreparationError(sourceCheck.code);
  const sourceType = sourceCheck.type as MediaSourceType;
  const source = canonicalSource(file, sourceType);

  if (sourceType === "image/gif") {
    const deliveryCheck = validateMediaDeliveryFile(source);
    if (!deliveryCheck.ok) throw new ImagePreparationError(deliveryCheck.code);
    // Reading GIF dimensions through <img> preserves animation and avoids a
    // canvas round-trip that would flatten it to one frame.
    const dims = await readBrowserImageDimensions(source);
    return { source, sourceType, delivery: source, ...dims, processingMode: "original" };
  }

  const decoded = await decodeImage(source, sourceType);
  try {
    const orientation = decoded.orientation;
    const dims = orientedSize(decoded.bitmap.width, decoded.bitmap.height, orientation);
    if (!requiresNormalization(sourceType, source.size, dims.width, dims.height)) {
      const deliveryCheck = validateMediaDeliveryFile(source);
      if (!deliveryCheck.ok) throw new ImagePreparationError(deliveryCheck.code);
      return {
        source,
        sourceType,
        delivery: source,
        width: dims.width,
        height: dims.height,
        processingMode: "original",
      };
    }

    const canvas = drawOriented(decoded.bitmap, orientation, MAX_DELIVERY_EDGE);
    const delivery = await encodeDelivery(canvas, source.name);
    const deliveryCheck = validateMediaDeliveryFile(delivery);
    if (!deliveryCheck.ok) throw new ImagePreparationError(deliveryCheck.code);
    return {
      source,
      sourceType,
      delivery,
      width: canvas.width,
      height: canvas.height,
      processingMode: "normalized",
    };
  } finally {
    decoded.bitmap.close();
  }
}

function readBrowserImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const finish = () => URL.revokeObjectURL(url);
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      finish();
      try {
        assertDimensions(width, height);
        resolve({ width, height });
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => {
      finish();
      reject(new ImagePreparationError("image_decode_failed"));
    };
    img.src = url;
  });
}
