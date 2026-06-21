/**
 * Supabase browser client — singleton.
 *
 * Uses the VITE_ prefixed (public) variables.
 * This client is for browser-side auth flows ONLY (login, signup, session).
 * It must NEVER access business tables directly — all data queries go through
 * createServerFn handlers that use the server client.
 *
 * The publishable anon key is safe for the browser.
 * The secret/service-role key must NEVER appear here.
 */
import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Get the shared Supabase browser client.
 *
 * Uses cookie-based session storage via @supabase/ssr.
 * The client reads auth tokens from cookies set by the server.
 */
export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " + "Check your .env file.",
    );
  }

  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return browserClient;
}
