# Stage 1.5 — Operational Closure Follow-up

Companion to `stage-1.5-security-closure-report.md`. That report covered code +
committed migrations; this one records the **live deployment to production**
(`xomjxtmhkglhuiccekld`) on 2026-06-23 via the Supabase MCP, and tracks what
remains.

## Applied & verified live

| Item                                                                                                             | Result                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations 10 & 11 applied                                                                                       | ✅ `stage_1_5_security_closure`, `owner_safety_advisory_lock`                                                                                                                 |
| `api` schema exposed (Data API → Settings → Exposed schemas = `public, graphql_public, api`; `private` excluded) | ✅                                                                                                                                                                            |
| `api.provision_staff` reachable                                                                                  | ✅ REST → `23503` FK violation (routed + delegated, no write)                                                                                                                 |
| `api.update_staff_role` reachable                                                                                | ✅ REST → `P0001` Staff profile not found (pre-mutation)                                                                                                                      |
| `api.set_staff_active` reachable                                                                                 | ✅ REST → `P0001` Staff profile not found (pre-mutation)                                                                                                                      |
| Bug 4 — audit read RLS                                                                                           | ✅ tightened from `owner OR admin` → `owner` only                                                                                                                             |
| Item C — owner-safety advisory lock                                                                              | ✅ deployed; demote/deactivate/delete of last owner all BLOCKED; non-last demotion ALLOWED; lock visible in `pg_locks`                                                        |
| Item D — transactional audit contract                                                                            | ✅ forced audit-FK failure → staff mutation rolled back (`post-failure staff_rows=0`)                                                                                         |
| Migration lineage                                                                                                | ✅ remote ledger versions aligned to the 12 local filenames (incl. a pre-existing `harden_security_definer_functions` 165913→165800 drift; content verified identical)        |
| Security advisors                                                                                                | ✅ `rls_auto_enable` EXECUTE revoked from PUBLIC/anon/authenticated; `set_updated_at` `search_path=''` — both findings cleared (migration `20260623000000_advisor_hardening`) |

Note: all DB-side proofs ran inside self-rolling-back `DO` blocks; no residue
(`staff_rows=2`, `active_owners=1`, `audit_rows=2` unchanged throughout).

## Remaining — tracked, non-blocking for Stage 2 catalog work

1. **Enable leaked-password protection** — Dashboard → Authentication → Password
   protection (HaveIBeenPwned). Dashboard-only; last open security advisor.
2. **Run the migrate-from-empty CI job** (GitHub Actions) — proves all 12
   migrations apply cleanly from a blank DB and ordering is valid. Could not be
   run from the MCP environment. Lineage is now reconciled, which should help.
3. **Rotate credentials at go-live** — `SUPABASE_SERVICE_ROLE_KEY`, `STEADFAST_*`,
   `PATHAO_*`. Deferred per owner decision; escalate to urgent if any of these is
   ever found to have been exposed publicly (service_role bypasses all RLS).
4. **Vendor `rls_auto_enable()` + the `ensure_rls` event trigger into a migration.**
   These exist on the production DB but are created by **no** repo migration
   (pre-existing out-of-band drift). Nothing breaks today — every table migration
   enables RLS explicitly, so migrate-from-empty stays correct — but a from-empty
   deploy lacks the auto-RLS safety net for _future_ tables. The
   `20260623000000_advisor_hardening` REVOKE is guarded with a
   `to_regprocedure(...) IS NOT NULL` check so it applies cleanly with or without
   the function present. Proper fix: add an earlier migration that
   `CREATE OR REPLACE`s the function and `DROP ... IF EXISTS` + `CREATE`s the event
   trigger (would be a production migration → subject to the pre-migration gate).

## Not claimed

- No live **full authenticated E2E** (valid owner identity → CSRF → RBAC → MFA
  step-up → canonical audit on success). That path is covered by the unit/SQL
  test suite, not a single end-to-end run against prod.
- No literal **two-session concurrency race**; the advisory-lock mechanism is
  deployed and verified, serialization follows from Postgres semantics.

## MCP gotcha worth remembering

`apply_migration` stamps its own timestamp version, which drifts from the repo
filename. After applying via MCP, update `supabase_migrations.schema_migrations`
to set the version back to the intended repo filename, or lineage drifts.
