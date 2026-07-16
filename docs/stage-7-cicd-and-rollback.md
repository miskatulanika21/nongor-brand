# Stage 7 (P5) — CI/CD, Release Engineering & Rollback Runbook

**Status:** Reference doc + runbook (2026-07-16). The pipeline pieces below are
**live** (CI checks, migration guard, post-deploy smoke). Two items are
**owner-gated one-time setup**, called out inline: (a) turning the current
auto-deploy of `main` into a _gated_ production promotion, and (b) running the
first live rollback drill. Everything else is in force now.

This is the single source of truth for how code reaches production, what gates
it, and how to reverse a bad release. If you change the pipeline, update this
doc.

---

## 1. Pipeline overview

```
   PR opened / push ───► GitHub Actions CI ──────────────┐
                          (4 required checks)             │
                                                          ├─► must be green
   PR branch  ─────────► Vercel Preview deploy ──► smoke ─┘
                                                          │
   merge to main ──────► Vercel Production deploy ─► smoke (post-deploy gate)
```

### The required CI checks (`.github/workflows/ci.yml`)

| Job                  | What it proves                                                                          | Secrets                |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| **quality**          | typecheck, lint, format, unit tests (Vitest), production build, **migration guard**     | none                   |
| **migrations-local** | every migration applies cleanly to a fresh local Supabase stack + REST/DB smoke + races | none                   |
| **supabase-lint**    | `db lint --linked` against the deployed DB (push-only; skips visibly without creds)     | 3 Supabase secrets     |
| **Supabase Preview** | Supabase GitHub integration replays migrations on a preview branch (drift catch)        | managed by integration |

The **migration ordering guard** (`bun run check:migrations`,
`scripts/check-migrations.mjs`) is a step inside `quality`: valid names,
strictly-increasing unique version prefixes, forward-only (no down/rollback
files). It is structural and instant; `migrations-local` proves they _apply_.

### The post-deploy smoke (`.github/workflows/smoke.yml`)

A read-only Playwright suite (`e2e/smoke.spec.ts`, `bun run test:smoke`) fired by
the `deployment_status` event Vercel emits for **every** preview and production
deploy. On a `success` state it smokes the deployment URL:

1. home renders + carries the enforced CSP header
2. `/api/health` is green (app → PostgREST → DB round-trip)
3. catalog reads (facets + a product card from `api.catalog_facets`)
4. pricing engine answers — cart shows a computed ৳ total (`api.quote_order`, STABLE)
5. auth entry page renders

It is **read-only** (GETs + the STABLE `quote_order` RPC), needs **no secrets**,
and is safe against production. It can also be run manually against any URL via
the workflow's `workflow_dispatch` (`url` input) — this is the drill/verify path.

> **Do not** add a write flow to `e2e/smoke.spec.ts`. Write-path E2E belongs in
> the credential-gated specs run against an isolated Supabase branch (see
> `e2e/README.md`).

**Protected previews (owner-gated setup).** Vercel guards **preview**
deployments (and generated URLs) behind SSO by default, so unauthenticated
automation lands on a "Login – Vercel" wall. The production domain
(`nongor-brand.vercel.app`) is public and smokes without any of this. To smoke
protected previews:

1. Vercel → project **nongor-brand** → Settings → **Deployment Protection** →
   **Protection Bypass for Automation** → generate the secret.
2. Mirror it as a GitHub Actions repo secret named
   `VERCEL_AUTOMATION_BYPASS_SECRET`.

The smoke then sends it as the `x-vercel-protection-bypass` header and reaches
the real app. **Until the secret is set, the workflow SKIPS a protected preview**
(with an actionable notice) rather than failing red — production smoke is
unaffected.

---

## 2. Deploy model & production promotion

**Current reality:** Vercel's Git integration is wired so **`main` deploys
straight to Production** (production branch = `main`); PR branches get Preview
deployments. So today a merge to `main` _is_ the promotion — the post-deploy
smoke runs against prod immediately after, and goes red on the commit if the
deployment is unhealthy (detect-fast, not prevent).

**Recommended gated promotion (owner-gated setup).** To make production a
deliberate, reversible step gated on green checks + green preview smoke, pick
ONE:

- **Option A — Vercel-native (simplest).** In Vercel → project **nongor-brand** →
  Settings → Git, keep previews on PRs but treat `main` as a staging/preview
  target, and use **"Promote to Production"** on a healthy, smoke-green preview
  deployment from the Vercel dashboard (one click). Rollback is the same UI.
- **Option B — Actions-gated `vercel --prod`.** Disable Vercel's automatic
  production deploy for `main`; add a protected workflow that, after the 4 CI
  checks + preview smoke pass, runs `vercel pull && vercel build --prod && vercel
deploy --prebuilt --prod` using a `VERCEL_TOKEN` repo secret. More control, more
  moving parts.

Until one is enabled, **the gate is human:** do not merge to `main` unless CI is
green and the PR's preview smoke passed. The smoke workflow makes that state
visible on every PR.

---

## 3. Migration / deploy ordering rule

This bit us once (2026-06-30 drift), so it is a hard rule:

> **A migration applied to any hosted database MUST be committed in the same
> session, before the next push.** Never leave prod ahead of `main`.

