/** Security regression tests for dual-object upload-intent verification. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_BUCKET, MEDIA_SOURCE_BUCKET } from "@/lib/media.schema";

const { createAdminMock } = vi.hoisted(() => ({ createAdminMock: vi.fn() }));
vi.mock("@/lib/server/supabase-admin.server", () => ({
  createAdminSupabaseClient: createAdminMock,
}));

import { MediaError, registerUploaded } from "@/lib/server/media.server";

type StoredObject = { name: string; metadata: Record<string, unknown> };
type BucketResult = { data: StoredObject[] | null; error: unknown };

function buildAdmin(results: Partial<Record<string, BucketResult>>) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: {
      id: "m1",
      storage_path: "2026/08/id-photo.webp",
      public_url: "https://cdn.example/2026/08/id-photo.webp",
      file_name: "photo.webp",
      content_type: "image/webp",
      size_bytes: 100,
    },
    error: null,
  }));
  const lists = new Map<string, ReturnType<typeof vi.fn>>();
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn.example/${path}` },
  }));
  const admin = {
    storage: {
      from: (bucket: string) => {
        const list = vi.fn(async () => results[bucket] ?? { data: [], error: null });
        lists.set(bucket, list);
        return { list, getPublicUrl };
      },
    },
    schema: () => ({ rpc }),
  };
  createAdminMock.mockReturnValue(admin);
  return { rpc, lists, getPublicUrl };
}

const baseInput = {
  path: "2026/08/11111111-1111-4111-8111-111111111111-photo.webp",
  sourcePath: "2026/08/11111111-1111-4111-8111-111111111111-photo.heic",
  fileName: "photo.webp",
  contentType: "image/webp",
  sizeBytes: 999,
  sourceFileName: "photo.heic",
  sourceContentType: "image/heic",
  sourceSizeBytes: 9_999,
  width: 1600,
  height: 2000,
  processingMode: "normalized" as const,
  suggestedFocalX: 0.4,
  suggestedFocalY: 0.3,
};

const validResults = {
  [MEDIA_BUCKET]: {
    data: [
      {
        name: "11111111-1111-4111-8111-111111111111-photo.webp",
        metadata: { size: 12345, mimetype: "image/webp" },
      },
    ],
    error: null,
  },
  [MEDIA_SOURCE_BUCKET]: {
    data: [
      {
        name: "11111111-1111-4111-8111-111111111111-photo.heic",
        metadata: { size: 7654321, mimetype: "image/heic" },
      },
    ],
    error: null,
  },
} satisfies Record<string, BucketResult>;

describe("registerUploaded dual-object verification", () => {
  beforeEach(() => createAdminMock.mockReset());

  it("rejects when either Storage object is missing", async () => {
    const { rpc } = buildAdmin({
      ...validResults,
      [MEDIA_SOURCE_BUCKET]: { data: [], error: null },
    });
    await expect(registerUploaded(baseInput, "actor")).rejects.toMatchObject({
      code: "upload_not_found",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records authoritative metadata and a server-derived public URL", async () => {
    const { rpc } = buildAdmin(validResults);
    await registerUploaded(baseInput, "actor");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("register_media_v2");
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_size_bytes).toBe(12345);
    expect(args.p_content_type).toBe("image/webp");
    expect(args.p_source_size_bytes).toBe(7654321);
    expect(args.p_source_content_type).toBe("image/heic");
    expect(args.p_url).toBe(`https://cdn.example/${baseInput.path}`);
    expect(args.p_processing_mode).toBe("normalized");
    expect(args.p_suggested_focal_x).toBe(0.4);
  });

  it("rejects a disguised non-image in either bucket", async () => {
    const badDelivery = {
      ...validResults,
      [MEDIA_BUCKET]: {
        data: [
          {
            name: "11111111-1111-4111-8111-111111111111-photo.webp",
            metadata: { size: 10, mimetype: "text/html" },
          },
        ],
        error: null,
      },
    } satisfies Record<string, BucketResult>;
    const { rpc } = buildAdmin(badDelivery);
    await expect(registerUploaded(baseInput, "actor")).rejects.toBeInstanceOf(MediaError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses validated client metadata only when Storage omits it", async () => {
    const withoutMetadata = {
      [MEDIA_BUCKET]: {
        data: [{ name: "11111111-1111-4111-8111-111111111111-photo.webp", metadata: {} }],
        error: null,
      },
      [MEDIA_SOURCE_BUCKET]: {
        data: [{ name: "11111111-1111-4111-8111-111111111111-photo.heic", metadata: {} }],
        error: null,
      },
    } satisfies Record<string, BucketResult>;
    const { rpc } = buildAdmin(withoutMetadata);
    await registerUploaded(baseInput, "actor");
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_size_bytes).toBe(baseInput.sizeBytes);
    expect(args.p_source_size_bytes).toBe(baseInput.sourceSizeBytes);
  });
});
