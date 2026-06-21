/**
 * Security utilities — server-only.
 *
 * CSRF origin checking, PII-safe logging, and generic error responses.
 * The .server.ts suffix ensures none of this ships to the browser.
 */

import { getRequestHeader } from "@tanstack/react-start/server";
import process from "node:process";

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

// ---- Client IP --------------------------------------------------------------

/**
 * Best-effort client IP for rate-limiting keys.
 *
 * Prefers Cloudflare's trusted cf-connecting-ip, then the first hop of
 * x-forwarded-for, then x-real-ip. Returns null if none are present. Used
 * only as a rate-limit dimension, never for authorization.
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
