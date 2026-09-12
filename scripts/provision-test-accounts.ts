/** Creates fresh QA accounts ONLY on a separately configured staging project. */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { evaluateStagingGuard } from "./staging-guard.mjs";

async function main() {
  // Never inherit the production .env or shell credentials.
  const env = dotenv.parse(readFileSync(".env.staging", "utf8"));
  const linkedFile = "supabase/.temp/project-ref";
  const guard = evaluateStagingGuard({
    declaredRef: env.STAGING_PROJECT_REF ?? null,
    linkedRef: existsSync(linkedFile) ? readFileSync(linkedFile, "utf8").trim() : null,
    supabaseUrl: env.VITE_SUPABASE_URL ?? null,
  });
  if (!guard.ok) throw new Error(guard.error);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing staging service-role key");
  const output = ".env.e2e.local";
  writeFileSync(output, "# Staging QA credentials; never commit\n", { flag: "wx", mode: 0o600 });
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const runId = randomBytes(8).toString("hex");
  for (const role of ["customer", "staff", "admin", "owner"] as const) {
    const email = `qa-${role}-${runId}@nongorr.invalid`;
    const password = `${randomBytes(32).toString("base64url")}aA1!`;
    const prefix = `E2E_${role.toUpperCase()}`;
    // Persist recovery credentials even if provisioning later fails.
    writeFileSync(output, `${prefix}_EMAIL=${email}\n${prefix}_PASSWORD=${password}\n`, {
      flag: "a",
      mode: 0o600,
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Staging QA ${role}` },
    });
    if (error || !data.user) throw new Error(`Could not create staging ${role} account`);
    writeFileSync(output, `${prefix}_USER_ID=${data.user.id}\n`, { flag: "a", mode: 0o600 });
    if (role !== "customer") {
      const { error: staffError } = await admin.schema("api").rpc("provision_staff", {
        p_user_id: data.user.id,
        p_role: role,
        p_display_name: `Staging QA ${role}`,
        p_actor_id: null,
        p_is_active: true,
      });
      if (staffError) throw new Error(`Could not provision staging ${role} access`);
    }
  }
  console.log(`Staging QA accounts created. Credentials saved only in ${output}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "QA provisioning failed");
  process.exitCode = 1;
});
