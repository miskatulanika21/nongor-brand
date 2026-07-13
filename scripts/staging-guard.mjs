#!/usr/bin/env node
/**
 * Staging safety guard.
 *
 * The destructive Supabase CLI commands (`db push`, `db reset`) operate on the
 * *currently linked* project. This guard makes it impossible to run them against
 * production by mistake: it reads the linked project ref that the CLI wrote to
 * `supabase/.temp/project-ref` and aborts if it is the production ref — or if it
 * doesn't match the `STAGING_PROJECT_REF` declared in `.env.staging`.
 *
 * Run this BEFORE any destructive staging command (the npm scripts do).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// The production project ref — destructive staging ops must NEVER target it.
const PROD_REF = "xomjxtmhkglhuiccekld";
const LINKED_REF_FILE = resolve("supabase/.temp/project-ref");
const STAGING_ENV = resolve(".env.staging");

function fail(msg) {
  console.error(`\n\x1b[31m✖ staging-guard: ${msg}\x1b[0m\n`);
  process.exit(1);
}

function readEnvVar(file, key) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
  }
  return null;
}

if (!existsSync(LINKED_REF_FILE)) {
  fail(
    "No linked Supabase project found (supabase/.temp/project-ref missing).\n" +
      "  Link your STAGING project first:  npm run staging:link",
  );
}

const linkedRef = readFileSync(LINKED_REF_FILE, "utf8").trim();

if (!linkedRef) fail("Linked project ref is empty — re-link your staging project.");

if (linkedRef === PROD_REF) {
  fail(
    "The CLI is linked to PRODUCTION.\n" +
      "  Destructive staging commands are blocked. Link a disposable staging\n" +
      "  project instead:  npm run staging:link",
  );
}

const declaredStaging = readEnvVar(STAGING_ENV, "STAGING_PROJECT_REF");
if (declaredStaging && declaredStaging !== "YOUR-STAGING-REF" && linkedRef !== declaredStaging) {
  fail(
    `Linked project (${linkedRef}) does not match STAGING_PROJECT_REF ` +
      `(${declaredStaging}) in .env.staging.\n` +
      "  Re-link the correct staging project before continuing.",
  );
}

console.log(
  `\x1b[32m✓ staging-guard: linked to staging project ${linkedRef} (not production)\x1b[0m`,
);
