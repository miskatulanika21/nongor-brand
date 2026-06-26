/**
 * Media library — isomorphic types, validation, and the storage-path helper
 * (Stage 2 Pass 3e). Shared by the server repository, the server fns, and the
 * admin UI. No server-only imports here.
 */

export const MEDIA_BUCKET = "product-media";
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors the bucket limit
export const ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export type MediaAsset = {
  id: string;
  storagePath: string;
  publicUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string | null;
  usageCount: number;
};

/** Validate a candidate upload (type + size + name). Pure, client-and-server. */
export function validateMediaFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_MEDIA_TYPES.includes(file.type as (typeof ALLOWED_MEDIA_TYPES)[number])) {
    return { ok: false, error: "Only PNG, JPEG, WebP, AVIF or GIF images are allowed." };
  }
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_MEDIA_BYTES) return { ok: false, error: "Images must be 5 MB or smaller." };
  if (!file.name || file.name.length > 260) return { ok: false, error: "Invalid file name." };
  return { ok: true };
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
  media_not_found: "That media item no longer exists.",
  media_in_use:
    "This image is attached to one or more products. Remove it from their galleries before deleting.",
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
