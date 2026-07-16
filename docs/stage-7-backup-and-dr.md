# Stage 7 (P6) — Backup, Restore & Disaster-Recovery Runbook

**Status:** Runbook + working tooling (2026-07-16). The backup and restore-drill
**pipelines are built and wired** (`.github/workflows/backup.yml`,
`restore-drill.yml`, `scripts/backup-*`); the storage backup is **verified live**
against prod. Three items are **owner-gated one-time setup** (repo secrets),
called out in §7 — without them the backup runs in a reduced, safe mode.

This is the single source of truth for how Nongorr's data is protected and how to
recover it. If you change what's stored or how it's backed up, update this doc.

---

## 1. What we're protecting & the backup posture

Supabase is on the **Free tier**, which provides **no automated backups and no
PITR**. So we run our own **off-Supabase logical backup** on a schedule.

| Data                                                                           | Re-derivable?           | Backed up by                                                  |
| ------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------- |
| Postgres — `public` / `api` / `private` (catalog, orders, coupons, CMS, audit) | ❌                      | `backup.yml` → `scripts/backup-db.sh` (roles + schema + data) |
| Postgres — customer identities (`auth.users`, `auth.identities`)               | ❌                      | same (dumped so `orders.user_id` FKs restore)                 |
| Storage — `payment-evidence` (bKash/Nagad screenshots, **private**)            | ❌                      | `backup.yml` → `scripts/backup-storage.mjs`                   |
| Storage — `product-media` (**public**)                                         | ✅ from `public/assets` | not backed up by default (`--include-media` to opt in)        |

**Backup mechanism:** `.github/workflows/backup.yml`, daily at 02:17 UTC
(~07:47 Asia/Dhaka). It produces a logical dump (`roles.sql`, `schema.sql`,
`data.sql` in COPY form, `auth.sql`) + the storage snapshot + a manifest, then
**GPG-symmetric-encrypts** the bundle (AES-256) and uploads it as a GitHub
artifact retained **30 days**.

> **Safe by default:** if `BACKUP_ENCRYPTION_PASSPHRASE` is not set, the job
> archives **only** the non-sensitive `roles.sql` + `schema.sql` and warns —
> customer data/PII is never uploaded unencrypted. Set the passphrase (§7) for a
> full backup.

**RPO (recovery-point objective):** ≤ **24h** (daily cadence). Tighten by raising
the schedule frequency if order volume grows.

---

## 2. Restore drill (the deliverable) — `restore-drill.yml`

> "A backup you've never restored is not a backup."

`.github/workflows/restore-drill.yml` runs **weekly (Mon 03:30 UTC)** and on
demand. Each run:

1. Dumps prod via the exact backup path (`scripts/backup-db.sh`).
2. Boots a **throwaway local Supabase stack** (managed base + repo migrations).
3. Restores the dump into it — `session_replication_role = replica` disables FK
   checks + triggers, so cross-schema FKs (`orders → auth.users`) and load order
   don't matter; app data (`data.sql`) is strict, auth data is best-effort
   (GoTrue schema can drift between prod and the pinned CLI).
4. Runs read-only invariants (`supabase/tests/restore_verify.sql`): schemas,
   core tables, the 4 `api` RPCs and RLS are present; the catalog came back; and
   `api.catalog_facets()` executes against the restored rows.
5. Records **RTO** (restore + load seconds) in the run summary.

A green drill continuously proves the real backup mechanism restores. Run it
manually any time: **Actions → Restore drill → Run workflow**.

**RTO (recovery-time objective):** the app is stateless (Vercel), so app recovery
is seconds; **data** recovery = dump + restore time, tracked by the drill summary
plus the manual full-restore below.

---

## 3. Manual full restore (real DR — into a fresh Supabase project)

The drill restores into a local stack; a real recovery restores into a **new
Supabase project**. Steps:

1. Create a new Supabase project (same region, **ap-south-1 / Mumbai**, to match
   latency and keep Vercel `bom1` co-located).
2. Decrypt the backup:
   `gpg --decrypt backup-<stamp>.tgz.gpg > backup.tgz && tar xzf backup.tgz`.
3. Restore in order against the new project's connection string (`$DB_URL`):
   ```sh
   psql "$DB_URL" -f roles.sql      # cluster roles
   psql "$DB_URL" -f schema.sql     # DDL (public/api/private)
   psql "$DB_URL" -f auth.sql       # customer identities
   psql "$DB_URL" -f data.sql       # row data
   ```
4. Restore Storage: re-upload `storage/payment-evidence/**` to the new project's
   bucket (create the private `payment-evidence` bucket first; `product-media` is
   re-derivable from `public/assets`).
