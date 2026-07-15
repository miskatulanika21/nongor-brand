#!/usr/bin/env node
/**
 * Staging safety guard — FAIL CLOSED.
 *
 * The destructive Supabase CLI commands (`db push`, `db reset`) operate on the
 * *currently linked* project. This guard makes it impossible to run them against
 * production by mistake. It refuses to pass unless EVERY one of these holds:
 *
 *   • `.env.staging` exists and declares a well-formed STAGING_PROJECT_REF that
 *     is NOT the placeholder and NOT the production ref;
 *   • a project is linked (supabase/.temp/project-ref) with a well-formed ref
 *     that is NOT production and EXACTLY equals STAGING_PROJECT_REF;
 *   • `.env.staging` declares a VITE_SUPABASE_URL whose project ref is a valid
 *     Supabase URL, is NOT production, and matches STAGING_PROJECT_REF.
 *
 * Any missing/ambiguous/placeholder/malformed value aborts. Nothing is trusted
 * by default — the guard opens the gate only when staging is proven.
 *
 * The core `evaluateStagingGuard` is a pure function (unit-tested in
 * src/lib/__tests__/staging-guard.test.ts); the CLI wrapper below just reads
 * the files and reports.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The production project ref — destructive staging ops must NEVER target it. */
export const PROD_REF = "xomjxtmhkglhuiccekld";
/** Supabase project refs are exactly 20 lowercase alphanumeric characters. */
export const REF_RE = /^[a-z0-9]{20}$/;
const PLACEHOLDER_REFS = new Set(["", "your-staging-ref"]);

/** True for a syntactically valid, non-production, non-placeholder project ref. */
export function isValidStagingRef(ref) {
  if (typeof ref !== "string") return false;
  const r = ref.trim();
  if (PLACEHOLDER_REFS.has(r.toLowerCase())) return false;
  if (!REF_RE.test(r)) return false;
  if (r === PROD_REF) return false;
  return true;
}

/** Extract the project ref from a Supabase URL (https://<ref>.supabase.co). */
export function projectRefFromUrl(url) {
  if (typeof url !== "string") return null;
  const m = url.trim().match(/^https?:\/\/([a-z0-9]{20})\.supabase\.[a-z.]+/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pure guard decision. Returns { ok: true, ref } or { ok: false, error }.
 * @param {{ linkedRef: string|null, declaredRef: string|null, supabaseUrl: string|null }} input
 */
export function evaluateStagingGuard({ linkedRef, declaredRef, supabaseUrl }) {
  const err = (error) => ({ ok: false, error });

  // 1) Declared staging ref must exist and be a real, non-prod, non-placeholder ref.
  if (declaredRef == null || declaredRef.trim() === "") {
    return err(
      "Missing .env.staging or STAGING_PROJECT_REF. Copy .env.staging.example to\n" +
        "  .env.staging and set STAGING_PROJECT_REF to your disposable staging project.",
    );
  }
  const declared = declaredRef.trim();
  if (PLACEHOLDER_REFS.has(declared.toLowerCase())) {
    return err("STAGING_PROJECT_REF is still the placeholder — set your real staging ref.");
  }
  if (!REF_RE.test(declared)) {
    return err(
      `STAGING_PROJECT_REF (${declared}) is malformed (expected 20 lowercase alphanumerics).`,
    );
  }
  if (declared === PROD_REF) {
    return err("STAGING_PROJECT_REF is the PRODUCTION ref. Use a separate disposable project.");
  }

  // 2) A project must be linked, with a real, non-prod ref that matches the declaration.
  if (linkedRef == null || linkedRef.trim() === "") {
    return err(
      "No linked Supabase project (supabase/.temp/project-ref missing/empty).\n" +
        "  Link your STAGING project first:  npm run staging:link",
    );
  }
  const linked = linkedRef.trim();
  if (!REF_RE.test(linked)) {
    return err(`Linked project ref (${linked}) is malformed — re-link your staging project.`);
  }
  if (linked === PROD_REF) {
    return err(
      "The CLI is linked to PRODUCTION. Destructive staging commands are blocked.\n" +
        "  Link a disposable staging project instead:  npm run staging:link",
    );
  }
  if (linked !== declared) {
    return err(
      `Linked project (${linked}) does not match STAGING_PROJECT_REF (${declared}).\n` +
        "  Re-link the correct staging project before continuing.",
    );
  }

  // 3) The app URL in .env.staging must point at the SAME staging project.
  if (supabaseUrl == null || supabaseUrl.trim() === "") {
    return err("Missing VITE_SUPABASE_URL in .env.staging (must be your staging project URL).");
  }
  const urlRef = projectRefFromUrl(supabaseUrl);
  if (!urlRef) {
    return err(`VITE_SUPABASE_URL (${supabaseUrl.trim()}) is not a valid Supabase project URL.`);
  }
  if (urlRef === PROD_REF) {
    return err("VITE_SUPABASE_URL points at PRODUCTION. Set it to your staging project URL.");
  }
  if (urlRef !== declared) {
    return err(
      `VITE_SUPABASE_URL project ref (${urlRef}) does not match STAGING_PROJECT_REF (${declared}).`,
    );
  }

  return { ok: true, ref: linked };
}

// ── env parsing ──────────────────────────────────────────────────────────────
/** Read a single KEY=value from a dotenv-style file (or null if absent). */
export function readEnvVar(file, key) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
  }
  return null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function runCli() {
  const LINKED_REF_FILE = resolve("supabase/.temp/project-ref");
  const STAGING_ENV = resolve(".env.staging");

  const linkedRef = existsSync(LINKED_REF_FILE)
    ? readFileSync(LINKED_REF_FILE, "utf8").trim()
    : null;
  const declaredRef = readEnvVar(STAGING_ENV, "STAGING_PROJECT_REF");
  const supabaseUrl = readEnvVar(STAGING_ENV, "VITE_SUPABASE_URL");

  const result = evaluateStagingGuard({ linkedRef, declaredRef, supabaseUrl });
  if (!result.ok) {
    console.error(`\n\x1b[31m✖ staging-guard: ${result.error}\x1b[0m\n`);
    process.exit(1);
  }
  console.log(
    `\x1b[32m✓ staging-guard: linked to staging project ${result.ref} (not production)\x1b[0m`,
  );
}

// Only run the CLI when executed directly — importing for tests has no side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