Ordering for a change that touches both code and schema:

1. Write the migration as a new `supabase/migrations/<timestamp>_<name>.sql`
   (forward-only — see §4). Never edit an already-applied migration.
2. Prove it locally: `supabase start` (or the `migrations-local` job) applies it
   to a fresh DB; run the relevant `supabase/tests/*.test.sql`.
3. Commit code + migration together. Push → CI + Supabase Preview replay.
4. Apply to production DB (`supabase db push --linked`, or the staging→prod flow)
   **and confirm the commit is already on `main`.**
5. `bun run check:migrations` (runs in CI) guards the structural invariants.

**Parity check.** CI cannot diff against prod without live creds, so parity is
enforced by the layered checks above (local-apply + Preview replay + the guard) plus
this checklist. To spot-check drift manually: compare `supabase migration list
--linked` against `ls supabase/migrations` — they must match exactly.

---

## 4. Rollback runbook

**App rollback and DB rollback are SEPARATE procedures.** A bad release usually
needs only the app rollback. Touch the database only if the release shipped a
migration that is itself the problem.

### 4a. App rollback (seconds — the default)

The app is stateless on Vercel; reverting is instant and safe.

1. **Vercel dashboard** → project **nongor-brand** → **Deployments**.
2. Find the last-known-good production deployment (green, pre-incident).
3. **⋯ → Promote to Production** (a.k.a. "Rollback to this deployment"). Prod
   serves it within seconds — no rebuild.
4. Verify: run **Post-deploy smoke** via `workflow_dispatch` against
   `https://nongor-brand.vercel.app`, and hit `/api/health` (check the `sha` in
   the JSON matches the rolled-back commit).
5. In git: revert the bad commit(s) on `main` (`git revert`) so the tree matches
   what's serving. Do **not** leave prod pinned to an old deployment while `main`
   still carries the bad code.

CLI equivalent: `vercel rollback <deployment-url>` (with `VERCEL_TOKEN`).

### 4b. Database rollback (forward-only)

**We never run `down` migrations.** Schema is forward-only. To undo a schema
change, ship a **compensating migration** that reverses it:

1. Write a new `<timestamp>_revert_<what>.sql` that restores the prior shape
   (e.g. re-add a dropped column, restore a function's previous body). Follow the
   §3 ordering rule.
2. Prove it locally, commit, push, apply to prod.
3. This keeps history linear and replayable — every environment reaches the same
   state by rolling _forward_.

> The guard (`check:migrations`) intentionally **rejects** files whose name
> carries a `down` or `rollback` marker — a compensating migration is a normal
> forward migration with a descriptive name (e.g. `_revert_`, which is allowed),
> not a Supabase-style "down".

### 4c. Data-loss break-glass (PITR) — last resort

For _data_ corruption (not schema shape), a compensating migration can't recover
deleted/overwritten rows. That path is **Point-In-Time Recovery**, documented in
the P6 backup/DR runbook (Supabase is on the Free tier today → PITR requires a
plan upgrade; until then the break-glass is the scheduled `pg_dump` restore). See
`docs/stage-7-backup-and-dr.md` (P6). Escalate to the owner before any restore —
it is destructive and affects all data written since the restore point.

### 4d. Rollback drill (owner-gated — run once)

To satisfy the P5 exit criterion, perform once and record the result here:

1. On a PR/preview (never prod), ship a trivial reversible change + a trivial
   compensating migration.
2. Practice: Vercel promote-to-previous (app) + apply the compensating migration
   (DB) on a Supabase branch.
3. Record RTO (how long the app rollback took) below.

_Drill log:_ **not yet executed** — pending owner run.

---

## 5. Release notes / changelog convention

Every production promotion must be traceable to a commit range + its migrations.

- **Conventional commits** (already in use): `feat(...)`, `fix(...)`, `docs:`,
  `chore:` — the prefix and scope make the range self-describing.
- **Per release**, capture: the commit range (`git log <prev-prod-sha>..<new-sha>
--oneline`), the list of new migrations in that range, and any owner actions
  required (env flips, dashboard toggles).
- The deployed `sha` is always visible at `/api/health` (`sha` field) — use it to
  identify exactly what production is serving when writing notes or debugging.
- Tag notable releases: `git tag -a v<date> -m "<summary>"`.

---

## 6. Quick reference

| Task                       | Command / action                                                       |
| -------------------------- | ---------------------------------------------------------------------- |
| Run smoke locally          | `E2E_BASE_URL=<url> bun run test:smoke`                                |
| Run smoke in CI (manual)   | Actions → **Post-deploy smoke** → Run workflow → paste URL             |
| Check migration structure  | `bun run check:migrations`                                             |
| What's serving in prod?    | `curl -s https://nongor-brand.vercel.app/api/health` → `sha`, `region` |
| App rollback               | Vercel → Deployments → last good → Promote to Production               |
| DB "rollback"              | Ship a compensating forward migration (§4b)                            |
| Prod↔repo migration parity | `supabase migration list --linked` vs `ls supabase/migrations`         |

Related: `docs/stage-7-hardening-launch-plan.md` (P5), `docs/stage-7-secrets-and-rotation.md`,
`docs/stage-7-backup-and-dr.md` (P6, forthcoming), `e2e/README.md`.
