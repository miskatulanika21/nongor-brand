/**
 * Media library API — createServerFn handlers.
 *
 *   - listMedia          → admin library grid (requires `media.manage`)
 *   - requestMediaUpload → mint a signed upload URL (guardAdminWrite)
 *   - registerMedia      → record the uploaded object (guardAdminWrite)
 *   - removeMedia        → delete row + object (guardAdminWrite)
 *
 * Writes flow through guardAdminWrite (CSRF + permission + MFA step-up + rate
 * limit + denial audit); the canonical media.* audit is in the api.* RPC. The
 * binary is uploaded by the browser straight to Storage via the signed URL.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_MEDIA_BYTES } from "@/lib/media.schema";

async function messageFromMediaError(e: unknown): Promise<string> {
  const { MediaError } = await import("@/lib/server/media.server");
  const { mediaErrorMessage } = await import("@/lib/media.schema");
  if (e instanceof MediaError) return mediaErrorMessage(e.code);
  return "Could not complete the change. Please try again.";
}

const uploadRequestSchema = z.object({
  name: z.string().min(1).max(260),
  type: z.string().min(1).max(120),
  size: z.number().int().min(0).max(MAX_MEDIA_BYTES),
});

const registerSchema = z.object({
  path: z.string().min(1).max(400),
  publicUrl: z.string().min(1).max(1000),
  fileName: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(0).max(MAX_MEDIA_BYTES),
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
});

export const listMedia = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("media.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", media: [] };
  const { listMedia: repoList } = await import("@/lib/server/media.server");
  try {
    return { success: true as const, media: await repoList(authz.identity.userId) };
  } catch {
    return { success: false as const, error: "Could not load media.", media: [] };
  }
});

export const requestMediaUpload = createServerFn({ method: "POST" })
  .validator(uploadRequestSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("media.manage", "requestMediaUpload");
    if (!g.ok) return { success: false as const, error: g.error };

    const { createUpload } = await import("@/lib/server/media.server");
    try {
      return { success: true as const, ticket: await createUpload(data) };
    } catch (e) {
      return { success: false as const, error: await messageFromMediaError(e) };
    }
  });

export const registerMedia = createServerFn({ method: "POST" })
  .validator(registerSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("media.manage", "registerMedia");
    if (!g.ok) return { success: false as const, error: g.error };

    const { registerUploaded } = await import("@/lib/server/media.server");
    try {
      const asset = await registerUploaded(
        {
          path: data.path,
          publicUrl: data.publicUrl,
          fileName: data.fileName,
          contentType: data.contentType,
          sizeBytes: data.sizeBytes,
          width: data.width ?? null,
          height: data.height ?? null,
        },
        g.actorId,
      );
      return { success: true as const, asset };
    } catch (e) {
      return { success: false as const, error: await messageFromMediaError(e) };
    }
  });

export const removeMedia = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("media.manage", "removeMedia");
    if (!g.ok) return { success: false as const, error: g.error };

    const { removeMedia: repoRemove } = await import("@/lib/server/media.server");
    try {
      await repoRemove(data.id, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromMediaError(e) };
    }
  });
