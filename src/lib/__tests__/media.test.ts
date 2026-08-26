import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_LABEL,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_LABEL,
  MEDIA_FILE_ACCEPT,
  mediaErrorMessage,
  mediaStoragePath,
  resolveMediaSourceType,
  sanitizeFileName,
  toMediaAsset,
  toMediaAssets,
  validateMediaDeliveryFile,
  validateMediaSourceFile,
} from "@/lib/media.schema";

describe("media byte limits", () => {
  it("pins the delivery and private-original bucket limits", () => {
    expect(MAX_MEDIA_BYTES).toBe(15 * 1024 * 1024);
    expect(MAX_SOURCE_BYTES).toBe(30 * 1024 * 1024);
    expect(MAX_MEDIA_LABEL).toBe("15 MB");
    expect(MAX_SOURCE_LABEL).toBe("30 MB");
  });

  it("uses the correct limit in each validation message", () => {
    const source = validateMediaSourceFile({
      name: "a.heic",
      type: "image/heic",
      size: MAX_SOURCE_BYTES + 1,
    });
    const delivery = validateMediaDeliveryFile({
      name: "a.webp",
      type: "image/webp",
      size: MAX_MEDIA_BYTES + 1,
    });
    expect(source.ok).toBe(false);
    expect(delivery.ok).toBe(false);
    if (!source.ok) expect(source.error).toContain(MAX_SOURCE_LABEL);
    if (!delivery.ok) expect(delivery.error).toContain(MAX_MEDIA_LABEL);
  });
});

describe("source format resolution and validation", () => {
  it("accepts web, phone, bitmap and archival photo formats", () => {
    const cases = [
      ["a.jpg", "image/jpeg", "image/jpeg"],
      ["a.png", "image/png", "image/png"],
      ["a.webp", "image/webp", "image/webp"],
      ["a.avif", "image/avif", "image/avif"],
      ["a.gif", "image/gif", "image/gif"],
      ["a.bmp", "image/bmp", "image/bmp"],
      ["a.heic", "image/heic", "image/heic"],
      ["a.heif", "image/heif", "image/heif"],
      ["a.tiff", "image/tiff", "image/tiff"],
    ] as const;
    for (const [name, type, expected] of cases) {
      expect(validateMediaSourceFile({ name, type, size: 10 })).toEqual({
        ok: true,
        type: expected,
      });
    }
  });

  it("normalizes aliases and recovers missing browser MIME types from extensions", () => {
    expect(resolveMediaSourceType("phone.JFIF", "")).toBe("image/jpeg");
    expect(resolveMediaSourceType("phone.HEIC", "application/octet-stream")).toBe("image/heic");
    expect(resolveMediaSourceType("scan.tif", "image/x-tiff")).toBe("image/tiff");
    expect(resolveMediaSourceType("bitmap.dib", "image/x-ms-bmp")).toBe("image/bmp");
  });

  it("rejects active/document/creative formats outside the photo workflow", () => {
    for (const [name, type] of [
      ["vector.svg", "image/svg+xml"],
      ["catalog.pdf", "application/pdf"],
      ["design.psd", "image/vnd.adobe.photoshop"],
      ["camera.cr3", "image/x-canon-cr3"],
    ]) {
      expect(validateMediaSourceFile({ name, type, size: 10 }).ok).toBe(false);
    }
    expect(MEDIA_FILE_ACCEPT).not.toContain(".svg");
  });

  it("only accepts web-native public delivery masters", () => {
    expect(validateMediaDeliveryFile({ name: "a.webp", type: "image/webp", size: 10 })).toEqual({
      ok: true,
      type: "image/webp",
    });
    expect(validateMediaDeliveryFile({ name: "a.heic", type: "image/heic", size: 10 }).ok).toBe(
      false,
    );
  });
});

describe("sanitizeFileName", () => {
  it("lowercases, strips directories, and replaces unsafe characters", () => {
    expect(sanitizeFileName("My Photo (1).PNG")).toBe("my-photo-1-.png");
    expect(sanitizeFileName("/evil/../path/Image!.jpg")).toBe("image-.jpg");
  });

  it("falls back to image when nothing usable remains", () => {
    expect(sanitizeFileName("!!!")).toBe("image");
  });
});

describe("mediaStoragePath", () => {
  it("builds a deterministic YYYY/MM/<id>-<name> path", () => {
    expect(
      mediaStoragePath("Photo.png", {
        id: "abc",
        now: new Date(Date.UTC(2026, 5, 9)),
      }),
    ).toBe("2026/06/abc-photo.png");
  });
});

describe("mediaErrorMessage", () => {
  it("maps known pipeline errors and safely falls back", () => {
    expect(mediaErrorMessage("invalid_source_type")).toMatch(/JPG/i);
    expect(mediaErrorMessage("image_decode_failed")).toMatch(/could not be read/i);
    expect(mediaErrorMessage("upload_not_found")).toMatch(/storage/i);
    expect(mediaErrorMessage("???")).toBe(mediaErrorMessage("internal_error"));
  });
});

describe("toMediaAsset / toMediaAssets", () => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111",
    storage_path: "2026/08/x.webp",
    public_url: "https://x/2026/08/x.webp",
    file_name: "x.webp",
    content_type: "image/webp",
    size_bytes: 2048,
    width: 1600,
    height: 2000,
    source_storage_path: "2026/08/x.heic",
    source_file_name: "x.heic",
    source_content_type: "image/heic",
    source_size_bytes: 8_000_000,
    processing_mode: "normalized",
    suggested_focal_x: "0.43",
    suggested_focal_y: 0.38,
    created_at: "2026-08-25T00:00:00Z",
    usage_count: 3,
  };

  it("maps delivery, private-source and framing metadata", () => {
    expect(toMediaAsset(row)).toMatchObject({
      storagePath: "2026/08/x.webp",
      sourceStoragePath: "2026/08/x.heic",
      sourceContentType: "image/heic",
      sourceSizeBytes: 8_000_000,
      processingMode: "normalized",
      suggestedFocalX: 0.43,
      suggestedFocalY: 0.38,
      usageCount: 3,
    });
  });

  it("keeps legacy rows compatible and filters malformed rows", () => {
    const legacy = toMediaAsset({
      ...row,
      source_storage_path: null,
      source_file_name: null,
      source_content_type: null,
      source_size_bytes: null,
      processing_mode: undefined,
      suggested_focal_x: null,
      suggested_focal_y: null,
    });
    expect(legacy?.processingMode).toBe("legacy");
    expect(legacy?.sourceStoragePath).toBeNull();
    expect(toMediaAsset({ id: "x" })).toBeNull();
    expect(toMediaAssets([row, { id: "bad" }, null])).toHaveLength(1);
    expect(toMediaAssets("nope")).toEqual([]);
  });
});
