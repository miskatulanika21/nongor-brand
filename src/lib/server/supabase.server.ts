/**
 * Supabase SSR server client — per-request.
 *
 * Creates a Supabase client bound to the current request's cookies.
 * Uses the ANON key — all queries respect RLS for the logged-in user.
 *
 * Call this inside createServerFn handlers or beforeLoad.
 * NEVER cache or share instances across requests.
 *
 * The .server.ts suffix prevents bundling into the client.
 */
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";
import { getPublicSupabaseEnv, isProduction } from "./env.server";

/**
 * Create a per-request Supabase server client with cookie-based auth.
 *
 * Reads auth cookies from the incoming request and writes refreshed
 * tokens back via Set-Cookie. The `setCookie` from TanStack Start
 * handles multiple Set-Cookie headers correctly.
 *
 * Uses only the public/anon key — normal auth must not require the
 * service-role key.
 */
export function createServerSupabaseClient() {
  const env = getPublicSupabaseEnv();

  return createSupabaseServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        const cookies = getCookies();
        return Object.entries(cookies).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, {
            ...options,
            // Security: always set these regardless of what Supabase SSR suggests
            httpOnly: true,
            sameSite: "lax" as const,
            secure: isProduction(),
            path: "/",
          });
        }
      },
    },
  });
}
