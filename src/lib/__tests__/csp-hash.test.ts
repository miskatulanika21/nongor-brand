/**
 * Tests for extractInlineScriptHashes.
 *
 * These are load-bearing beyond the usual: the digests here must match what a
 * BROWSER computes, byte for byte. A wrong hash blocks every script on a public
 * page — and because those pages are edge-cached, the broken render is then
 * served to every visitor until the cache is purged.
 *
 * The expected values below were therefore computed with an INDEPENDENT
 * implementation (Python `hashlib.sha256` + base64), not by running this code
 * and pasting the output — that would only prove the function agrees with
 * itself. They pin the three rules that are easy to get wrong:
 *   1. no entity decoding (`<script>` is a raw-text element),
 *   2. no trimming of surrounding whitespace/newlines,
 *   3. UTF-8 bytes (this catalogue renders ৳ inside inline JSON-LD).
 */
import { describe, it, expect } from "vitest";
import { extractInlineScriptHashes } from "@/lib/server/csp-hash.server";

describe("extractInlineScriptHashes", () => {
  it("hashes a plain inline script", () => {
    expect(extractInlineScriptHashes("<script>console.log(1)</script>")).toEqual([
      "'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='",
    ]);
  });

  it("does NOT entity-decode the script body", () => {
    // A browser hashes the raw source text; decoding `&amp;` to `&` here would
    // produce a digest the browser never computes, and the script gets blocked.
    expect(extractInlineScriptHashes("<script>if(a&amp;&amp;b){}</script>")).toEqual([
      "'sha256-ykZ7vaVbZdy5zW7KGmLR9tVlLj9jJyyEaBYLqFmGmao='",
    ]);
  });

  it("hashes UTF-8 content by its bytes", () => {
    expect(extractInlineScriptHashes('<script>const price="৳ 1,250";</script>')).toEqual([
      "'sha256-mro6Pp9OZWMnEVfT0cp+W0PYs7fhBY8o+HZF7Q+vR/U='",
    ]);
  });

  it("preserves surrounding whitespace exactly (no trimming)", () => {
    const html = "<script>\n  const a = 1;\n  const b = 2;\n</script>";
    expect(extractInlineScriptHashes(html)).toEqual([
      "'sha256-i54L6+zqPniV5H4dmpvTpY0dxhDgfy3PCdcYJo/EpiI='",
    ]);
  });

  it("includes application/ld+json blocks", () => {
    // Chrome applies script-src to ld+json; an unhashed block logs a violation.
    const html = '<script type="application/ld+json">{"@type":"Product"}</script>';
    expect(extractInlineScriptHashes(html)).toEqual([
      "'sha256-8bs5VGyZppJ69ShGpCm9/SsoZWkVMjtUW7bXA2UiNdM='",
    ]);
  });

  it("skips external scripts — those are covered by 'self'", () => {
    expect(extractInlineScriptHashes('<script src="/_build/app.js"></script>')).toEqual([]);
    expect(extractInlineScriptHashes('<script type="module" src="/a.js" defer></script>')).toEqual(
      [],
    );
  });

  it("hashes the inline script but not the external one when both are present", () => {
    const html = '<script src="/a.js"></script><script>console.log(1)</script>';
    expect(extractInlineScriptHashes(html)).toEqual([
      "'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='",
    ]);
  });

  it("hashes by content, ignoring attributes such as an empty nonce", () => {
    // Cached pages render nonce-free, so TanStack stamps nonce="". Hash matching
    // is independent of attributes, so this must digest identically.
    const withAttrs = '<script nonce="" class="$tsr" id="x">console.log(1)</script>';
    expect(extractInlineScriptHashes(withAttrs)).toEqual([
      "'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='",
    ]);
  });

  it("de-duplicates identical scripts", () => {
    const html = "<script>console.log(1)</script><script>console.log(1)</script>";
    expect(extractInlineScriptHashes(html)).toHaveLength(1);
  });

  it("keeps adjacent scripts separate rather than merging them", () => {
    const html = "<script>console.log(1)</script><script>console.log(2)</script>";
    expect(extractInlineScriptHashes(html)).toHaveLength(2);
  });

  it("skips empty inline scripts", () => {
    expect(extractInlineScriptHashes("<script></script>")).toEqual([]);
  });

  it("returns an empty array for HTML with no scripts (caller fails open)", () => {
    expect(extractInlineScriptHashes("<html><body>hi</body></html>")).toEqual([]);
  });

  it("tolerates a closing tag with trailing whitespace", () => {
    expect(extractInlineScriptHashes("<script>console.log(1)</script >")).toEqual([
      "'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='",
    ]);
  });

  // ---- HTML parser transformations (see csp-hash.server.ts header) ----
  // These are the cases that unit tests and curl BOTH miss: neither runs the
  // HTML parser, so both agree with a digest the browser never computes. Each
  // expected value below is the digest of the POST-PARSE text.

  it("replaces U+0000 with U+FFFD before hashing, as the parser does", () => {
    // Regression: TanStack delimits serialised route keys with NUL
    // (\0_site\0shop). Hashing the raw bytes blocks the hydration script and
    // the page silently never hydrates.
    const html = `<script>k="\u0000_site\u0000"</script>`;
    expect(extractInlineScriptHashes(html)).toEqual([
      "'sha256-Ug4W+Y1qVJPZBG7oshb/C4zlM6cYHgFnnyh55Km7vqs='",
    ]);
  });

  it("normalises CRLF to LF before hashing", () => {
    const html = "<script>const a=1;\r\nconst b=2;</script>";
    expect(extractInlineScriptHashes(html)).toEqual([
      "'sha256-a/xNH875QGp/oPzdK7IV/YoPizkbj5ioppR5/fGUFW8='",
    ]);
  });

  it("normalises a lone CR to LF before hashing", () => {
    expect(extractInlineScriptHashes("<script>a\rb</script>")).toEqual([
      "'sha256-fhj3NzEbLcOy8mndeDlrA1HxT7Zu+oefdoyyMYGIPHg='",
    ]);
  });
});
