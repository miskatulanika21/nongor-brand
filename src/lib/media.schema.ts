/**
 * Media library — isomorphic types, validation, and the storage-path helper
 * (Stage 2 Pass 3e). Shared by the server repository, the server fns, and the
 * admin UI. No server-only imports here.
 */

/** Public, CDN-facing delivery masters. */
export const MEDIA_BUCKET = "product-media";
/** Private, non-destructive originals. */
export const MEDIA_SOURCE_BUCKET = "product-media-originals";

/** Vercel-compatible delivery master ceiling. Mirrors the public bucket. */
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
/** A generous ceiling for phone/camera originals. Mirrors the private bucket. */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
export const MAX_MEDIA_LABEL = `${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB`;
export const MAX_SOURCE_LABEL = `${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB`;

/** Formats that can be served directly or transformed by the delivery layer. */
export const ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

/** Safe, practical product-photo sources accepted by the admin uploader. */
export const ALLOWED_MEDIA_SOURCE_TYPES = [
  ...ALLOWED_MEDIA_TYPES,
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/tiff",
] as const;

export type MediaSourceType = (typeof ALLOWED_MEDIA_SOURCE_TYPES)[number];
export type MediaDeliveryType = (typeof ALLOWED_MEDIA_TYPES)[number];
export type MediaProcessingMode = "legacy" | "original" | "normalized";

const TYPE_ALIASES: Readonly<Record<string, MediaSourceType>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/x-bmp": "image/bmp",
  "image/x-ms-bmp": "image/bmp",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif",
  "image/x-tiff": "image/tiff",
};

const EXTENSION_TYPES: Readonly<Record<string, MediaSourceType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  dib: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** Exact picker contract. SVG/PDF/PSD/RAW deliberately belong to other workflows. */
export const MEDIA_FILE_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".jfif",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".bmp",
  ".dib",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
].join(",");

export const MEDIA_SOURCE_FORMAT_LABEL = "JPG, PNG, WebP, AVIF, GIF, BMP, HEIC/HEIF or TIFF";

/** Normalize browser MIME aliases and recover a missing type from the extension. */
export function resolveMediaSourceType(name: string, type: string): MediaSourceType | null {
  const normalized = type.trim().toLowerCase();
  if (ALLOWED_MEDIA_SOURCE_TYPES.includes(normalized as MediaSourceType)) {
    return normalized as MediaSourceType;
  }
  const alias = TYPE_ALIASES[normalized];
  if (alias) return alias;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? null;
}

export type MediaAsset = {
  id: string;
  storagePath: string;
  publicUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sourceStoragePath: string | null;
  sourceFileName: string | null;
  sourceContentType: string | null;
  sourceSizeBytes: number | null;
  processingMode: MediaProcessingMode;
  suggestedFocalX: number | null;
  suggestedFocalY: number | null;
  createdAt: string | null;
  usageCount: number;
};

export type MediaValidationResult =
  | { ok: true; type: MediaSourceType | MediaDeliveryType }
  | { ok: false; code: string; error: string };

/** Validate a private original before any decoding or normalization. */
export function validateMediaSourceFile(file: {
  name: string;
  type: string;
  size: number;
}): MediaValidationResult {
  const type = resolveMediaSourceType(file.name, file.type);
  if (!type) {
    return {
      ok: false,
      code: "invalid_source_type",
      error: `Use ${MEDIA_SOURCE_FORMAT_LABEL}.`,
    };
  }
  if (file.size <= 0) return { ok: false, code: "empty_file", error: "The file is empty." };
  if (file.size > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      code: "source_too_large",
      error: `Original images must be ${MAX_SOURCE_LABEL} or smaller.`,
    };
  }
  if (!file.name || file.name.length > 260) {
    return { ok: false, code: "invalid_file_name", error: "Invalid file name." };
  }
  return { ok: true, type };
}

