# CURRENT_STATUS — Nongorr Studio

Authoritative record of verified project state. Code and live-environment
behavior are the source of truth; this file is updated after every stage.

_Last updated: 2026-06-26 — Stage 1.5 operationally closed; Stage 2 public read
(Pass 1) + admin product/category/inventory writes (Pass 2) implemented, hardened
and CI-green. Follow-up patch: stable inventory error codes + staff_profiles RLS
perf advisors cleared + movement-FK covering index. **Stage 2 Pass 3a: review
moderation + rating/review_count sync; Pass 3b: authenticated customer review
submission (persisted + moderated); Pass 3c: DB-backed catalog facets & counts
(shop filter sidebar); Pass 3d: DB-backed site settings (announcement bar live +
audited admin settings); Pass 3e: Storage-backed media library (real uploads via
signed URLs).** 25 migrations applied to the live project; remote ledger matches
the 25 repo files._

State legend: **(1) code complete · (2) migration applied · (3) deployed
verification complete · (4) operator action pending.**

## Stage status

| Stage        | Scope                                                                    | Status                                                                   |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1            | Auth, RBAC, CSRF, headers, rate limit, MFA scaffold, audit, owner-safety | Implemented                                                              |
| 1.5          | Security closure (4 bugs + A–E + follow-up hardening)                    | **Operationally closed** (migrations applied; `api` exposed; proofs run) |
| 2 (Pass 1)   | DB-backed **public catalog read** path                                   | Implemented + live                                                       |
| 2 (Pass 2)   | Admin **product / category / inventory** writes (DB-backed + hardened)   | **Implemented + live + CI-green**                                        |
| 2 (Pass 3a)  | **Reviews moderation + rating/review_count sync** (DB-backed)            | **Implemented + live + CI-green**                                        |
| 2 (Pass 3b)  | **Authenticated customer review submission** (persisted + moderated)     | **Implemented + live + CI-green**                                        |
| 2 (Pass 3c)  | **DB-backed catalog facets & counts** (shop filter sidebar)              | **Implemented + live + CI-green**                                        |
| 2 (Pass 3d)  | **DB-backed site settings** (announcement bar live; audited admin form)  | **Implemented + live + CI-green**                                        |
| 2 (Pass 3e)  | **Storage-backed media library** (real uploads via signed URLs)          | **Implemented + live + CI-green**                                        |
| 2 (Pass 3f+) | Attach library media to product galleries; delete legacy `PRODUCTS`      | Not started                                                              |
| 3            | Server-authoritative checkout, orders, payments                          | Not started                                                              |
| 4            | Customer accounts / addresses / measurements                             | Not started (localStorage)                                               |
| 5            | Courier adapters, shipments, webhooks, outbox                            | Not started                                                              |
| 6            | Banners, CMS, contact, newsletter, reports, settings                     | Not started (mock)                                                       |
| 7            | Hardening, perf/a11y, CI/CD, backups                                     | Not started                                                              |

## Migrations (live project xomjxtmhkglhuiccekld)

**25 migrations**, all applied; the remote `supabase_migrations.schema_migrations`
ledger matches the 25 repo files exactly (versions + names), in order:

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
…622130000 owner_safety_advisory_lock    …626120000 review_submission
                                          …626130000 catalog_facets
                                          …626140000 site_settings
                                          …626150000 media_library
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

## Stage 2 Pass 3b — customer review submission (done, live)

- **Authenticated only.** `submitReview` (customer server fn) enforces CSRF +
  a verified signed-in session (`getAuthenticatedIdentity`, else `requiresAuth`)
  - per-IP/account `reviewSubmit` rate limit, then calls `api.submit_review`.
- **`api.submit_review`** (SECURITY DEFINER, service-role only): verifies the
  user, requires the product be **publicly visible**, bounds-checks input,
  enforces **one review per user per product** (`product_reviews.user_id` +
  partial unique index), inserts as **`pending`**, writes a `review.submitted`
  audit. New stable codes: `product_not_visible`/`already_reviewed`/
  `invalid_rating`/`invalid_author`/`invalid_body`.
