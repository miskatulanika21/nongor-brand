#!/usr/bin/env node
/**
 * Links the Supabase CLI to your STAGING project using STAGING_PROJECT_REF from
 * `.env.staging`. Refuses the production ref outright. The Supabase CLI will
 * prompt for the database password interactively — run this yourself in a real
 * terminal (it inherits stdio).
 *
 * Prereqs: `supabase login` (once) so the CLI has an access token.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROD_REF = "xomjxtmhkglhuiccekld";
const STAGING_ENV = resolve(".env.staging");

function fail(msg) {
  console.error(`\n\x1b[31m✖ staging-link: ${msg}\x1b[0m\n`);
  process.exit(1);
}

if (!existsSync(STAGING_ENV)) {
  fail("Missing .env.staging — copy .env.staging.example to .env.staging and fill it in.");
}

let ref = null;
for (const line of readFileSync(STAGING_ENV, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*STAGING_PROJECT_REF\s*=\s*(.*)\s*$/);
  if (m) ref = m[1].replace(/^["']|["']$/g, "").trim();
}

if (!ref || ref === "YOUR-STAGING-REF") {
  fail("Set STAGING_PROJECT_REF in .env.staging to your staging project ref first.");
}
if (ref === PROD_REF) {
  fail("STAGING_PROJECT_REF is the PRODUCTION ref. Use a separate disposable project.");
}

console.log(`Linking Supabase CLI to staging project: ${ref}`);
const res = spawnSync("npx", ["supabase", "link", "--project-ref", ref], {
  stdio: "inherit",
  shell: true,
});
process.exit(res.status ?? 1);