/** Validate the public master emitted by the normalization engine. */
export function validateMediaDeliveryFile(file: {
  name: string;
  type: string;
  size: number;
}): MediaValidationResult {
  const type = file.type.trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.includes(type as MediaDeliveryType)) {
    return {
      ok: false,
      code: "invalid_delivery_type",
      error: "The image could not be converted to a web-ready format.",
    };
  }
  if (file.size <= 0) return { ok: false, code: "empty_file", error: "The file is empty." };
  if (file.size > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      code: "delivery_too_large",
      error: `The optimized image must be ${MAX_MEDIA_LABEL} or smaller.`,
    };
  }
  if (!file.name || file.name.length > 260) {
    return { ok: false, code: "invalid_file_name", error: "Invalid file name." };
  }
  return { ok: true, type: type as MediaDeliveryType };
}

/** Lowercase, strip directories, keep [a-z0-9._-], collapse repeats, bound length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  return cleaned || "image";
}

/**
 * Build a collision-resistant object path: `YYYY/MM/<id>-<safe-name>`. The `id`
 * and `now` are injectable so the result is deterministic in unit tests.
 */
export function mediaStoragePath(fileName: string, opts?: { id?: string; now?: Date }): string {
  const now = opts?.now ?? new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = opts?.id ?? globalThis.crypto.randomUUID();
  return `${yyyy}/${mm}/${id}-${sanitizeFileName(fileName)}`;
}

// ── Error messages ──────────────────────────────────────────────────────────

export const MEDIA_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  invalid_media_type: "Only image uploads are allowed.",
  invalid_source_type: `Use ${MEDIA_SOURCE_FORMAT_LABEL}.`,
  invalid_delivery_type: "The image could not be converted to a web-ready format.",
  empty_file: "The file is empty.",
  invalid_file_name: "The image file name is invalid.",
  source_too_large: `Original images must be ${MAX_SOURCE_LABEL} or smaller.`,
  delivery_too_large: `The optimized image must be ${MAX_MEDIA_LABEL} or smaller.`,
  image_decode_failed:
    "This image could not be read. It may be damaged or use an unsupported codec.",
  media_not_found: "That media item no longer exists.",
  original_not_available: "The private original is not available for this legacy image.",
  media_in_use:
    "This image is attached to a product or banner. Remove those references before deleting.",
  upload_failed: "The upload could not be completed. Please try again.",
  upload_not_found: "The uploaded file could not be found in storage. Please upload it again.",
  internal_error: "Could not complete the change. Please try again.",
};

export const KNOWN_MEDIA_ERROR_CODES = new Set(Object.keys(MEDIA_ERROR_MESSAGES));

export function mediaErrorMessage(code: string): string {
  return MEDIA_ERROR_MESSAGES[code] ?? MEDIA_ERROR_MESSAGES.internal_error;
}

// ── Row → MediaAsset mapping ────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function processingMode(v: unknown): MediaProcessingMode {
  return v === "original" || v === "normalized" || v === "legacy" ? v : "legacy";
}

/** Coerce one `api.list_media` / `register_media` row into a MediaAsset. */
export function toMediaAsset(raw: unknown): MediaAsset | null {
  if (!isRecord(raw)) return null;
  const id = s(raw.id);
  const storagePath = s(raw.storage_path);
  const publicUrl = s(raw.public_url);
  const fileName = s(raw.file_name);
  const contentType = s(raw.content_type);
  if (!id || !storagePath || !publicUrl || !fileName || !contentType) return null;
  return {
    id,
    storagePath,
    publicUrl,
    fileName,
    contentType,
    sizeBytes: n(raw.size_bytes) ?? 0,
    width: n(raw.width),
    height: n(raw.height),
    sourceStoragePath: s(raw.source_storage_path),
    sourceFileName: s(raw.source_file_name),
    sourceContentType: s(raw.source_content_type),
    sourceSizeBytes: n(raw.source_size_bytes),
    processingMode: processingMode(raw.processing_mode),
    suggestedFocalX: n(raw.suggested_focal_x),
    suggestedFocalY: n(raw.suggested_focal_y),
    createdAt: s(raw.created_at),
    usageCount: n(raw.usage_count) ?? 0,
  };
}

/** Coerce a `api.list_media` jsonb array into MediaAssets (drops bad rows). */
export function toMediaAssets(raw: unknown): MediaAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaAsset[] = [];
  for (const item of raw) {
    const asset = toMediaAsset(item);
    if (asset) out.push(asset);
  }
  return out;
}
