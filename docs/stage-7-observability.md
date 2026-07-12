# Stage 7 (P3) — Observability & Error Monitoring

**Date:** 2026-07-13. What's wired, how to turn it on, and how to verify.

## What ships in the code

1. **Health / readiness probe — `GET /api/health`.** Returns
   `{ status, db, region, sha, ts }`: `200 {status:"ok"}` when it can round-trip
   the database via `api.healthz()` (migration `20260712171719`), `503
{status:"degraded"}` otherwise (with a 3s DB timeout so it fails fast). No
   auth, no cache. Used by external uptime monitoring + the P5 post-deploy smoke.
   Verified locally: `ok`/200 with env, `degraded`/503 without DB.

2. **Error monitoring — Sentry, INERT until a DSN is set.**
   - **Client** (`@sentry/react`, `src/lib/observability.ts`): initialized once
     from the root component's effect, only when `VITE_SENTRY_DSN` is set. The
     SDK chunk is lazy-loaded, so visitors never fetch it when Sentry is off.
   - **Server** (`@sentry/node`, `src/lib/server/observability.server.ts`):
     `captureServerException()` reports unhandled SSR errors from both error
     paths in `src/server.ts` (the outer catch and the h3-swallowed-500 path),
     tagged with the release (commit sha). Bounded flush so events survive a
     serverless freeze. No-op when `SENTRY_DSN` is unset.
   - **CSP**: the Sentry ingest host (`https://*.sentry.io`) is added to
     `connect-src` **only** when `VITE_SENTRY_DSN` is set (both the enforced and
     the strict Report-Only policies).
   - Error monitoring only by default (`tracesSampleRate: 0`, no replay) — cheap,
     stays inside the free tier.

   **Design note:** we deliberately did NOT adopt the official
   `@sentry/tanstackstart-react` SDK, because its setup replaces `src/server.ts`
   with a `wrapFetchWithSentry` wrapper — and our `server.ts` holds the
   security-critical CSP-nonce pipeline, security headers, and error-page logic.
   The lean `@sentry/react` + `@sentry/node` integration plugs into that entry
   without rewriting it, and avoids the `--import` flag Sentry itself flags as
   broken on Vercel. Server capture was verified end-to-end against the real DSN.

## Owner setup (to activate)

1. **Add the DSN to Vercel env** (Project → Settings → Environment Variables),
   both set to the Sentry project DSN:
   - `SENTRY_DSN` (server)
   - `VITE_SENTRY_DSN` (client — this is public by design; it ships to the browser)
     Redeploy. Sentry is now live; nothing else is required.

2. **Uptime monitoring (recommended):** point an external monitor
   (Sentry Crons/Uptime, BetterStack, UptimeRobot, or Vercel's own) at
   **`https://<domain>/api/health`** and the homepage. Alert when `/api/health`
   is non-200 or the homepage is down. This is the "site down" signal.

3. **Alerting:** in Sentry, set an issue alert (email/Slack) for a new-issue or
   error-rate spike. Route it wherever you watch (email is fine to start).

## Optional follow-ups (not launch-blocking)

- **Source-map upload** (readable server stack traces instead of minified):
  `npm i -D @sentry/vite-plugin`, enable `build.sourcemap`, add the
  `sentryVitePlugin({ org:"nongorr", project:"…", authToken:
process.env.SENTRY_AUTH_TOKEN })` as the last Vite plugin, and set
  `SENTRY_AUTH_TOKEN` (a Sentry internal-integration token) in the build env.
  Gated on the token so it's a no-op without it. Deferred to keep the current
  green build untouched until it can be verified with the token.
- **Structured request-id logging** and an **admin dead-letter / webhook-failure
  tile** (surfacing the outbox + webhook health on the admin dashboard) are
  listed in the Stage-7 plan for P3 but deferred as non-launch-blocking; the
  existing `safeServerLog` already gives greppable, PII-safe server logs.

## How to verify (after adding the DSN)

- Hit `https://<domain>/api/health` → expect `{"status":"ok"}` 200.
- Trigger a client error (or use Sentry's "Break the world" test button) and a
  server 500 → both appear in the Sentry Issues feed within moments, tagged with
  the release sha.