5. Expose the `api` schema (Dashboard → API settings) and re-point the app:
   update Vercel env `VITE_SUPABASE_URL` / keys, redeploy.
6. Verify: `/api/health` green, run **Post-deploy smoke** (`workflow_dispatch`)
   against the app, spot-check a real order + customer.

---

## 4. Storage backup detail

`scripts/backup-storage.mjs` (service-role) recursively lists + downloads a
bucket and writes `manifest.json` (path, size, etag, lastModified, contentType).
Default target is **`payment-evidence`** only (the non-re-derivable one).
Verified live against prod (recurses the `YYYY/MM/` layout, handles an empty
bucket). `product-media` is re-derivable and opt-in (`--include-media`).

Ad-hoc snapshot:
`SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-storage.mjs --out ./snap`

---

## 5. Data export / deletion (customer requests)

Everything is RPC-only, so both paths are well-defined:

- **Deletion** — `api.delete_account` (Stage 7 P1, migration `20260712060140`):
  anonymizes the customer's orders to guest ownership (records preserved, XOR
  intact, tracking hash rotated), writes an `account.deleted` audit, and removes
  `auth.users` (cascading profile/addresses/measurements/wishlist). Surfaced in
  `/account/security`. This is the GDPR-style erasure path.
- **Export** — with the service role, gather the customer's rows for portability:
  ```sql
  -- given :uid
  select to_jsonb(p) from public.profiles p where p.id = :uid;
  select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.orders o where o.user_id = :uid;
  -- addresses, measurements, wishlist likewise by user_id
  ```
  Deliver as JSON. (A dedicated `api.export_account` RPC is a future nicety; the
  data is already isolated by `user_id`, so the manual query is sufficient today.)

---

## 6. DR decision tree

| Scenario                                               | First move                                                                                        | Then                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Bad migration shipped** (schema wrong, app erroring) | App: Vercel instant rollback to the previous deployment (see `stage-7-cicd-and-rollback.md` §4a). | DB: ship a **compensating forward migration** (§4b there). No data loss → **no restore needed**.                                   |
| **Prod DB corrupt / data lost**                        | Stop writes (put the app in maintenance / rollback to a safe deploy).                             | Restore latest backup into a **new project** (§3). RPO ≤ 24h. Re-point app env, redeploy, verify.                                  |
| **Storage bucket wiped** (`payment-evidence`)          | Don't panic — orders/rows are intact in Postgres; only the screenshots are gone.                  | Re-upload from the latest `storage/payment-evidence/**` backup (§3.4). `product-media` → re-run media upload from `public/assets`. |
| **Region / Supabase outage**                           | App: Vercel keeps serving cached/SSR where possible; `/api/health` returns `degraded`.            | If prolonged: stand up a new project from backup in another region (§3), re-point env. Communicate status to customers.            |

**Who to call:** the owner (project holder) makes the restore/cut-over call — a
restore into a new project changes the live database and is not reversible mid-flight.

---

## 7. Owner-gated setup (repo secrets)

Add these so the pipelines run at full capability:

| Secret / var                                 | Where         | Purpose                                    | Without it                                |
| -------------------------------------------- | ------------- | ------------------------------------------ | ----------------------------------------- |
| `SUPABASE_URL` (repo **variable** or secret) | GitHub        | project API URL for the storage backup     | storage backup skips (warns)              |
| `SUPABASE_SERVICE_ROLE_KEY`                  | GitHub secret | read the private `payment-evidence` bucket | storage backup skips (warns)              |
| `BACKUP_ENCRYPTION_PASSPHRASE`               | GitHub secret | AES-256 key for the data-bearing archive   | backup archives only roles+schema (warns) |

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` already
exist (used by the CI Supabase-lint job) and drive the DB dump + drill.

**Guard the passphrase:** store it somewhere independent of GitHub (a password
manager). If GitHub and the passphrase are lost together, the encrypted backups
are unrecoverable — that's the point of encryption, but it means the key must
survive separately.

---

## 8. Exit criteria (P6)

- [x] Written runbook (this doc) with the 4-scenario DR decision tree.
- [x] Backup tooling built: DB dump + storage backup (**storage verified live**).
- [x] Automated, scheduled **restore drill** that restores + verifies + records RTO.
- [ ] First green drill run recorded (owner: run **Restore drill** once the secrets in §7 are set; paste the RTO here).
- [ ] Backup secrets configured (§7).

Related: `docs/stage-7-cicd-and-rollback.md` (P5 rollback), `docs/stage-7-hardening-launch-plan.md` (P6),
`docs/stage-7-secrets-and-rotation.md`.
