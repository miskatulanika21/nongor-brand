import { describe, it, expect } from "vitest";
import {
  webpFileName,
  isWebpConvertible,
  isResizable,
  fitWithin,
  convertImageToWebP,
  MAX_IMAGE_EDGE,
} from "@/lib/image-convert";

describe("webpFileName", () => {
  it("replaces jpeg/png extensions case-insensitively", () => {
    expect(webpFileName("photo.jpg")).toBe("photo.webp");
    expect(webpFileName("photo.JPG")).toBe("photo.webp");
    expect(webpFileName("scan.jpeg")).toBe("scan.webp");
    expect(webpFileName("logo.png")).toBe("logo.webp");
  });

  it("also normalises webp/avif, which a downscale re-encodes", () => {
    expect(webpFileName("big.webp")).toBe("big.webp");
    expect(webpFileName("shot.AVIF")).toBe("shot.webp");
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

describe("isResizable", () => {
  it("covers every still format we re-encode, but never GIF", () => {
    expect(isResizable("image/jpeg")).toBe(true);
    expect(isResizable("image/png")).toBe(true);
    expect(isResizable("image/webp")).toBe(true);
    expect(isResizable("image/avif")).toBe(true);
    // GIF may be animated — canvas would flatten it to a single frame.
    expect(isResizable("image/gif")).toBe(false);
    expect(isResizable("text/plain")).toBe(false);
  });
});

describe("fitWithin", () => {
  it("leaves images already inside the cap untouched", () => {
    expect(fitWithin(1200, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(MAX_IMAGE_EDGE, 100)).toEqual({ width: MAX_IMAGE_EDGE, height: 100 });
  });

  it("scales the long edge down to the cap, preserving aspect ratio", () => {
    // A typical 12 MP phone photo (4:3 landscape).
    expect(fitWithin(4032, 3024)).toEqual({ width: 2400, height: 1800 });
    // Portrait — the cap applies to the long edge whichever one it is.
    expect(fitWithin(3024, 4032)).toEqual({ width: 1800, height: 2400 });
  });

  it("never rounds a dimension away to zero, and tolerates a 0×0 bitmap", () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("convertImageToWebP fallback", () => {
  it("returns GIFs unchanged — they are never re-encoded", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.gif", { type: "image/gif" });
    expect(await convertImageToWebP(file)).toBe(file);
  });

  it("returns an already-WebP file unchanged when it needs no resize", async () => {
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