- Submitted reviews flow into the Pass 3a moderation queue; the public rating is
  untouched until an admin approves. Product-page form persists (was ephemeral).
- Verified by rolled-back SQL proof + `pass2_db.test.sql` §13 + Vitest.

## Stage 2 Pass 3c — DB-backed catalog facets & counts (done, live)

- The shop filter sidebar (category counts, colours, fabrics, occasions) was
  derived from the legacy mock `PRODUCTS` array, so it drifted from reality once
  an admin added or archived a product. It is now a **database read**.
- **`api.catalog_facets()`** (`STABLE`, `SECURITY DEFINER`, `search_path=''`):
  aggregates over the **publicly-visible** catalog (explicit `status='active'` +
  active-category predicate, so it returns the same set under anon-RLS and under
  the superuser psql CI role). Returns jsonb: per-DB-category `{slug,name,count}`
  plus `colors`/`fabrics`/`occasions` as `{value,count}` ordered by frequency.
  `REVOKE…FROM public; GRANT EXECUTE TO anon, authenticated, service_role` — it is
  a public read, unlike the service-role-only write RPCs.
- **App:** `fetchCatalogFacets` (`catalog.server.ts`) → `getCatalogFacets` server
  fn; `_site.shop.tsx` loads cards + facets in parallel and renders DB facets.
  `catalog-facets.ts` holds the isomorphic type + defensive `normalizeFacets`
  (a malformed payload degrades to an empty facet set, never crashes the loader).
  `rollupCategoryCounts` (in `categories.ts`) collapses the three cosmetics
  product types into the single "Cosmetics" facet. The hard-coded
  `COLORS`/`FABRICS`/`OCCASIONS` arrays and the `PRODUCTS`-derived `categoryCount`
  were removed.
- Verified by rolled-back SQL proof + `pass2_db.test.sql` §14 (counts == visible;
  draft + inactive-category rows excluded; grants) + Vitest (268 total).

## Stage 2 Pass 3d — DB-backed site settings (done, live)

- Single-row `public.site_settings` (RLS deny-all, RPC-only — same posture as the
  inventory tables) with bounded CHECKs covering store/announcement/delivery/
  contact/policies and **admin-only** payment fields. Three RPCs:
  - `api.get_public_settings()` — anon/authenticated, jsonb **without** payment
    secrets (drives the storefront).
  - `api.get_admin_settings(actor)` — service-role + active-staff, full row.
  - `api.save_settings(patch, actor)` — service-role + active-staff,
    **CASE-presence patch** (so a nullable field can be cleared), table CHECKs
    enforce bounds (a raw out-of-bounds call → 23514 → `invalid_settings`),
    canonical `settings.updated` audit (records the changed keys) in-txn.
- **Storefront:** the header announcement bar is now DB-driven — `_site`
  `beforeLoad` reads `get_public_settings` (in parallel with the session summary)
  and passes an `AnnouncementState` (`hidden` / `custom` / `fallback`) to
  `SiteHeader`. On a read failure or empty text it keeps the static line, so the
  bar never vanishes on a transient error.
- **Admin:** `admin.settings.tsx` is now a real DB-backed, persisting form (Store /
  Payment / Delivery / Contact / Announcement / Policies) behind
  `guardAdminWrite("settings.manage")`; payment fields are admin-only.
  `settings.schema.ts` is the isomorphic type/validation/normalisation module.
- `brand.ts` remains the static default (deeply embedded in SSR meta / JSON-LD).
  Delivery/contact/policy values persist + audit + appear in the public
  projection; checkout pricing still reads `checkout-ui.ts` until Stage 3 consumes
  them. Verified by rolled-back SQL proof + `pass2_db.test.sql` §15 + Vitest.

## Stage 2 Pass 3e — Storage-backed media library (done, live)

- A real Supabase Storage bucket `product-media` (public read, 5 MB limit, image
  mime allowlist) + a `public.media_assets` catalogue (RLS deny-all, RPC-only).
