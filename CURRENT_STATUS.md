# CURRENT_STATUS — Nongorr Studio

Authoritative record of verified project state. Code and live-environment
behavior are the source of truth; this file is updated after every stage.

_Last updated: 2026-06-25 — Stage 1.5 operationally closed; Stage 2 public read
(Pass 1) + admin product/category/inventory writes (Pass 2) implemented, hardened
and CI-green. Follow-up patch: stable inventory error codes + staff_profiles RLS
perf advisors cleared + movement-FK covering index. **Stage 2 Pass 3a: review
moderation + automatic rating/review_count sync (DB-backed, server-authoritative).**
21 migrations applied to the live project; remote ledger matches the 21 repo files._

State legend: **(1) code complete · (2) migration applied · (3) deployed
verification complete · (4) operator action pending.**

## Stage status

| Stage        | Scope                                                                                                            | Status                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1            | Auth, RBAC, CSRF, headers, rate limit, MFA scaffold, audit, owner-safety                                         | Implemented                                                              |
| 1.5          | Security closure (4 bugs + A–E + follow-up hardening)                                                            | **Operationally closed** (migrations applied; `api` exposed; proofs run) |
| 2 (Pass 1)   | DB-backed **public catalog read** path                                                                           | Implemented + live                                                       |
| 2 (Pass 2)   | Admin **product / category / inventory** writes (DB-backed + hardened)                                           | **Implemented + live + CI-green**                                        |
| 2 (Pass 3a)  | **Reviews moderation + rating/review_count sync** (DB-backed)                                                    | **Implemented + live + CI-green**                                        |
| 2 (Pass 3b+) | Customer review submission (persist); media library (Storage); facets/counts; settings; delete legacy `PRODUCTS` | Not started                                                              |
| 3            | Server-authoritative checkout, orders, payments                                                                  | Not started                                                              |
| 4            | Customer accounts / addresses / measurements                                                                     | Not started (localStorage)                                               |
| 5            | Courier adapters, shipments, webhooks, outbox                                                                    | Not started                                                              |
| 6            | Banners, CMS, contact, newsletter, reports, settings                                                             | Not started (mock)                                                       |
| 7            | Hardening, perf/a11y, CI/CD, backups                                                                             | Not started                                                              |

## Migrations (live project xomjxtmhkglhuiccekld)

**21 migrations**, all applied; the remote `supabase_migrations.schema_migrations`
ledger matches the 21 repo files exactly (versions + names), in order:

```
…143927 create_private_schema            …623000000 advisor_hardening
…143948 create_staff_profiles            …623100000 vendor_rls_auto_enable
…144004 create_current_staff_role_fn     …623200000 inventory_movements
…144019 create_audit_logs                …623210000 inventory_hardening
…144036 create_provision_admin_function  …623220000 bulk_set_inventory
…150547 fix_staff_profiles_rls_recursion …623230000 catalog_write_rpcs
…165800 harden_security_definer_functions…623240000 pass2_closure
…621090000 staff_provisioning_and_owner_safety   …625120000 inventory_stable_error_codes
…622000000 catalog_schema                …625130000 staff_rls_perf_and_fk_index
…622120000 stage_1_5_security_closure    …625140000 reviews_moderation_and_rating_sync
…622130000 owner_safety_advisory_lock
```

Note: `apply_migration` (MCP) stamps its own version, so after every MCP apply the
ledger version is realigned to the repo filename in a **standalone** statement
(never bundled with a proof DO-block, whose final `RAISE` would roll the realign
back). Always confirm with `supabase migration list`.

## Stage 1.5 — operational closure (done)

- Migrations applied; `api` schema exposed in PostgREST (Data API → Settings;
  `private` stays hidden). All three staff RPC wrappers verified reachable via REST.
- Owner-safety concurrency (advisory lock) and the transactional audit-rollback
  contract verified via rolled-back SQL proofs.
- Security advisors: cleared except `auth_leaked_password_protection` (Auth
  dashboard toggle — enable before broader auth use). `rls_auto_enable`/`ensure_rls`
  vendored into a migration.
- Performance advisors (2026-06-25): `auth_rls_initplan` and
  `multiple_permissive_policies` on `staff_profiles` cleared by merging the two
  permissive SELECT policies into one (`staff_select_self_or_admin`) with
  `(select auth.uid())` / `(select private.current_staff_role())`;
  `unindexed_foreign_keys` cleared by `idx_movements_actor`. Remaining advisors:
  two INFO `rls_enabled_no_policy` on `inventory_bulk_ops` /
  `product_inventory_movements` — **intentional**: these are written only by
  SECURITY DEFINER RPCs, so deny-all-with-no-policy is the correct posture; and
  INFO `unused_index` (no production traffic yet).
- Deferred (owner): credential rotation (go-live); leaked-password protection toggle.

## Stage 2 Pass 2 — admin write path (done, hardened)

Every catalog mutation flows through one hardened path (`guardAdminWrite`: CSRF +
strict permission + MFA step-up + per-IP/account rate limit + audited denial),
validated by isomorphic zod schemas that mirror the DB CHECKs, and audited.

