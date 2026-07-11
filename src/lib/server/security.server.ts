/**
 * Security utilities — server-only.
 *
 * CSRF origin checking, PII-safe logging, and generic error responses.
 * The .server.ts suffix ensures none of this ships to the browser.
 */

import { getRequestHeader } from "@tanstack/react-start/server";
import process from "node:process";
import * as nodeCrypto from "node:crypto";

// ---- Allowed origins --------------------------------------------------------

/**
 * Normalize a URL to its full origin (scheme + hostname + port).
 * Returns null if it cannot be parsed. The default port for the scheme is
 * elided by the URL API, so http://h:80 and http://h compare equal.
 */
function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Build the set of trusted origins for the current request context.
 *
 * Always includes the canonical site URL. Additional origins (e.g. a preview
 * domain) are trusted ONLY when explicitly listed in ADDITIONAL_ALLOWED_ORIGINS
 * (comma-separated). Arbitrary origins are never accepted.
 */
export function getAllowedOrigins(siteUrl: string): Set<string> {
  const origins = new Set<string>();
  const canonical = normalizeOrigin(siteUrl);
  if (canonical) origins.add(canonical);

  const extra = process.env.ADDITIONAL_ALLOWED_ORIGINS;
  if (extra) {
    for (const part of extra.split(",")) {
      const normalized = normalizeOrigin(part.trim());
      if (normalized) origins.add(normalized);
    }
  }
  return origins;
}

// ---- CSRF origin check -------------------------------------------------------

/**
 * Verify the request originates from a trusted origin.
 * Call on every state-changing (POST/PUT/DELETE/PATCH) server function.
 *
 * Compares the COMPLETE normalized origin (scheme + hostname + port), not just
 * the hostname — so http vs https or a different port is rejected. A missing
 * Origin AND Referer is rejected (fail closed for mutations). (Spec §28.)
 *
 * @returns true if the origin is trusted, false otherwise.
 */
export function checkCsrfOrigin(siteUrl: string): boolean {
  const allowed = getAllowedOrigins(siteUrl);
  if (allowed.size === 0) return false;

  const origin = getRequestHeader("origin");
  if (origin) {
    const normalized = normalizeOrigin(origin);
    return normalized !== null && allowed.has(normalized);
  }

  // Fallback to Referer if Origin is absent (some privacy browsers strip it).
  const referer = getRequestHeader("referer");
  if (referer) {
    const normalized = normalizeOrigin(referer);
    return normalized !== null && allowed.has(normalized);
  }

  // No Origin or Referer — reject for mutations.
  return false;
}

/**
 * The request's OWN origin, but only when it is in the trusted set — else null.
 *
 * Use for building same-origin redirect/callback URLs (e.g. the OAuth
 * `redirectTo`): flows that set domain-bound cookies (the PKCE code verifier)
 * must complete on the origin the visitor is actually browsing, which may be a
 * trusted alias of the canonical site URL. Never trusts arbitrary origins —
 * the same allowlist as checkCsrfOrigin decides.
 */
export function getTrustedRequestOrigin(siteUrl: string): string | null {
  const allowed = getAllowedOrigins(siteUrl);
  for (const header of ["origin", "referer"] as const) {
    const value = getRequestHeader(header);
    if (!value) continue;
    const normalized = normalizeOrigin(value);
    if (normalized && allowed.has(normalized)) return normalized;
  }
  return null;
}

// ---- Client IP --------------------------------------------------------------

/**
 * Best-effort client IP for rate-limiting keys.
 *
 * TRUST BOUNDARY — read before relying on this value:
 *   These headers are only trustworthy when the app sits behind a proxy that
 *   sets/overwrites them and strips any client-supplied copy. If the app is
 *   ever exposed directly to the internet, ALL of these are client-controlled
 *   and an attacker can forge a unique IP per request, minting unlimited
 *   per-IP rate-limit buckets. Therefore:
 *     - This value is used ONLY as a rate-limit dimension, never for
 *       authorization, and the independent per-ACCOUNT bucket
 *       (checkIndependentRateLimit) is the backstop when the IP is unreliable.
 *     - Prefer the platform-authoritative source. We try, in order:
 *         cf-connecting-ip → Cloudflare sets this and strips client copies.
 *         x-forwarded-for  → trust ONLY the proxy-appended value; we read the
 *                            FIRST hop, correct for a single trusted proxy.
 *                            Behind multiple proxies, configure the platform
 *                            to expose its own authoritative header instead.
 *         x-real-ip        → common single-proxy (nginx) authoritative header.
 *   Operator note: on Vercel use x-vercel-forwarded-for / x-real-ip; on
 *   Cloudflare cf-connecting-ip is authoritative. Do not deploy the Node
 *   server with a raw internet-facing port and trust x-forwarded-for.
 */
export function getClientIp(): string | null {
  const cf = getRequestHeader("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = getRequestHeader("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = getRequestHeader("x-real-ip");
  if (real) return real.trim();

  return null;
}

// ---- Constant-time secret comparison -----------------------------------------

/**
 * Compare two secret strings in constant time (webhook secrets, tokens).
 *
 * Both inputs are SHA-256 hashed first so the buffers passed to
 * `timingSafeEqual` always have equal length — a plain `a !== b` (or a naive
 * timingSafeEqual on unequal-length buffers, which throws) leaks length and
 * prefix-match timing. Hashing makes the comparison length-independent.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const { createHash, timingSafeEqual } = nodeCrypto;
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

// ---- Generic error responses ------------------------------------------------

/**
 * Return a generic error message to the client. Never expose internal
 * details, database errors, or stack traces.
 */
export function genericAuthError(message = "Authentication failed. Please try again."): {
  error: string;
} {
  return { error: message };
}

/**
 * Generic form error that maps to a field.
 */
export function fieldError(
  field: string,
  message: string,
): { fieldErrors: Record<string, string> } {
  return { fieldErrors: { [field]: message } };
}

// ---- PII-safe logging -------------------------------------------------------

/**
 * Redact PII from log entries. Replace email, phone, name with safe tokens.
 * Use this when logging error context that may include user-submitted data.
 */
export function redactPII(input: string): string {
  return (
    input
      // Redact email addresses
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]")
      // Redact Bangladesh phone numbers
      .replace(/(?:\+?880|0)1[3-9]\d{8}/g, "[PHONE_REDACTED]")
      // Redact JWT tokens (they look like three base64 segments)
      .replace(
        /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
        "[JWT_REDACTED]",
      )
  );
}

/**
 * Log a server-side error with PII redaction.
 * Always use this instead of raw console.error for user-facing operations.
 */
export function safeServerLog(
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
): void {
  const safe = redactPII(message);
  const safeContext = context ? JSON.parse(redactPII(JSON.stringify(context))) : undefined;

  switch (level) {
    case "info":
      console.info(`[nongorr] ${safe}`, safeContext ?? "");
      break;
    case "warn":
      console.warn(`[nongorr] ${safe}`, safeContext ?? "");
      break;
    case "error":
      console.error(`[nongorr] ${safe}`, safeContext ?? "");
      break;
  }
}
