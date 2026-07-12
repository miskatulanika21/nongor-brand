/**
 * Health / readiness probe — GET /api/health
 *
 * Used by external uptime monitoring and the post-deploy smoke (P5). Checks that
 * the app can reach the database through PostgREST (`api.healthz()`), and returns
 * the build sha + region so a monitor can tell which deployment answered. No auth
 * (it exposes nothing sensitive), no cache, and a short DB timeout so a slow/down
 * database returns `degraded` fast instead of hanging the probe.
 *
 * 200 `{ status: "ok" }` when the DB round-trips; 503 `{ status: "degraded" }`
 * otherwise.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const process = (await import("node:process")).default;
        const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 8) || "dev";
        const region = process.env.VERCEL_REGION ?? "local";

        let dbOk = false;
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
          const env = getPublicSupabaseEnv();
          const sb = createClient(env.supabaseUrl, env.supabaseAnonKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          });
          // Bound the check so a stuck DB fails the probe fast (~3s) not hangs it.
          const probe = sb.schema("api").rpc("healthz");
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("db_timeout")), 3000),
          );
          const { error } = (await Promise.race([probe, timeout])) as { error: unknown };
          dbOk = !error;
        } catch {
          dbOk = false;
        }

        const body = {
          status: dbOk ? "ok" : "degraded",
          db: dbOk,
          region,
          sha,
          ts: new Date().toISOString(),
        };
        return new Response(JSON.stringify(body), {
          status: dbOk ? 200 : 503,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store, max-age=0",
          },
        });
      },
    },
  },
});
