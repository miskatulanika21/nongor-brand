#!/usr/bin/env node
/**
 * Migration ordering / forward-only guard (Stage 7 / P5).
 *
 * A fast, no-secrets structural check on supabase/migrations that runs in CI
 * (the `quality` job) and locally via `bun run check:migrations`. It does NOT
 * connect to any database — the authoritative "does it apply?" check is the
 * `migrations-local` CI job (fresh local stack) and the "does it match prod?"
 * check is the Supabase Preview replay. This guard catches the mistakes those
 * two miss cheaply and instantly:
 *
 *   1. Naming — every file is `<14-digit timestamp>_<snake_name>.sql`. The Supabase
 *      CLI orders migrations lexicographically by this prefix; a malformed name
 *      would apply out of order or be skipped.
 *   2. Monotonic + unique versions — timestamps strictly increase with no
 *      duplicate prefix. A duplicate or out-of-order version is the classic drift
 *      symptom (an older-timestamped migration committed after a newer one never
 *      replays on an already-migrated environment).
 *   3. Forward-only — the repo ships NO down/rollback/revert migrations. Rollback
 *      policy is a *compensating* forward migration (see
 *      docs/stage-7-cicd-and-rollback.md), so a "down"-named file is a policy
 *      violation, not a valid artifact.
 *
 * Exit 0 = clean; exit 1 = a problem is printed with the offending file(s).
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");

const NAME_RE = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
// Reject only the unambiguous DOWN-migration markers. A compensating forward
// migration (the sanctioned way to undo a schema change, e.g. `..._revert_x.sql`)
// is legitimate and must NOT trip this — see docs/stage-7-cicd-and-rollback.md §4b.
// Word-boundary anchored so "cooldown"/"markdown" etc. don't false-positive.
const FORWARD_ONLY_RE = /(^|[_-])(down|rollback)([_.-]|$)/i;

/** @type {string[]} */
const problems = [];

let files;
try {
  files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
} catch (err) {
  console.error(`check-migrations: cannot read ${migrationsDir}: ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error("check-migrations: no migrations found — expected at least one .sql file.");
  process.exit(1);
}

// Sort the way the Supabase CLI does: lexicographically by filename.
files.sort();

const seenVersions = new Map(); // version -> filename
let prevVersion = null;
let prevFile = null;

for (const file of files) {
  const m = NAME_RE.exec(file);
  if (!m) {
    problems.push(`Malformed name: "${file}" — expected <14-digit timestamp>_<snake_case>.sql`);
    continue;
  }
  if (FORWARD_ONLY_RE.test(file)) {
    problems.push(
      `Forward-only violation: "${file}" looks like a down/rollback migration. ` +
        `Ship a compensating forward migration instead (see docs/stage-7-cicd-and-rollback.md).`,
    );
  }
  const version = m[1];
  if (seenVersions.has(version)) {
    problems.push(
      `Duplicate version ${version}: "${file}" collides with "${seenVersions.get(version)}". ` +
        `Two migrations sharing a timestamp prefix apply non-deterministically.`,
    );
  } else {
    seenVersions.set(version, file);
  }
  // Strictly increasing (files are sorted, so a non-increase means a duplicate,
  // already reported above; this guards the invariant explicitly).
  if (prevVersion !== null && version < prevVersion) {
    problems.push(
      `Out-of-order version: "${file}" (${version}) sorts before "${prevFile}" (${prevVersion}).`,
    );
  }
  prevVersion = version;
  prevFile = file;
}

if (problems.length > 0) {
  console.error(`check-migrations: FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}

console.log(
  `check-migrations: OK — ${files.length} migrations, names valid, versions strictly increasing, forward-only.`,
);
