/**
 * Client-side error monitoring — INERT unless `VITE_SENTRY_DSN` is set.
 *
 * SSR-safe (no top-level SDK import): it only reads `import.meta.env` and, when
 * a DSN is present, lazy-imports @sentry/react at runtime (client only, from the
 * root component's effect), so the SDK chunk is never fetched by visitors when
 * Sentry is off and never enters the SSR bundle.
 */
let started = false;

export async function initClientObservability(): Promise<void> {
  if (started) return;
  started = true;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Error monitoring only by default (no perf/replay sampling).
      tracesSampleRate: 0,
    });
  } catch {
    // Monitoring must never break the app.
  }
}
