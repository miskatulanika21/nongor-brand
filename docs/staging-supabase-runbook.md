# Staging Supabase Runbook

**Purpose.** Give Nongorr a **disposable, isolated** Supabase environment so the
migration-and-order items (#1/#2 client-held guest token + no-rotation replay,
#3 server-verified success receipt, #4 verified product summary) and the full order E2E (place →
success → track → claim → `/orders/:id`) can be built and verified **without ever
touching production**.

> The app's `.env` / `.env.local` currently point at the **production** project
> (`xomjxtmhkglhuiccekld`). Never place a real order, upload payment evidence, or
> run a destructive `db reset`/`db push` against it.

---

## 1. Why this approach (constraints)

| Option                                          | Verdict                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Local stack (`supabase start`)                  | ❌ This PC has **no Docker**. (CI does — that's where `*_db.test.sql` already runs.)                         |
| Supabase **cloud branch** (MCP `create_branch`) | ❌ Paid feature; `confirm_cost` isn't available to the agent here, and the project is free-tier.             |
| **Second free Supabase project** as "staging"   | ✅ **Chosen.** Free tier allows 2 projects. Fully isolated, real cloud (so real HTTPS E2E works), no Docker. |

**What already works without staging:** the `*_db.test.sql` suites +
concurrency tests run in CI on an ephemeral Docker stack (`.github/workflows/ci.yml`,
`migrations-local`). So **candidate migrations for #2/#3/#4 can be validated by
opening a PR** — CI replays every migration and runs the SQL tests. Staging is
for the parts CI can't do: the **browser E2E against a live DB**.

---

## 2. One-time setup

### 2.1 Create the staging project (you, ~2 min)

1. Supabase Dashboard → **New project** → name `nongorr-staging`.
   - **Region: Mumbai (ap-south-1)** to match production (see `[[perf-and-regions]]`).
   - Save the generated **database password**.
2. Project **Settings → API**: copy the **Project URL**, **anon key**, and
   **service_role key**.
3. Project **Settings → General**: copy the **Reference ID** (the
   `abcd…` subdomain).

### 2.2 Fill `.env.staging`

```bash
cp .env.staging.example .env.staging
# then edit .env.staging with the staging URL, anon key, service role key,
# and STAGING_PROJECT_REF (the reference id). .env.staging is gitignored.
```

### 2.3 Link the CLI to staging

```bash
# once per machine — opens a browser to mint an access token:
npx supabase login          # run yourself (interactive)

npm run staging:link        # reads STAGING_PROJECT_REF, refuses the prod ref,
                            # then prompts for the staging DB password
```

The **staging guard** (`scripts/staging-guard.mjs`) now knows the linked ref and
will **block any destructive command that targets production**.

### 2.4 Push the schema

```bash
npm run staging:push        # guard → supabase db push  (replays all migrations)
npm run staging:migrations  # verify parity: every local migration shows Applied
```

> Note: production may report a slightly different applied-migration count than
> the local file list (historical bookkeeping rows). After `staging:push`, confirm
> the schema is equivalent with the `*_db.test.sql` suites (§4) rather than the raw count.

### 2.5 Seed disposable catalog fixtures

The order flow needs at least one buyable product. Point the seed script at
staging (it reads the same env vars the app does):

```bash
# temporary: use staging creds for this shell only. seed-catalog refuses to run
# without SEED_CONFIRM=1 (and, if set, asserts EXPECTED_SUPABASE_REF matches the
# project ref) — this is the guard against accidentally seeding the wrong project.
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role> \
VITE_SUPABASE_URL=<staging-url> \
EXPECTED_SUPABASE_REF=<staging-ref> \
SEED_CONFIRM=1 \
  npm run seed-catalog
```

Provision a staging admin the same way with `npm run provision-admin` if you need
the admin board during E2E.

---

## 3. Running the app against staging (E2E)

Vite env precedence (highest → lowest) is:
`.env.[mode].local` › `.env.[mode]` › `.env.local` › `.env`. So a `.env.staging`
mode file **does** override `.env.local` for the keys it defines — but `.env.local`
is still loaded, so **any key you forget to set in `.env.staging` silently keeps
its production value** (a mixed prod/staging config, which is dangerous). To
remove all ambiguity, don't rely on `--mode staging`; use the explicit full swap
below (and note a stray `.env.local` or `.env.staging.local` could still override
it — the swap sidesteps that entirely):

```bash
# 1. Back up the prod-pointing local env
cp .env.local .env.local.prod.bak

# 2. Point local at staging (all four keys)
cp .env.staging .env.local     # or hand-edit the 4 VITE_/SUPABASE_ keys

# 3. Run and drive the real order E2E
npm run dev                    # http://localhost:8080
#   place order → /order-success → /track (capability pair) → claim → /orders/:id

# 4. ALWAYS restore prod local env when done
mv .env.local.prod.bak .env.local
```

Because staging is a throwaway project, placing real orders, uploading payment
evidence, and creating accounts here is safe. Clean up between runs with
`npm run staging:reset` — this **wipes the DB and replays every migration** (and
runs `supabase/seed.sql` if present). It does **NOT** run the TypeScript catalog
seed (`scripts/seed-catalog.ts`), so **re-run the §2.5 seed command after a
reset** to restore buyable products.

---

## 4. Validating candidate migrations (#2/#3/#4)

Two complementary paths:

- **CI (authoritative, free):** commit the new migration + extend the relevant
  `supabase/tests/*_db.test.sql`, open a PR. The `migrations-local` job replays
  all migrations on a fresh Docker Postgres and runs every SQL suite +
  `concurrency-orders.test.sh`. This is where oversell/coupon/idempotency
  invariants are proven.
- **Staging (for browser E2E):** apply the same migration to staging and drive
  the flow in a real browser.

Apply a candidate migration to staging:

```bash
# add supabase/migrations/<timestamp>_<name>.sql, then:
npm run staging:push
```

Run the SQL suites against staging directly (optional — CI already does this on
Docker). You need the staging DB connection string (Dashboard → Settings →
Database → Connection string, "URI"). The **place_order + client-held-token
replay** contract lives in `pass4_db.test.sql` (§10) with the pricing/coupon
placement in `pass3_db.test.sql`, so run those (each is a self-contained
`BEGIN…ROLLBACK`, so they leave no data behind):

```bash
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pass3_db.test.sql
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pass4_db.test.sql
```

---

## 5. Promoting staging changes to production

Staging is **forward-only**, same as prod. There is **no** `db push` to
production from a developer machine in the normal flow — production migrations
go through the committed-migration + CI + controlled-apply path already in use
(`[[ci-watch-verify-jobs]]`, and the drift rule: a migration applied to prod is
committed in the same session). Do **not** run `npm run staging:*` against prod;
the guard blocks it, but the discipline matters.

> ⚠️ **MCP `apply_migration` version drift → "Supabase Preview" red.** Applying a
> migration through the Supabase MCP tool records it in
> `supabase_migrations.schema_migrations` under the tool's **own** timestamp, not
> your `supabase/migrations/<version>_<name>.sql` filename. The Supabase branching
> "Supabase Preview" check then fails with _"Remote migration versions not found
> in local migrations directory."_ After every MCP `apply_migration`, reconcile
> the recorded version to the repo filename, e.g.
> `UPDATE supabase_migrations.schema_migrations SET version='<file-version>' WHERE name='<name>' AND version='<mcp-version>';`
> Verify remote == local by diffing `schema_migrations.version` against the
> `ls supabase/migrations` timestamps (both counts equal, no orphans either way).

---

## 6. Safety mechanisms in this repo

- `scripts/staging-guard.mjs` — **fails closed**. It passes ONLY when: `.env.staging`
  exists with a well-formed, non-placeholder, non-prod `STAGING_PROJECT_REF`; a
  project is linked whose ref is well-formed, non-prod, and **exactly equals**
  `STAGING_PROJECT_REF`; and `.env.staging`'s `VITE_SUPABASE_URL` resolves to that
  same staging ref (and not the prod ref). Any missing/ambiguous/malformed value
  aborts. Every `staging:*` destructive script runs it first. Unit-tested in
  `src/lib/__tests__/staging-guard.test.ts`.
- `scripts/staging-link.mjs` — refuses the prod/placeholder/malformed ref, invokes
  the CLI **without `shell: true`** (array args → no shell injection), and pins the
  Supabase CLI to the same version CI uses (`2.33.9`).
- `.env.staging` is gitignored; only `.env.staging.example` is committed.

## 7. Teardown

The staging project can sit idle (free tier) or be deleted from the dashboard
when the #2/#3/#4 work lands. Unlink locally with `rm supabase/.temp/project-ref`
(or re-link prod for read-only MCP work).

---

## 8. What you need to do vs. what's already wired

**Already in the repo (this change):** `.env.staging.example`, the guard +
link scripts, `staging:link|guard|push|reset|migrations` npm scripts, and this
runbook.

**Your one-time manual steps:** create the free `nongorr-staging` project (§2.1),
fill `.env.staging` (§2.2), `supabase login` + `npm run staging:link` (§2.3).
After that, `npm run staging:push` and the §3 E2E swap are repeatable.
