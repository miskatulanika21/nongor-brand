import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_EDGE,
  fitWithin,
  requiresNormalization,
  webpFileName,
} from "@/lib/image-convert";
import { MAX_MEDIA_BYTES } from "@/lib/media.schema";

describe("webpFileName", () => {
  it("normalizes every still-image source extension", () => {
    expect(webpFileName("photo.JPG")).toBe("photo.webp");
    expect(webpFileName("phone.HEIC")).toBe("phone.webp");
    expect(webpFileName("scan.tiff")).toBe("scan.webp");
    expect(webpFileName("bitmap.dib")).toBe("bitmap.webp");
    expect(webpFileName("shot.AVIF")).toBe("shot.webp");
  });

  it("keeps dots inside the base and handles a missing base", () => {
    expect(webpFileName("kurti.v2.final.png")).toBe("kurti.v2.final.webp");
    expect(webpFileName("noextension")).toBe("noextension.webp");
    expect(webpFileName(".png")).toBe("image.webp");
  });
});

describe("fitWithin", () => {
  it("leaves delivery-sized images untouched", () => {
    expect(fitWithin(1200, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(MAX_DELIVERY_EDGE, 100)).toEqual({
      width: MAX_DELIVERY_EDGE,
      height: 100,
    });
  });

  it("fits landscape and portrait photos within a 4K edge", () => {
    expect(fitWithin(8064, 6048)).toEqual({ width: 4096, height: 3072 });
    expect(fitWithin(6048, 8064)).toEqual({ width: 3072, height: 4096 });
  });

  it("never rounds a positive dimension to zero", () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("requiresNormalization", () => {
  it("keeps suitable web-native masters byte-for-byte", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"] as const) {
      expect(requiresNormalization(type, 1_000_000, 2400, 3000)).toBe(false);
    }
  });

  it("normalizes non-web formats, oversized files and over-4K dimensions", () => {
    for (const type of ["image/bmp", "image/heic", "image/heif", "image/tiff"] as const) {
      expect(requiresNormalization(type, 1_000_000, 1200, 1600)).toBe(true);
    }
    expect(requiresNormalization("image/jpeg", MAX_MEDIA_BYTES + 1, 1200, 1600)).toBe(true);
    expect(requiresNormalization("image/webp", 1_000_000, 4097, 2000)).toBe(true);
  });
});
