/**
 * Server-side error monitoring seam — SERVER ONLY.
 *
 * A thin wrapper over @sentry/node that is INERT unless `SENTRY_DSN` is set, so
 * the platform ships dark and the owner activates it by dropping in a DSN (no
 * code change). The SDK is lazy-imported so it never loads when Sentry is off.
 * Init happens once; capture flushes (bounded) because serverless functions can
 * freeze right after returning the response.
 */
import process from "node:process";

let initialized = false;
let sentry: typeof import("@sentry/node") | null = null;

async function ensureInit(): Promise<typeof import("@sentry/node") | null> {
  if (initialized) return sentry;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "production",
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      // Error monitoring only by default; the owner can raise tracing later.
      tracesSampleRate: 0,
    });
    sentry = Sentry;
  } catch {
    sentry = null;
  }
  return sentry;
}

/**
 * Report an unhandled server error. No-op when Sentry is not configured.
 * `context` is attached as non-PII `extra` (callers must not pass PII). Bounded
 * flush so the event survives a serverless freeze; never throws.
 */
export async function captureServerException(
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const s = await ensureInit();
    if (!s) return;
    s.captureException(error, context ? { extra: context } : undefined);
    await s.flush(2000);
  } catch {
    // Monitoring must never break the request path.
  }
}
