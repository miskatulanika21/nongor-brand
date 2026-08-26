/**
 * Media library repository — SERVER ONLY. Uses the service-role client.
 *
 * Originals are uploaded to a private, non-destructive source bucket. A
 * browser-normalized delivery master is uploaded to the public media bucket;
 * Vercel Image Optimization creates exact responsive AVIF/WebP variants at
 * request time. Both uploads use short-lived, path-scoped signed URLs.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  MEDIA_BUCKET,
  MEDIA_SOURCE_BUCKET,
  KNOWN_MEDIA_ERROR_CODES,
  mediaStoragePath,
  toMediaAsset,
  toMediaAssets,
  validateMediaDeliveryFile,
  validateMediaSourceFile,
  type MediaAsset,
  type MediaProcessingMode,
} from "@/lib/media.schema";

export class MediaError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MediaError";
  }
}

function throwMediaError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new MediaError(KNOWN_MEDIA_ERROR_CODES.has(raw) ? raw : "internal_error");
}

export type UploadTicket = {
  path: string;
  token: string;
  sourcePath: string;
  sourceToken: string;
  publicUrl: string;
};

type FileSummary = { name: string; type: string; size: number };

/** Validate both files and mint private-original + public-delivery upload URLs. */
export async function createUpload(input: {
  source: FileSummary;
  delivery: FileSummary;
}): Promise<UploadTicket> {
  const sourceCheck = validateMediaSourceFile(input.source);
  if (!sourceCheck.ok) throw new MediaError(sourceCheck.code);
  const deliveryCheck = validateMediaDeliveryFile(input.delivery);
  if (!deliveryCheck.ok) throw new MediaError(deliveryCheck.code);

  const admin = createAdminSupabaseClient();
  const id = globalThis.crypto.randomUUID();
  const now = new Date();
  const sourcePath = mediaStoragePath(input.source.name, { id, now });
  const path = mediaStoragePath(input.delivery.name, { id, now });

  const [sourceTicket, deliveryTicket] = await Promise.all([
    admin.storage.from(MEDIA_SOURCE_BUCKET).createSignedUploadUrl(sourcePath),
    admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path),
  ]);
  if (sourceTicket.error || !sourceTicket.data || deliveryTicket.error || !deliveryTicket.data) {
    throw new MediaError("upload_failed");
  }

  const publicUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  return {
    path,
    token: deliveryTicket.data.token,
    sourcePath,
    sourceToken: sourceTicket.data.token,
    publicUrl,
  };
}

/** Return Storage's authoritative size and MIME type for an uploaded object. */
async function statUploadedObject(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  bucket: string,
  path: string,
): Promise<{ size: number | null; mimetype: string | null } | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await admin.storage.from(bucket).list(dir, { search: name });
  if (error) throw new MediaError("upload_failed");
  const object = (data ?? []).find((candidate) => candidate.name === name);
  if (!object) return null;
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  return {
    size: typeof metadata.size === "number" ? metadata.size : null,
    mimetype: typeof metadata.mimetype === "string" ? metadata.mimetype : null,
  };
}

type RegisterInput = {
  path: string;
  sourcePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sourceFileName: string;
  sourceContentType: string;
  sourceSizeBytes: number;
  width: number | null;
  height: number | null;
  processingMode: Exclude<MediaProcessingMode, "legacy">;
  suggestedFocalX: number | null;
  suggestedFocalY: number | null;
};

