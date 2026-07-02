import { describe, it, expect } from "vitest";
import { webpFileName, isWebpConvertible, convertImageToWebP } from "@/lib/image-convert";

describe("webpFileName", () => {
  it("replaces jpeg/png extensions case-insensitively", () => {
    expect(webpFileName("photo.jpg")).toBe("photo.webp");
    expect(webpFileName("photo.JPG")).toBe("photo.webp");
    expect(webpFileName("scan.jpeg")).toBe("scan.webp");
    expect(webpFileName("logo.png")).toBe("logo.webp");
  });

  it("keeps dots inside the base name and handles missing extension", () => {
    expect(webpFileName("kurti.v2.final.png")).toBe("kurti.v2.final.webp");
    expect(webpFileName("noextension")).toBe("noextension.webp");
    expect(webpFileName(".png")).toBe("image.webp");
  });
});

describe("isWebpConvertible", () => {
  it("converts only jpeg/png — never webp/avif/gif", () => {
    expect(isWebpConvertible("image/jpeg")).toBe(true);
    expect(isWebpConvertible("image/png")).toBe(true);
    expect(isWebpConvertible("image/webp")).toBe(false);
    expect(isWebpConvertible("image/avif")).toBe(false);
    expect(isWebpConvertible("image/gif")).toBe(false);
  });
});

describe("convertImageToWebP fallback", () => {
  it("returns non-convertible files unchanged (already-WebP passes through)", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.webp", { type: "image/webp" });
    expect(await convertImageToWebP(file)).toBe(file);
  });

  it("returns the original when decoding fails (never blocks the upload)", async () => {
    // jsdom has no real image decoder — createImageBitmap either doesn't exist
    // or rejects on this garbage, and both paths must fall back to the original.
    const file = new File([new Uint8Array([9, 9, 9])], "broken.jpg", { type: "image/jpeg" });
    expect(await convertImageToWebP(file)).toBe(file);
  });
});
