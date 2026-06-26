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
  ALLOWED_MEDIA_TYPES,
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

/**
 * Verify an object exists at `path` in the media bucket and return Storage's
 * own metadata (true byte size + content-type). Returns null when no object is
 * found there. F-06: registration is otherwise driven entirely by client-
 * supplied fields, so without this an admin could register a phantom path or
 * falsified metadata.
 */
async function statUploadedObject(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  path: string,
): Promise<{ size: number | null; mimetype: string | null } | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(dir, { search: name });
  if (error) throw new MediaError("upload_failed");
  const obj = (data ?? []).find((o) => o.name === name);
  if (!obj) return null;
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  return {
    size: typeof meta.size === "number" ? meta.size : null,
    mimetype: typeof meta.mimetype === "string" ? meta.mimetype : null,
  };
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

  // F-06 — upload-intent verification. The signed upload URL only constrains
  // where the browser may PUT; registration still arrives with client-supplied
  // fields. So:
  //   1) confirm a real object exists at `path` (reject phantom registrations);
  //   2) record Storage's TRUE size + content-type, not the client's claims;
  //   3) re-derive the public URL server-side, so a forged call can never inject
  //      an off-bucket URL into the catalogue (and thence into a product gallery
  //      via api.set_product_media, which trusts media_assets.public_url).
  const stat = await statUploadedObject(admin, input.path);
  if (!stat) throw new MediaError("upload_not_found");

  const contentType = stat.mimetype ?? input.contentType;
  if (!ALLOWED_MEDIA_TYPES.includes(contentType as (typeof ALLOWED_MEDIA_TYPES)[number])) {
    throw new MediaError("invalid_media_type");
  }
  const sizeBytes = stat.size ?? input.sizeBytes;
  const publicUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(input.path).data.publicUrl;

  const { data, error } = await admin.schema("api").rpc("register_media", {
    p_path: input.path,
    p_url: publicUrl,
    p_file_name: input.fileName,
    p_content_type: contentType,
    p_size_bytes: sizeBytes,
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
