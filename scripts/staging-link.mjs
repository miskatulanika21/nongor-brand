#!/usr/bin/env node
/**
 * Links the Supabase CLI to your STAGING project using STAGING_PROJECT_REF from
 * `.env.staging`. Refuses the production ref and any malformed/placeholder ref.
 * The Supabase CLI will prompt for the database password interactively — run
 * this yourself in a real terminal (it inherits stdio).
 *
 * Security: the CLI is invoked WITHOUT `shell: true` and with array arguments,
 * so the project ref can never be interpreted by a shell (no injection). The ref
 * is additionally format-validated before use. The CLI version is pinned to the
 * SAME version CI uses (supabase/setup-cli) so local links match CI exactly.
 *
 * Prereqs: `supabase login` (once) so the CLI has an access token.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { isValidStagingRef, PROD_REF, readEnvVar } from "./staging-guard.mjs";

// Keep in lockstep with .github/workflows/ci.yml (SUPABASE_CLI_VERSION).
const SUPABASE_CLI_VERSION = "2.33.9";
const STAGING_ENV = resolve(".env.staging");

function fail(msg) {
  console.error(`\n\x1b[31m✖ staging-link: ${msg}\x1b[0m\n`);
  process.exit(1);
}

if (!existsSync(STAGING_ENV)) {
  fail("Missing .env.staging — copy .env.staging.example to .env.staging and fill it in.");
}

const ref = readEnvVar(STAGING_ENV, "STAGING_PROJECT_REF");

if (ref === PROD_REF) {
  fail("STAGING_PROJECT_REF is the PRODUCTION ref. Use a separate disposable project.");
}
if (!isValidStagingRef(ref)) {
  fail(
    "STAGING_PROJECT_REF is missing, a placeholder, or malformed (expected 20 lowercase\n" +
      "  alphanumerics). Set it in .env.staging to your staging project ref first.",
  );
}

console.log(`Linking Supabase CLI (v${SUPABASE_CLI_VERSION}) to staging project: ${ref}`);
// No shell: args are passed as an array, so `ref` (already format-validated) is
// never parsed by a shell. `npx` resolves to npx.cmd on Windows.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const res = spawnSync(
  npx,
  ["-y", `supabase@${SUPABASE_CLI_VERSION}`, "link", "--project-ref", ref],
  { stdio: "inherit", shell: false },
);
if (res.error) fail(`Failed to launch the Supabase CLI: ${res.error.message}`);
process.exit(res.status ?? 1);