/** Verify both objects with Storage, then atomically register their metadata. */
export async function registerUploaded(
  input: RegisterInput,
  actorId: string,
): Promise<MediaAsset | null> {
  assertMatchingGeneratedPaths(input.path, input.sourcePath);
  const admin = createAdminSupabaseClient();
  const [sourceStat, deliveryStat] = await Promise.all([
    statUploadedObject(admin, MEDIA_SOURCE_BUCKET, input.sourcePath),
    statUploadedObject(admin, MEDIA_BUCKET, input.path),
  ]);
  if (!sourceStat || !deliveryStat) throw new MediaError("upload_not_found");

  const sourceContentType = sourceStat.mimetype ?? input.sourceContentType;
  const sourceSizeBytes = sourceStat.size ?? input.sourceSizeBytes;
  const sourceCheck = validateMediaSourceFile({
    name: input.sourceFileName,
    type: sourceContentType,
    size: sourceSizeBytes,
  });
  if (!sourceCheck.ok) throw new MediaError(sourceCheck.code);

  const contentType = deliveryStat.mimetype ?? input.contentType;
  const sizeBytes = deliveryStat.size ?? input.sizeBytes;
  const deliveryCheck = validateMediaDeliveryFile({
    name: input.fileName,
    type: contentType,
    size: sizeBytes,
  });
  if (!deliveryCheck.ok) throw new MediaError(deliveryCheck.code);

  const publicUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(input.path).data.publicUrl;
  const { data, error } = await admin.schema("api").rpc("register_media_v2", {
    p_path: input.path,
    p_url: publicUrl,
    p_file_name: input.fileName,
    p_content_type: deliveryCheck.type,
    p_size_bytes: sizeBytes,
    p_width: input.width,
    p_height: input.height,
    p_source_path: input.sourcePath,
    p_source_file_name: input.sourceFileName,
    p_source_content_type: sourceCheck.type,
    p_source_size_bytes: sourceSizeBytes,
    p_processing_mode: input.processingMode,
    p_suggested_focal_x: input.suggestedFocalX,
    p_suggested_focal_y: input.suggestedFocalY,
    p_actor: actorId,
  });
  if (error) throwMediaError(error);
  return toMediaAsset(data);
}

/** Newest-first media list with product and banner usage counts. */
export async function listMedia(actorId: string): Promise<MediaAsset[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_media", { p_actor: actorId });
  if (error) throwMediaError(error);
  return toMediaAssets(data);
}

/** Mint a one-minute download URL for an authorized admin's private original. */
export async function createOriginalDownload(
  id: string,
): Promise<{ url: string; fileName: string }> {
  const admin = createAdminSupabaseClient();
  const { data: asset, error: lookupError } = await admin
    .from("media_assets")
    .select("source_storage_path, source_file_name")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) throw new MediaError("internal_error");
  if (!asset) throw new MediaError("media_not_found");
  if (!asset.source_storage_path) throw new MediaError("original_not_available");

  const fileName = asset.source_file_name || "original-image";
  const { data, error } = await admin.storage
    .from(MEDIA_SOURCE_BUCKET)
    .createSignedUrl(asset.source_storage_path, 60, { download: fileName });
  if (error || !data?.signedUrl) throw new MediaError("internal_error");
  return { url: data.signedUrl, fileName };
}

const GENERATED_PATH =
  /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[a-z0-9._-]{1,80}$/;

function assertGeneratedPath(path: string): void {
  if (!GENERATED_PATH.test(path)) throw new MediaError("upload_failed");
}

function assertMatchingGeneratedPaths(path: string, sourcePath: string): void {
  assertGeneratedPath(path);
  assertGeneratedPath(sourcePath);
  const deliveryId = path.split("/").pop()?.slice(0, 36);
  const sourceId = sourcePath.split("/").pop()?.slice(0, 36);
  if (!deliveryId || deliveryId !== sourceId) throw new MediaError("upload_failed");
}

/** Remove only an interrupted upload; registered assets are never discarded. */
export async function discardUpload(input: { path: string; sourcePath: string }): Promise<void> {
  assertMatchingGeneratedPaths(input.path, input.sourcePath);

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_assets")
    .select("id")
    .or(`storage_path.eq.${input.path},source_storage_path.eq.${input.sourcePath}`)
    .limit(1);
  if (error) throw new MediaError("internal_error");
  if ((data ?? []).length > 0) return;

  const [sourceRemoval, deliveryRemoval] = await Promise.all([
    admin.storage.from(MEDIA_SOURCE_BUCKET).remove([input.sourcePath]),
    admin.storage.from(MEDIA_BUCKET).remove([input.path]),
  ]);
  if (sourceRemoval.error || deliveryRemoval.error) throw new MediaError("upload_failed");
}

/** Delete the catalogue row, then best-effort delete both Storage objects. */
export async function removeMedia(id: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("delete_media_v2", { p_id: id, p_actor: actorId });
  if (error) throwMediaError(error);

  const result = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const path = typeof result?.path === "string" ? result.path : null;
  const sourcePath = typeof result?.source_path === "string" ? result.source_path : null;
  const removals: Promise<unknown>[] = [];
  if (path) removals.push(admin.storage.from(MEDIA_BUCKET).remove([path]));
  if (sourcePath) removals.push(admin.storage.from(MEDIA_SOURCE_BUCKET).remove([sourcePath]));
  await Promise.all(removals).catch(() => undefined);
}
