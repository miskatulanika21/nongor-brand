/**
 * Supabase admin/service-role client — server-only.
 *
 * Uses the SERVICE_ROLE key which bypasses RLS.
 * Use ONLY for narrowly defined system operations:
 *   - Owner/admin provisioning
 *   - Database seeding/migration helpers
 *   - Audit log writes where the caller has already been authorized
 *
 * NEVER use for routine customer, staff, or admin requests.
 * NEVER import this file from anything that touches the client bundle.
 *
 * The .server.ts suffix prevents bundling into the client.
 */
import { createClient } from "@supabase/supabase-js";
import { getPrivilegedSupabaseEnv } from "./env.server";

/**
 * Create a Supabase admin client with service-role privileges.
 *
 * This client bypasses RLS. Every call site must document WHY
 * the service-role client is necessary.
 *
 * @returns A Supabase client with full database access.
 */
export function createAdminSupabaseClient() {
  const env = getPrivilegedSupabaseEnv();

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      // No browser session management — this is a server-only admin client.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
