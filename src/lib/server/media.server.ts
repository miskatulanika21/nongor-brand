/**
 * Media library repository — SERVER ONLY. Uses the service-role client.
 *
 * Upload is a two-step, signed-URL flow so the binary never passes through the
 * app server: `createUpload` mints a one-time signed upload URL scoped to a
 * generated path; the browser PUTs the file straight to Storage (the bucket
 * itself enforces the 5 MB limit + image mime allowlist); then `registerUploaded`
 * records the row via api.register_media. Deletes remove the row (audited) then
 * best-effort delete the Storage object. Authorization is enforced upstream
 * (guardAdminWrite / requirePermission); errors surface as MediaError codes.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  MEDIA_BUCKET,
  KNOWN_MEDIA_ERROR_CODES,
  validateMediaFile,
  mediaStoragePath,
  toMediaAsset,
  toMediaAssets,
  type MediaAsset,
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

export type UploadTicket = { path: string; token: string; publicUrl: string };

/** Validate the candidate file and mint a signed upload URL + public URL. */
export async function createUpload(file: {
  name: string;
  type: string;
  size: number;
}): Promise<UploadTicket> {
  const check = validateMediaFile(file);
  if (!check.ok) throw new MediaError("invalid_media_type");

  const admin = createAdminSupabaseClient();
  const path = mediaStoragePath(file.name);
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new MediaError("upload_failed");

  const publicUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  return { path, token: data.token, publicUrl };
}

/** Record an uploaded object in the catalogue (audited in the RPC). */
export async function registerUploaded(
  input: {
    path: string;
    publicUrl: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  },
  actorId: string,
): Promise<MediaAsset | null> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("register_media", {
    p_path: input.path,
    p_url: input.publicUrl,
    p_file_name: input.fileName,
    p_content_type: input.contentType,
    p_size_bytes: input.sizeBytes,
    p_width: input.width,
    p_height: input.height,
    p_actor: actorId,
  });
  if (error) throwMediaError(error);
  return toMediaAsset(data);
}

/** Newest-first media list with product-usage counts. */
export async function listMedia(actorId: string): Promise<MediaAsset[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_media", { p_actor: actorId });
  if (error) throwMediaError(error);
  return toMediaAssets(data);
}

/** Delete the catalogue row (audited) then best-effort remove the object. */
export async function removeMedia(id: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("delete_media", { p_id: id, p_actor: actorId });
  if (error) throwMediaError(error);

  const path = typeof data === "string" ? data : null;
  if (path) {
    // The row (source of truth) is already gone; an orphaned object is harmless.
    await admin.storage
      .from(MEDIA_BUCKET)
      .remove([path])
      .catch(() => undefined);
  }
}