**Inventory is canonical and tamper-resistant (verified by rolled-back SQL proofs):**

- `products.stock` is writable **only** through `api.set_inventory` — a DB trigger
  rejects any other stock-changing UPDATE.
- `api.set_inventory`: `SELECT … FOR UPDATE` product lock (serializes all variant
  changes), actor required + active-staff check, enforces sized vs non-sized (never
  invents size rows), rejects zero-delta, bounded inputs; writes the movement +
  canonical `inventory.adjusted` audit in one transaction.
- `product_inventory_movements`: append-only (UPDATE/DELETE blocked by trigger);
  product deletion blocked while history exists (FK `ON DELETE RESTRICT`).
- Variants created/removed only via `api.add_product_variant` / `remove_product_variant`.
- Bulk: `api.bulk_set_inventory` — bounded 1..100, idempotent (op_key replay), one
  auth + one rate-limit charge, structured partial-success; replaces the old
  client `Promise.all`.
- **Stable error codes (2026-06-25 patch):** every inventory RPC raises a
  machine-readable snake_case CODE as the exception message (human context in
  DETAIL). The single-op path throws `InventoryError(code)`; the bulk path
  forwards the inner code as `error_code` (no more fragile `SQLERRM ILIKE`
  matching). `inventoryErrorMessage()` lives in the isomorphic
  `catalog-admin.schema.ts`, so the admin UI now surfaces granular per-item bulk
  reasons too — previously every failure collapsed to a generic message.
  Asserted by `pass2_db.test.sql` §11 (message_text == code) + Vitest.

**Product/category writes:** transactional canonical audit via `api.save_product`,
`api.set_product_status`, `api.save_category`, `api.set_category_active`,
`api.delete_category`, `api.reorder_categories` (atomic single-statement reorder).
Product `code` is an independent immutable id (never `code=slug`). Product stock is
read-only in the editor. Permanent product delete/bulk-delete removed from the UI —
normal removal is **Archive**. Privileged GET handlers set `private, no-store`.

## Stage 2 Pass 3a — review moderation + rating sync (done, live)

- **Rating sync trigger** (`product_reviews` AFTER INSERT/UPDATE/DELETE) keeps
  `products.rating = round(avg(approved),1)` and `review_count = count(approved)`
  for **every** write path (moderation, seeding, future customer submissions).
  Writes only rating/review_count, so the stock write-guard is respected.
  Verified by rolled-back SQL proof + `pass2_db.test.sql` §12.
- **Moderation RPCs** (service-role only): `api.set_review_status` (idempotent),
  `api.delete_review` — active-staff check, stable snake_case error codes
  (`actor_not_authorized`/`review_not_found`/`invalid_status`), canonical
  `review.status_changed`/`review.deleted` audit; trigger does the resync.
- **Admin UI** `admin.reviews.tsx` is now DB-backed (was mock): pending-first
  queue, status filter + counts, approve/reject/move-to-pending/delete via
  `guardAdminWrite("reviews.manage")`, granular error toasts. `reviewErrorMessage`
  lives in the isomorphic schema module.

## Real vs mock (data flow)

**Real / persistent (DB-backed):** auth, staff RBAC (`staff_profiles`), audit logs;
public catalog read (`product_*`); **admin product/category writes**; **inventory
(ledger + stock)**; **review moderation + product rating/review_count**.

**Still mock / localStorage (later passes):** customer review _submission_ (the
product-page form is still ephemeral — moderation/sync of existing rows is live);
media library; category facets/counts (`categories.ts`) + legacy `PRODUCTS` array
(still exported until a later pass removes it); orders, cart, wishlist, checkout,
coupons; payments; customer profiles/addresses/measurements; courier; banners, CMS,
contact, newsletter, reports, settings.

## CI (honest)

`ci.yml` runs (genuinely): frozen Bun install, typecheck, lint, format, test, build,
**migrate-from-empty** (boots a local Supabase, applies all 21 migrations to a blank
DB), and **DB integration tests** (`pass2_db.test.sql` — stock write-guard,
set_inventory validation, ledger immutability, FK RESTRICT, first-variant
conservation, owner-only purge, reorder validation, bulk idempotency, actor-deletion
restriction, grant verification, post-migration schema proof, the merged RLS policy

- FK index, stable error-code assertions, and review moderation + rating sync). The **linked deployed-DB lint step runs** in CI (using `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_PASSWORD` repository secrets). This lints the deployed live database structure against recommendations.

## Outstanding follow-ups

1. Enable leaked-password protection (Auth dashboard) before broader auth use.
2. Rotate exposed credentials before go-live.
3. Deployed DB lint configured and running in CI.
4. DB integration tests are automated in CI (`pass2_db.test.sql`); a genuine
   two-connection concurrency test (`concurrency.test.sh`) also runs in the
   `migrations-local` job. True multi-session advisory-lock races are verified.
5. Stage 2 Pass 3b+: persist customer review submission; media (Storage),
   facets/counts, settings, remove `PRODUCTS`.
