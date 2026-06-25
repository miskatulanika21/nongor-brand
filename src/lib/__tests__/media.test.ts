import { describe, it, expect } from "vitest";
import {
  validateMediaFile,
  sanitizeFileName,
  mediaStoragePath,
  mediaErrorMessage,
  toMediaAsset,
  toMediaAssets,
  MAX_MEDIA_BYTES,
} from "@/lib/media.schema";

describe("validateMediaFile", () => {
  it("accepts an allowed image within the size limit", () => {
    expect(validateMediaFile({ name: "a.png", type: "image/png", size: 1000 })).toEqual({
      ok: true,
    });
  });

  it("rejects non-image types", () => {
    const r = validateMediaFile({ name: "a.txt", type: "text/plain", size: 10 });
    expect(r.ok).toBe(false);
  });

  it("rejects empty and oversized files", () => {
    expect(validateMediaFile({ name: "a.png", type: "image/png", size: 0 }).ok).toBe(false);
    expect(
      validateMediaFile({ name: "a.png", type: "image/png", size: MAX_MEDIA_BYTES + 1 }).ok,
    ).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("lowercases, strips directories, and replaces unsafe characters", () => {
    expect(sanitizeFileName("My Photo (1).PNG")).toBe("my-photo-1-.png");
    expect(sanitizeFileName("/evil/../path/Image!.jpg")).toBe("image-.jpg");
  });

  it("falls back to 'image' when nothing usable remains", () => {
    expect(sanitizeFileName("!!!")).toBe("image");
  });
});

describe("mediaStoragePath", () => {
  it("builds a deterministic YYYY/MM/<id>-<name> path", () => {
    const path = mediaStoragePath("Photo.png", {
      id: "abc",
      now: new Date(Date.UTC(2026, 5, 9)), // 2026-06
    });
    expect(path).toBe("2026/06/abc-photo.png");
  });

  it("zero-pads the month", () => {
    const path = mediaStoragePath("x.jpg", { id: "id", now: new Date(Date.UTC(2026, 0, 1)) });
    expect(path.startsWith("2026/01/")).toBe(true);
  });
});

describe("mediaErrorMessage", () => {
  it("maps known codes and falls back to internal_error", () => {
    expect(mediaErrorMessage("actor_not_authorized")).toBe("Not authorized.");
    expect(mediaErrorMessage("media_not_found")).toMatch(/no longer exists/i);
    expect(mediaErrorMessage("???")).toBe(mediaErrorMessage("internal_error"));
  });
});

describe("toMediaAsset / toMediaAssets", () => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111",
    storage_path: "2026/06/x.png",
    public_url: "https://x/2026/06/x.png",
    file_name: "x.png",
    content_type: "image/png",
    size_bytes: 2048,
    width: 800,
    height: 600,
    created_at: "2026-06-26T00:00:00Z",
    usage_count: 3,
  };

  it("maps snake_case rows to a typed asset", () => {
    const a = toMediaAsset(row);
    expect(a).toMatchObject({
      storagePath: "2026/06/x.png",
      publicUrl: "https://x/2026/06/x.png",
      fileName: "x.png",
      sizeBytes: 2048,
      width: 800,
      usageCount: 3,
    });
  });

  it("defaults usageCount/sizeBytes and tolerates null dimensions", () => {
    const a = toMediaAsset({ ...row, usage_count: undefined, size_bytes: null, width: null });
    expect(a?.usageCount).toBe(0);
    expect(a?.sizeBytes).toBe(0);
    expect(a?.width).toBeNull();
  });

  it("returns null for rows missing required fields, and filters them from a list", () => {
    expect(toMediaAsset({ id: "x" })).toBeNull();
    expect(toMediaAsset("nope")).toBeNull();
    expect(toMediaAssets([row, { id: "bad" }, null])).toHaveLength(1);
    expect(toMediaAssets("nope")).toEqual([]);
  });
});
