/**
 * Safe end-to-end auth smoke test.
 *
 * SAFETY CONTRACT (spec §36):
 *   - Refuses to run unless E2E_ALLOW=1 AND a dedicated non-production project
 *     is indicated by E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY /
 *     E2E_SUPABASE_ANON_KEY (NOT the app's normal VITE_/SERVICE_ROLE vars).
 *   - Never touches permanent accounts. Every identity it creates uses a random
 *     email + random strong password and is deleted in a finally block.
 *   - Never sets a known password on any existing account.
 *   - Does not run against production.
 *
 * It exercises the real running app over HTTP when E2E_BASE_URL is set
 * (recommended), and always verifies the core auth/role/RLS behavior directly
 * against the dedicated test Supabase project.
 *
 * Usage:
 *   E2E_ALLOW=1 \
 *   E2E_SUPABASE_URL=https://<test-project>.supabase.co \
 *   E2E_SUPABASE_ANON_KEY=... \
 *   E2E_SUPABASE_SERVICE_ROLE_KEY=... \
 *   [E2E_BASE_URL=http://localhost:8080] \
 *   npx tsx scripts/e2e-auth-test.ts
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// ---- Guard rails ------------------------------------------------------------

if (process.env.E2E_ALLOW !== "1") {
  console.error(
    "Refusing to run: set E2E_ALLOW=1 and point E2E_SUPABASE_* at a DEDICATED, NON-PRODUCTION project.",
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error(
    "Missing E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

// Extra guard: never allow the test project to equal the app's configured project.
if (SUPABASE_URL === process.env.VITE_SUPABASE_URL) {
  console.error("Refusing to run: E2E_SUPABASE_URL must differ from the app's VITE_SUPABASE_URL.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- Helpers ----------------------------------------------------------------

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function randomEmail(): string {
  return `e2e+${randomUUID()}@example.test`;
}
function randomPassword(): string {
  // Strong, random, meets privileged policy.
  return `Aa1${randomUUID().replace(/-/g, "")}!`;
}

interface TempUser {
  id: string;
  email: string;
  password: string;
}

const createdUserIds: string[] = [];

async function createTempUser(opts: {
  staffRole?: "staff" | "admin" | "owner";
  active?: boolean;
}): Promise<TempUser> {
  const email = randomEmail();
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUserIds.push(data.user.id);

  if (opts.staffRole) {
    const { error: rpcError } = await admin.rpc("provision_staff", {
      p_user_id: data.user.id,
      p_role: opts.staffRole,
      p_display_name: "E2E Temp",
      p_actor_id: null,
      p_is_active: opts.active ?? true,
    });
    if (rpcError) throw new Error(`provision_staff failed: ${rpcError.message}`);
    if (opts.active === false) {
      await admin.from("staff_profiles").update({ is_active: false }).eq("user_id", data.user.id);
    }
  }

  return { id: data.user.id, email, password };
}

function anon(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---- Tests ------------------------------------------------------------------

async function main() {
  console.log("\n🔐 Nongorr — Safe Auth E2E (dedicated test project)\n");

  // 1. Customer (no staff profile) authenticates and has no staff row.
  const customer = await createTempUser({});
  {
    const c = anon();
    const { data, error } = await c.auth.signInWithPassword({
      email: customer.email,
      password: customer.password,
    });
    assert("Customer login succeeds", !error && !!data.session);
    const { data: profile } = await c
      .from("staff_profiles")
      .select("*")
      .eq("user_id", customer.id)
      .maybeSingle();
    assert("Customer has no staff profile", !profile);
    await c.auth.signOut();
  }

  // 2. Wrong password fails generically.
  {
    const c = anon();
    const { error } = await c.auth.signInWithPassword({
      email: customer.email,
      password: "definitely-wrong",
    });
    assert("Wrong password rejected", !!error);
  }

  // 3. Active owner has the correct active staff profile.
  const owner = await createTempUser({ staffRole: "owner", active: true });
  {
    const c = anon();
    const { data } = await c.auth.signInWithPassword({
      email: owner.email,
      password: owner.password,
    });
    const { data: profile } = await c
      .from("staff_profiles")
      .select("role, is_active")
      .eq("user_id", owner.id)
      .maybeSingle();
    assert(
      "Owner has active owner profile",
      !!profile && profile.is_active === true && profile.role === "owner",
    );
    if (data.session) await c.auth.signOut();
  }

  // 4. Inactive staff: profile exists but is_active = false (must NOT be customer).
  const inactive = await createTempUser({ staffRole: "staff", active: false });
  {
    const { data: profile } = await admin
      .from("staff_profiles")
      .select("is_active")
      .eq("user_id", inactive.id)
      .maybeSingle();
    assert("Inactive staff profile is is_active=false", !!profile && profile.is_active === false);
  }

  // 5. RLS: a customer cannot read other staff rows.
  {
    const c = anon();
    await c.auth.signInWithPassword({ email: customer.email, password: customer.password });
    const { data: rows } = await c.from("staff_profiles").select("*");
    assert("RLS hides staff rows from customer", !rows || rows.length === 0);
    await c.auth.signOut();
  }

  // 6. Owner-safety: last active owner cannot be demoted (DB trigger).
  {
    const { error } = await admin
      .from("staff_profiles")
      .update({ role: "admin" })
      .eq("user_id", owner.id);
    assert("Last active owner cannot be demoted", !!error, error ? undefined : "update succeeded");
  }

  // 7. Optional: exercise the running app's login endpoint if a base URL is set.
  if (process.env.E2E_BASE_URL) {
    try {
      const res = await fetch(`${process.env.E2E_BASE_URL}/login`, { redirect: "manual" });
      assert("App /login responds", res.status < 500, `status ${res.status}`);
    } catch (err) {
      assert("App /login reachable", false, err instanceof Error ? err.message : "unknown");
    }
  }

  console.log(`\n${"═".repeat(48)}`);
  console.log(`  TOTAL ${passed + failed} | ✅ ${passed} | ❌ ${failed}`);
  console.log(`${"═".repeat(48)}\n`);

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : "unknown");
    process.exitCode = 1;
  })
  .finally(async () => {
    // Always clean up every disposable identity, even on failure.
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
    console.log(`🧹 Cleaned up ${createdUserIds.length} disposable test identities.`);
  });