- **Upload is a signed-URL flow** (the binary never passes through the app
  server): `requestMediaUpload` (service-role) mints a one-time signed upload URL
  scoped to a generated path; the browser PUTs the file straight to Storage (the
  bucket enforces size + mime); `registerMedia` then records the row via
  `api.register_media` (idempotent upsert on path, `media.uploaded` audit).
  Deletes go through `api.delete_media` (row + `media.deleted` audit) then a
  best-effort Storage object removal. `api.list_media` returns assets newest-first
  with a **real product-usage count** (LEFT JOIN `product_media` on URL).
- **App:** `media.schema.ts` (isomorphic types, `mediaStoragePath`,
  `validateMediaFile`, row mapping); `media.server.ts` (service-role signed-URL +
  RPCs, `MediaError`); `media.api.ts` (`listMedia` via `requirePermission`;
  `requestMediaUpload`/`registerMedia`/`removeMedia` via
  `guardAdminWrite("media.manage")`). `admin.media-library.tsx` is now a real
  DB-backed grid/list with true upload + delete (was a `PRODUCTS`-derived mock).
- **Deferred (Pass 3f):** attach library media to a product's gallery (the product
  editor has no gallery UI yet); retire the legacy `PRODUCTS` array.
- Verified by rolled-back SQL proof + `pass2_db.test.sql` §16 (bucket public,
  register/upsert/delete/audit, usage count, grants) + Vitest. The one path CI
  cannot exercise is the actual browser file PUT to Storage (the bucket config is
  the server-side guarantee for size/mime).

## Real vs mock (data flow)

**Real / persistent (DB-backed):** auth, staff RBAC (`staff_profiles`), audit logs;
public catalog read (`product_*`); **admin product/category writes**; **inventory
(ledger + stock)**; **review moderation + product rating/review_count**;
**customer review submission** (authenticated → pending → moderated); **shop
filter facets + category counts** (`api.catalog_facets()`); **site settings +
announcement bar** (`api.get_public_settings` / `save_settings`); \*\*media library

- Storage uploads\*\* (`product-media` bucket / `media_assets`).

**Still mock / localStorage (later passes):** the legacy `PRODUCTS` array (still
exported for the admin dashboard and the Stage 3/5 order mocks, until those passes
remove it); product gallery editing (no admin UI yet — Pass 3f); orders, cart,
wishlist, checkout, coupons; payments; customer profiles/addresses/measurements;
courier; banners, CMS, contact, newsletter, reports.

## CI (honest)

`ci.yml` runs (genuinely): frozen Bun install, typecheck, lint, format, test, build,
**migrate-from-empty** (boots a local Supabase, applies all 25 migrations to a blank
DB), and **DB integration tests** (`pass2_db.test.sql` — stock write-guard,
set_inventory validation, ledger immutability, FK RESTRICT, first-variant
conservation, owner-only purge, reorder validation, bulk idempotency, actor-deletion
restriction, grant verification, post-migration schema proof, the merged RLS policy

- FK index, stable error-code assertions, review moderation + rating sync,
  customer submission → pending → approve → rating, catalog-facet counts +
  visibility filtering, site-settings public/admin projection + audit +
  single-row invariant + grants, and media-library bucket + register/upsert/
  delete/audit + usage count + grants). The **linked deployed-DB lint step runs** in CI (using `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_PASSWORD` repository secrets). This lints the deployed live database structure against recommendations.

## Outstanding follow-ups

1. Enable leaked-password protection (Auth dashboard) before broader auth use.
2. Rotate exposed credentials before go-live.
3. Deployed DB lint configured and running in CI.
4. DB integration tests are automated in CI (`pass2_db.test.sql`); a genuine
   two-connection concurrency test (`concurrency.test.sh`) also runs in the
   `migrations-local` job. True multi-session advisory-lock races are verified.
5. Stage 2 Pass 3f+: attach library media to product galleries; remove the legacy
   `PRODUCTS` array (facets/counts landed in Pass 3c; site settings in Pass 3d;
   the Storage media library in Pass 3e).
