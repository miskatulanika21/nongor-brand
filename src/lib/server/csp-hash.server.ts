/**
 * CSP script hashing for edge-cached HTML — SERVER ONLY.
 *
 * WHY THIS EXISTS
 * ---------------
 * A per-request nonce and a shared edge cache are fundamentally incompatible: a
 * nonce replayed across cached hits is not a secret, so it provides no security
 * at all. Public pages (`isPublicCacheableRequest`) are therefore rendered
 * NONCE-FREE — which historically meant they fell back to the permissive
 * `script-src 'unsafe-inline'` policy and could never be hardened.
 *
 * Hashes solve this: `'sha256-…'` sources are derived from the response body
 * itself, so the policy is a pure function of the HTML. Header and body are
 * cached together as one unit, so they can never drift apart.
 *
 * WHY NOT `'strict-dynamic'` HERE
 * -------------------------------
 * `'strict-dynamic'` (used on the nonced, uncacheable path) is wrong for this
 * one, for two independent reasons:
 *   1. It makes host-source expressions ignored for scripts. The cached pages
 *      carry a parser-inserted EXTERNAL bundle `<script src="/…">`, which would
 *      then be blocked — only a nonce or an injecting trusted script could
 *      allow it, and we have no nonce here by construction.
 *   2. It only extends trust to scripts a trusted script *injects at runtime*.
 *      The four inline scripts on a cached page are all parser-inserted
 *      siblings, so each needs its own hash regardless.
 * Hence: hash every inline script, keep `'self'` to cover the external bundle,
 * and omit `'strict-dynamic'`.
 *
 * HASHING RULES (must match the browser byte-for-byte or the page breaks)
 * ----------------------------------------------------------------------
 * A CSP hash is computed over the script element's text **as the HTML parser
 * produced it**, not over the raw bytes on the wire. Those differ, and the two
 * spec-mandated transformations below MUST be replicated or every hash is wrong:
 *
 *   1. Newline normalisation (HTML §13.2.3.5, input stream preprocessing):
 *      CRLF and lone CR both become LF before tokenising.
 *   2. NUL replacement (HTML §13.2.5.x, script data state): U+0000 becomes
 *      U+FFFD REPLACEMENT CHARACTER.
 *
 *      Rule 2 is not hypothetical here — it is the reason this file exists in
 *      its current form. TanStack serialises route keys into the hydration
 *      payload using U+0000 as a delimiter (`\0_site\0shop`). Hashing the raw
 *      bytes yields a digest no browser ever computes, so the hydration script
 *      is blocked and the page never hydrates. It is invisible to `fetch()` and
 *      to curl, because neither runs the HTML parser — only a real navigation
 *      reveals it.
 *
 * Beyond those two, the text is used verbatim: NOT trimmed, NOT entity-decoded
 * (`<script>` is a raw-text element, so the parser decodes nothing inside it),
 * and digested as UTF-8 bytes.
 *   - `type="application/ld+json"` blocks ARE included: Chrome applies
 *     `script-src` to them, and an unhashed one logs a violation.
 *   - External (`src=`) scripts are skipped — they are covered by `'self'`.
 */
import { createHash } from "node:crypto";

/**
 * Matches a `<script>` element and captures its attributes and raw body.
 * Non-greedy body so adjacent scripts don't merge. `<script>` is a raw-text
 * element: its content cannot contain `</script`, so this cannot under-match.
 */
const SCRIPT_RE = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** True when the tag's attribute string marks it as an external script. */
function isExternal(attrs: string): boolean {
  return /\ssrc\s*=/i.test(attrs);
}

/**
 * Apply the HTML parser transformations that affect a script element's text,
 * so the digest matches what the browser hashes. See the header comment: CRLF/CR
 * → LF (input preprocessing) and U+0000 → U+FFFD (script data state).
 */
function asParsedByBrowser(rawBody: string): string {
  return rawBody.replace(/\r\n?/g, "\n").replaceAll("\u0000", "\uFFFD");
}

/** `'sha256-<base64>'`, the CSP hash-source form, for one script body. */
function hashSource(body: string): string {
  const digest = createHash("sha256").update(asParsedByBrowser(body), "utf8").digest("base64");
  return `'sha256-${digest}'`;
}

/**
 * Extract a CSP hash-source for every INLINE script in `html`.
 *
 * Returns a de-duplicated list (identical scripts appear on many pages — e.g.
 * the shared scroll-restoration bootstrap — and repeating a hash only bloats
 * the header).
 *
 * Returns an EMPTY array if no inline script is found. Callers MUST treat that
 * as "cannot harden this response" and fall back to the permissive policy: a
 * hash policy with no hashes would block every inline script on the page, and
 * because these responses are edge-cached, a single bad render would be served
 * to every visitor until the cache is purged. Failing open here is a deliberate
 * availability choice — the alternative is a self-inflicted outage on the
 * storefront's highest-traffic pages.
 */
export function extractInlineScriptHashes(html: string): string[] {
  const seen = new Set<string>();
  for (const match of html.matchAll(SCRIPT_RE)) {
    const [, attrs = "", body = ""] = match;
    if (isExternal(attrs)) continue;
    // An empty inline script executes nothing and needs no hash.
    if (body.length === 0) continue;
    seen.add(hashSource(body));
  }
  return [...seen];
}
