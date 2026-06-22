# CURRENT_STATUS — Nongorr Studio

Authoritative record of verified project state. Code and live-environment
behavior are the source of truth; this file is updated after every stage.

_Last updated: 2026-06-23 (Stage 1.5 CODE CLOSURE complete — four bugs + items
A–E + follow-up hardening patch; OPERATIONAL CLOSURE pending: 2 migrations to
apply, schema exposure, credential rotation, MFA rollout, concurrency/rollback/
header proofs)._

State legend: **(1) code complete · (2) migration applied · (3) deployed
verification complete · (4) operator action pending.**

> **Stage 2 is NOT yet safe to begin.** Stage 1.5 code closure is complete, but
> operational closure (live migrations, deployed verification, credential
> rotation, MFA rollout) and review/acceptance of this follow-up patch remain.

## Follow-up security hardening patch (2026-06-23)

Code-complete (1); covered by tests; no new migration (all code/CI/docs):

| #   | Fix                                                                                                                                                                              | Tests                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Env-validation latch records success only AFTER validation (no bypass on prior throw); moved to `env.server.ensureEnvValidated()`                                                | `env-validation.test.ts`                  |
| 2   | `updateStaffRole`/`setStaffActive` authorize baseline admin BEFORE the privileged target lookup (no existence oracle); owner elevation via already-resolved role                 | `staff-authz.test.ts`                     |
| 3   | MFA enrollment: rate-limited, AAL2 required to add a factor when one is verified, stale unverified factors cleaned up, initiation/denial/failure audited (no secret/QR in audit) | `mfa-enroll.test.ts`                      |
| 4   | `authz.denied` (and identity/rbac denials) carry the verified actor id; `null` only when unauthenticated                                                                         | `identity.test.ts`, `staff-authz.test.ts` |
| 5   | CI: `SUPABASE_DB_PASSWORD` added to linked-lint credential gate; new `migrations-local` job applies all migrations to a fresh local DB                                           | CI (runs on push/PR)                      |
| 6   | Pinned Bun (`1.3.14`) and Supabase CLI (`2.33.9`) — no `latest`                                                                                                                  | —                                         |
| 7   | Operator scripts (`provision-admin.ts`, `e2e-auth-test.ts`) use `admin.schema("api").rpc(...)`; redundant direct `staff_profiles` write removed                                  | —                                         |
| 8   | Header-failure comment no longer claims an absolute "never unprotected" guarantee                                                                                                | `headers.test.ts`                         |

## Reproducible command output (this commit)

| Command            | Result                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| `tsc --noEmit`     | clean                                                                       |
| `eslint .`         | 0 errors, 31 warnings (pre-existing `react-refresh/only-export-components`) |
| `prettier --check` | clean                                                                       |
| `vitest run`       | 211 passed / 18 files                                                       |
| `vite build`       | success                                                                     |

## Stage status

| Stage       | Scope                                                                    | Status                                                         |
| ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1           | Auth, RBAC, CSRF, headers, rate limit, MFA scaffold, audit, owner-safety | Implemented                                                    |
| 1.5         | Security closure (4 bugs + A–E + follow-up hardening)                    | **Code closure complete (1); operational closure pending (4)** |
| 2 (Pass 1)  | DB-backed **public catalog read** path                                   | Implemented + applied to live project                          |
| 2 (Pass 2+) | Admin catalog/inventory/media/settings **writes**                        | Not started                                                    |
| 3           | Server-authoritative checkout, orders, payments                          | Not started                                                    |
| 4           | Customer accounts / addresses / measurements                             | Not started (localStorage)                                     |
| 5           | Courier adapters, shipments, webhooks, outbox                            | Not started                                                    |
| 6           | Reviews, banners, CMS, contact, newsletter, reports, settings            | Not started (mock)                                             |
| 7           | Hardening, perf/a11y, CI/CD, backups                                     | Not started                                                    |

## Stage 1.5 — items

| Item                                        | Code (1) | Live status                                 |
| ------------------------------------------- | -------- | ------------------------------------------- |
| Bug 1 — staff RPC `api` wrappers            | Done     | (2) pending migration apply + expose `api`  |
| Bug 2 — invite confirm type                 | Done     | (3) pending real-email E2E                  |
| Bug 3 — AAL2 step-up (gated)                | Done     | (3) pending MFA rollout                     |
| Bug 4 — audit RLS owner-only                | Done     | (2) pending migration apply                 |
| A — security-header Response rebuild        | Done     | (3) pending `curl -I` on deployed origin    |
| B — independent IP/account rate limits      | Done     | no live step; covered by tests              |
| C — owner-safety advisory lock              | Done     | (2)+(3) pending migration apply + SQL proof |
| D — transactional critical audit (verified) | Done     | (3) pending SQL rollback proof on live      |
| E — CI pipeline                             | Done     | active on next push/PR                      |

See `docs/stage-1.5-security-closure-report.md` for detail, SQL excerpts, the
Item C concurrency procedure, and the Item D rollback proof.

## Real vs mock (data flow)

**Real / persistent (DB-backed):** auth, staff RBAC roles (`staff_profiles`),
audit logs (`audit_logs`); public catalog read (`product_*` tables) — storefront,
PDP, search, sitemap.

**Still mock / localStorage-only (Phase 2 scope):** admin catalog writes; orders,
cart, wishlist, checkout state, coupons; payment screenshots/TrxID; customer
profiles, saved addresses, saved measurements; courier, reviews moderation,
banners, CMS, contact, newsletter, reports, site settings; business contact
placeholders.

## Migrations

**11 local** migration files in `supabase/migrations/`. **9 applied** to the live
project: the 8 Stage 1 files (`…143927` → `…090000`) and
`20260622000000_catalog_schema.sql`. **2 pending apply:**

- `20260622120000_stage_1_5_security_closure.sql` — `api` wrappers (Bug 1) +
  audit RLS owner-only (Bug 4)
- `20260622130000_owner_safety_advisory_lock.sql` — owner-guard advisory lock
  (Item C); documents the Item D transactional contract

After both are applied the synchronized count is **11**, subject to the
documented filename drift on the harden migration (`…165800` local vs `…165913`
remote, identical body). Repo files do not prove remote application — always
confirm with `supabase migration list`.

## Outstanding (owner / operator) actions

1. Apply both pending migrations; expose the `api` schema in PostgREST (keep
   `private` hidden); confirm 11 synchronized.
2. `curl -I` the deployed origin to confirm security headers (Item A).
3. Run the Item C concurrency SQL procedure and the Item D rollback proof.
4. Rotate & revoke all Stage 1-committed credentials; complete MFA rollout, then
   set `ENFORCE_ADMIN_MFA=true`.
