import { describe, it, expect } from "vitest";
import {
  IMAGE_SIZES,
  IMAGE_QUALITIES,
  DEFAULT_IMAGE_QUALITY,
  HIGH_IMAGE_QUALITY,
  isOptimizable,
  vercelImageUrl,
  buildImageSrcSet,
} from "@/lib/image-cdn";
import vercelJson from "../../../vercel.json";

describe("vercel.json ↔ image-cdn drift guard", () => {
  // /_vercel/image 400s on any w/q outside the deployed config — these MUST
  // stay identical or production images silently break.
  it("sizes and qualities match the deployed images config exactly", () => {
    expect([...IMAGE_SIZES]).toEqual(vercelJson.images.sizes);
    expect([...IMAGE_QUALITIES]).toEqual(vercelJson.images.qualities);
  });

  it("the component default qualities are allowed by the config", () => {
    expect(vercelJson.images.qualities).toContain(DEFAULT_IMAGE_QUALITY);
    expect(vercelJson.images.qualities).toContain(HIGH_IMAGE_QUALITY);
  });
});

describe("isOptimizable", () => {
  it("accepts bundled /assets/ paths and the Supabase public storage host", () => {
    expect(isOptimizable("/assets/hero-CsfG-RRi.webp")).toBe(true);
    expect(isOptimizable("/assets/products/kurti.jpg")).toBe(true);
    expect(
      isOptimizable(
        "https://xomjxtmhkglhuiccekld.supabase.co/storage/v1/object/public/product-media/2026/07/x.webp",
      ),
    ).toBe(true);
  });

  it("rejects everything the config would 400 on", () => {
    expect(isOptimizable("")).toBe(false);
    expect(isOptimizable("data:image/png;base64,AAA")).toBe(false);
    expect(isOptimizable("blob:http://localhost/x")).toBe(false);
    expect(isOptimizable("/favicon.ico")).toBe(false); // outside /assets/
    expect(isOptimizable("/assets/icon.svg")).toBe(false);
    expect(isOptimizable("https://evil.example.com/pic.jpg")).toBe(false);
    expect(
      isOptimizable("http://xomjxtmhkglhuiccekld.supabase.co/storage/v1/object/public/a"),
    ).toBe(false); // http, not https
    expect(
      isOptimizable("https://xomjxtmhkglhuiccekld.supabase.co/storage/v1/object/sign/private/a"),
    ).toBe(false); // signed/private object, not public
  });
});

describe("URL builders", () => {
  it("builds the /_vercel/image URL with an encoded source", () => {
    expect(vercelImageUrl("/assets/a b.webp", 640, 75)).toBe(
      "/_vercel/image?url=%2Fassets%2Fa%20b.webp&w=640&q=75",
    );
  });

  it("builds a width-descriptor srcset in order", () => {
    const set = buildImageSrcSet("/assets/x.webp", [256, 640], 75);
    expect(set).toBe(
      "/_vercel/image?url=%2Fassets%2Fx.webp&w=256&q=75 256w, " +
        "/_vercel/image?url=%2Fassets%2Fx.webp&w=640&q=75 640w",
    );
  });
});
