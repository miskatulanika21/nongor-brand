# CURRENT_STATUS — Nongorr Studio

Authoritative record of verified project state. Code and live-environment
behavior are the source of truth; this file is updated after every stage.

_Last updated: 2026-06-28 — **Stage 3 checkout complete (backend + app
integration).** Stage 3 Pass 1 created the order schema (orders / order_items /
order_status_history / payments / payment_screenshots / idempotency_keys — RPC-only
deny-all; integer-BDT pricing with a balanced-total CHECK; append-only status
history) and the `NGR-YYYY-######` sequence. The reservations pass added soft
`inventory_reservations` holds with a lazy-backstop `private.available_qty` (counts
only unexpired holds, so an unswept hold never blocks a sale) and a `pg_cron` TTL
sweep (`api.expire_reservations`). **Pass 3a** shipped the server-authoritative
pricing/order RPCs: `api.quote_order` (public; per-line availability + a
`quote_token` drift guard) and `api.place_order` (service-role only; race-safe
idempotency via INSERT … ON CONFLICT, deterministic product-lock ordering,
server-side pricing, oversell + price-drift guards, reservation + guest-token
issuance; COD → `pending_confirmation`, manual → `pending_payment`). **Pass 3b
(complete)** is the app integration: migration 34 added admin-configurable payment
methods (`cod_enabled` + `payment_methods_enabled[]`, public-projected), the admin
Settings "Payment methods" toggles, the isomorphic `checkout-shared` module
(cart→lines, error-code map, method derivation, idempotency key), `checkout.server.ts`
repository + `checkout.api.ts` server fns, checkout-route rewire (method selector,
quote-driven totals, placeOrderFn with CSRF + rate-limit + identity, idempotency
key minting + quoteToken drift guard), cart reconciliation (quoteOrderFn on mount,
per-item stock warnings, auto-correct quantities), order-success page refresh
(ServerOrderSuccess component with search-param routing), and removal of the F-04
demo gate. 34 migrations applied; 344 Vitest + DB integration green; build clean;
all 4 CI checks green. Prior context:_

_Earlier (2026-06-27) — **Stage 2 closed.** GPT-audit remediation continued:
F-05 (in-use media delete guard, `media_in_use` — migration 30 applied + prod-
proven), F-13 (resolve staff emails by id — fixes the >50-user `listUsers`
blind spot + swallowed Auth error), F-06 (upload-intent verification — register
only a real Storage object, record its true size/type, derive the public URL
server-side), F-19 (storefront + admin-catalog E2E specs). Stage 2 Pass 3g: the
admin dashboard's Low Stock / Best Sellers widgets now read the live product
table, so the legacy `PRODUCTS` array is referenced only by the Stage 3/5 order
mocks — its deletion is now cleanly gated on Stage 3. Auth hardening then closed
F-10 (MFA factor-removal AAL2 step-up + rate limit) and F-11 (current-password
re-auth for authenticated change; recovery gated by an httpOnly marker cookie),
both app-layer. 30 migrations applied; 333 Vitest + DB integration green; build
clean. Prior context:_

_2026-06-26 — Stage 1.5 operationally closed; Stage 2 public read
(Pass 1) + admin product/category/inventory writes (Pass 2) implemented, hardened
and CI-green. Follow-up patch: stable inventory error codes + staff_profiles RLS
perf advisors cleared + movement-FK covering index. **Stage 2 Pass 3a: review
moderation + rating/review_count sync; Pass 3b: authenticated customer review
submission (persisted + moderated); Pass 3c: DB-backed catalog facets & counts
(shop filter sidebar); Pass 3d: DB-backed site settings (announcement bar live +
audited admin settings); Pass 3e: Storage-backed media library (real uploads via
signed URLs); Pass 3f: product gallery management (attach library media to a
product's gallery, atomic replace, library-only for new images; hardened with
duplicate prevention, alt-text editing, optimistic concurrency). Security
hardening: closed the direct `staff_profiles` write path (F-02); granted `api`
schema USAGE to anon/authenticated so public RPCs actually work over REST (F-08).**
29 migrations applied to the live project; remote ledger matches the 29 repo files._

State legend: **(1) code complete · (2) migration applied · (3) deployed
verification complete · (4) operator action pending.**

## Stage status

| Stage        | Scope                                                                                                                                  | Status                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1            | Auth, RBAC, CSRF, headers, rate limit, MFA scaffold, audit, owner-safety                                                               | Implemented                                                              |
| 1.5          | Security closure (4 bugs + A–E + follow-up hardening)                                                                                  | **Operationally closed** (migrations applied; `api` exposed; proofs run) |
| 2 (Pass 1)   | DB-backed **public catalog read** path                                                                                                 | Implemented + live                                                       |
| 2 (Pass 2)   | Admin **product / category / inventory** writes (DB-backed + hardened)                                                                 | **Implemented + live + CI-green**                                        |
| 2 (Pass 3a)  | **Reviews moderation + rating/review_count sync** (DB-backed)                                                                          | **Implemented + live + CI-green**                                        |
| 2 (Pass 3b)  | **Authenticated customer review submission** (persisted + moderated)                                                                   | **Implemented + live + CI-green**                                        |
| 2 (Pass 3c)  | **DB-backed catalog facets & counts** (shop filter sidebar)                                                                            | **Implemented + live + CI-green**                                        |
| 2 (Pass 3d)  | **DB-backed site settings** (announcement bar live; audited admin form)                                                                | **Implemented + live + CI-green**                                        |
| 2 (Pass 3e)  | **Storage-backed media library** (real uploads via signed URLs)                                                                        | **Implemented + live + CI-green**                                        |
| 2 (Pass 3f)  | **Product gallery management** (attach library media; atomic replace)                                                                  | **Implemented + live + CI-green**                                        |
| 2 (Pass 3g)  | **Admin dashboard cut off mock `PRODUCTS`** (live catalog widgets)                                                                     | **Implemented + live + CI-green**                                        |
| 2 (Pass 3g+) | Delete the `PRODUCTS` constant itself                                                                                                  | Gated on Stage 3 (order mocks are its only remaining consumer)           |
| 3 (Pass 1)   | **Order schema, numbering & idempotency** (RPC-only tables, no behavior)                                                               | **Implemented + live**                                                   |
| 3 (Pass 1r)  | **Inventory reservations** (soft holds + lazy availability + cron sweep)                                                               | **Implemented + live**                                                   |
| 3 (Pass 3a)  | **Server-authoritative pricing/order RPCs** (`quote_order`/`place_order`)                                                              | **Implemented + live**                                                   |
| 3 (Pass 3b)  | **Checkout app integration** (payment settings + checkout-shared + server fns + checkout rewire + cart reconciliation + order-success) | **Implemented + live + CI-green**                                        |
| 4            | Customer accounts / addresses / measurements                                                                                           | Not started (localStorage)                                               |
| 5            | Courier adapters, shipments, webhooks, outbox                                                                                          | Not started                                                              |
| 6            | Banners, CMS, contact, newsletter, reports, settings                                                                                   | Not started (mock)                                                       |
| 7            | Hardening, perf/a11y, CI/CD, backups                                                                                                   | Not started                                                              |

## Migrations (live project xomjxtmhkglhuiccekld)

**34 migrations**, all applied; the remote `supabase_migrations.schema_migrations`
ledger matches the 34 repo files exactly (versions + names), in order:

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
                                          …626160000 product_gallery
                                          …626170000 product_gallery_hardening
                                          …626180000 staff_profiles_write_lockdown
                                          …626190000 api_schema_usage_grant
                                          …627120000 media_delete_in_use_guard
                                          …627130000 orders_schema
                                          …627140000 reservations
                                          …627150000 order_rpcs
                                          …627085345 payment_method_settings
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
- **Direct `staff_profiles` write lockdown (`20260626180000`, F-02):** dropped the
  `owner_insert_staff` / `owner_update_staff` RLS policies and revoked
  INSERT/UPDATE/DELETE from `anon` + `authenticated`. Because `public` is exposed
  via PostgREST, an authenticated **owner** could previously `POST/PATCH
/rest/v1/staff_profiles` directly, bypassing the guarded workflow (CSRF + MFA
  step-up + rate limit + canonical staff audit). All supported staff writes already
  flow through service-role `api.*` RPCs (`provision_staff` / `update_staff_role` /
  `set_staff_active`), which bypass RLS/grants, so no behavior changed. SELECT is
  retained (the identity resolver reads under the caller's session). Verified by a
  rolled-back prod proof (authenticated-owner INSERT + UPDATE both rejected; SELECT
  intact; RPC path intact) + `pass2_db.test.sql` §18.

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
- Verified by rolled-back SQL proof + `pass2_db.test.sql` §16 (bucket public,
  register/upsert/delete/audit, usage count, grants) + Vitest. The one path CI
  cannot exercise is the actual browser file PUT to Storage (the bucket config is
  the server-side guarantee for size/mime).

## Stage 2 Pass 3f — Product gallery management (done, live)

- The product editor can now build a product's image gallery from the media
  library. `api.set_product_media(p_code, p_items, p_actor)` (service-role only)
  **atomically replaces** a product's `product_media` rows: active-staff check
  (`actor_not_authorized`), product resolved by code (`product_not_found`), bounds
  0–12 (`invalid_gallery`), and **library-only enforcement for new images** — each
  URL must be either a `media_assets.public_url` OR already on this product (so
  legacy/seeded images survive a resubmit but new picks come from the library;
  `invalid_media` otherwise). At most one image may be primary; when none is flagged
  the first becomes primary (matching the `uq_product_media_one_primary` index).
  `product.media_changed` audit on every change.
- **App:** gallery schemas in `catalog-admin.schema.ts`
  (`productGallerySchema`/`productGallerySaveSchema`, `galleryErrorMessage`);
  `fetchAdminProductDetail` now returns the sorted `gallery`; `setProductMedia`
  repo + `GalleryError`; server fns `saveProductGallery`
  (`guardAdminWrite("products.manage")`) and `listMediaForProducts`
  (`requirePermission("products.manage")`, reusing `listMedia` so a products
  manager needs no `media.manage`). `admin.products.tsx` gains a **Gallery**
  section (when editing): inline library picker, add/remove, set-primary, reorder.
- **Hardening (`20260626170000`):** a `(product_id, url)` unique index + duplicate
  rejection (`duplicate_media`); a DB alt-text length CHECK (≤300) + an alt-text
  editor in the gallery UI; a hard 12-image guard in the picker; and **optimistic
  concurrency** — `products.gallery_revision` + a `p_expected_revision` argument so a
  stale editor gets `gallery_conflict` instead of silently clobbering a concurrent
  save. `set_product_media` now returns `{ revision, items }`. The migration first
  de-duplicates pre-existing seed rows (exact repeats) so the unique index can build.
- Verified by rolled-back SQL proof + `pass2_db.test.sql` §17 (replace + sort_order,
  first-becomes-primary, explicit primary, preserve-legacy resubmit, non-library
  rejection, two-primary rejection, bounds, bad actor, unknown product, duplicate,
  over-long alt, unique-index backstop, optimistic-concurrency conflict + bump, empty
  clears, grants) + Vitest (gallery schema incl. duplicate + revision).

## Stage 3 Pass 1 — order schema, numbering & idempotency (done, live)

- Foundation tables for server-authoritative checkout, all **RPC-only** (RLS
  deny-all + direct grants revoked from anon/authenticated — same posture as the
  inventory/settings tables): `orders`, `order_items`, `order_status_history`,
  `payments`, `payment_screenshots`, `idempotency_keys`.
- **Invariants enforced at the DB:** money is integer BDT with a balanced-total
  CHECK (`subtotal - discount + shipping_fee = total`); each order has exactly one
  owner (`user_id` XOR `guest_token_hash`, the latter a 64-char sha256 hash);
  `order_items.line_total = unit_price * qty`, qty 1..50; `order_status_history` is
  **append-only** (a trigger blocks UPDATE/DELETE); a partial unique index makes a
  given wallet `(method, lower(trx_id))` VERIFIED on at most one payment (fraud
  guard); `idempotency_keys.key` is the PK (the serialization point for retries).
- `order_no_seq` sequence backs the `NGR-YYYY-######` number minted in the P3a RPC.
  No app behavior in this pass — structure + invariants only.

## Stage 3 Pass 1r — inventory reservations (done, live)

- `inventory_reservations` holds soft stock for pending orders.
  `private.available_qty(product_id, size) = base_stock − Σ(active, **unexpired**
holds)` — the **lazy backstop**: availability ignores expired holds, so
  correctness never depends on the sweep running on time.
- `api.expire_reservations()` (service-role) flips expired pending orders to
  `expired` (FOR UPDATE SKIP LOCKED) and records system status history; scheduled
  every 5 min via `pg_cron` (best-effort; the lazy count is the real guarantee).

## Stage 3 Pass 3a — server-authoritative pricing/order RPCs (done, live)

- **`api.quote_order(p_lines, p_zone)`** (public; anon/authenticated/service):
  prices a cart from the DB (`private.price_lines` is the single source shared with
  place), returns per-line `{unit_price, line_total, available, visible, found}`
  plus `subtotal/discount(0)/shipping_fee/total` and a **`quote_token`**
  (`md5(canon || '#' || subtotal)` over visible lines) — the honest pre-submit
  total and a drift fingerprint. Free-delivery keyed on pre-discount subtotal.
- **`api.place_order(p_lines, p_customer, p_zone, p_payment_method,
p_idempotency_key, p_actor, p_quote_token)`** (**service-role only** — REVOKE from
  anon/authenticated; the app server fn adds CSRF/rate-limit/identity). One
  transaction: race-safe idempotency (INSERT … ON CONFLICT DO NOTHING; replay
  returns the original order, hash-mismatch → `idempotency_conflict`),
  **deterministic product lock order** (sorted ids → deadlock-free), server-side
  pricing (client totals ignored), oversell guard under the locks via
  `available_qty`, **price-drift** check against `quote_token` (`price_changed`),
  soft reservation (24h TTL), order + items + payment + status-history writes,
  guest-token issuance (returned once). Stable snake_case error codes:
  `out_of_stock, price_changed, invalid_payment_method, invalid_address,
empty_cart, idempotency_conflict, product_not_purchasable, invalid_qty`. Status:
  COD → `pending_confirmation`, manual (bkash/nagad) → `pending_payment`. Coupons
  are not handled yet (discount always 0; P5).

## Stage 3 Pass 3b — checkout app integration (done, live, CI-green)

- **Migration `20260627085345` (applied + verified):** `site_settings` gains
  `cod_enabled` (bool) + `payment_methods_enabled` (text[] ⊆ {bkash,nagad});
  `api.get_public_settings` projects both (public-safe); `api.save_settings`
  patches both. Round-trip verified against prod (then defaults restored).
- **Admin UI:** `admin.settings.tsx` gains a "Payment methods" section (COD toggle +
  bKash/Nagad toggles + a no-method-enabled warning) on the existing guarded
  `saveSettings` plumbing.
- **`checkout-shared.ts`** (isomorphic, client-safe): `PaymentMethod`/
  `MANUAL_METHODS`/`isManualMethod`, `availableMethods`/`enabledMethodList` (from
  public settings, COD first), quote/place request+response types,
  `cartToQuoteLines` (CartItem.productId **is** the product code, since the DB-backed
  storefront sets `Product.id = products.code`), `checkoutErrorMessage` over the 8
  stable codes, and `newIdempotencyKey`. Covered by `checkout-shared.test.ts`.
- **Server layer:** `checkout.server.ts` (repository — `quoteOrder` via anon client,
  `placeOrder` via service-role client) + `checkout.api.ts` (TanStack Start server
  fns with CSRF + rate-limit middleware). Rate-limit buckets: `quoteOrder` (60/min),
  `placeOrder` (10/10min).
- **Checkout route rewire (`_site.checkout.tsx`):** quote-driven totals on mount +
  zone/cart change; payment method selector (COD + bKash/Nagad from `publicSettings`);
  `placeOrderFn` with CSRF + rate-limit + identity + method validation; idempotency
  key minting + `quoteToken` drift guard. Error handling: `price_changed` → re-quote;
  `out_of_stock` → redirect to cart. **F-04 demo gate removed.**
- **Cart reconciliation (`_site.cart.tsx`):** `quoteOrderFn` on mount to verify
  stock/availability; per-item warnings (not found, not visible, out of stock, low
  stock); auto-corrects quantity to available max with toast notification;
  server-verified subtotal with ✓ indicator.
- **Order success (`_site.order-success.tsx`):** `validateSearch` accepts `order_id`,
  `order_no`, `status`, `total` from checkout redirect; `ServerOrderSuccess`
  component with real server data; COD vs manual payment differentiated "what happens
  next" steps; legacy localStorage path preserved for backward compat.
- **Decision (locked):** TrxID is collected inline at checkout and stashed locally
  for P4's `submit_payment_evidence` to attach — `place_order` has no TrxID param,
  so it is **not** server-recorded yet.

## Real vs mock (data flow)

**Real / persistent (DB-backed):** auth, staff RBAC (`staff_profiles`), audit logs;
public catalog read (`product_*`); **admin product/category writes**; **inventory
(ledger + stock)**; **review moderation + product rating/review_count**;
**customer review submission** (authenticated → pending → moderated); **shop
filter facets + category counts** (`api.catalog_facets()`); **site settings +
announcement bar** (`api.get_public_settings` / `save_settings`); \*\*media library

- Storage uploads** (`product-media` bucket / `media_assets`); **product galleries**
  (`api.set_product_media` — library-backed, atomic replace); **checkout + orders\*\*
  (server-authoritative pricing via `quote_order`, order placement via `place_order`,
  cart reconciliation, payment method selection — all wired to the storefront UI).

**Still mock / localStorage (later passes):** the legacy `PRODUCTS` array (still
exported for order mocks, until Pass 3g+ removes it); cart and wishlist hold item
IDs in localStorage only (no server-side cart); coupons (display-only until Stage
5); payment verification + evidence (Stage 4); customer
profiles/addresses/measurements (Stage 4); courier (Stage 5); banners, CMS,
contact, newsletter, reports (Stage 6).

**Privacy / fail-closed guardrails (F-03 / F-04):** customer account PII
(profile/addresses/measurements) and device orders are partitioned in localStorage
**per verified user id** (legacy unscoped keys are purged), so two customers
sharing one browser can never read each other's data. The F-04 demo checkout gate
(`isDemoCommerceEnabled()`) has been **removed** from the checkout submit path —
checkout now calls the real `place_order` RPC. The seeded demo `ORDERS` array is
still referenced by the legacy order-history/tracking views (Stage 4 replaces
these with DB reads).

## CI (honest)

`ci.yml` runs (genuinely): frozen Bun install, typecheck, lint, format, test, build,
**migrate-from-empty** (boots a local Supabase, applies all 34 migrations to a
blank DB — incl. the Stage 3 order schema/reservations/RPCs/payment-method
settings), and **DB integration tests** (`pass2_db.test.sql` + `pass3_db.test.sql`
— stock write-guard, set_inventory validation, ledger immutability, FK RESTRICT,
first-variant conservation, owner-only purge, reorder validation, bulk idempotency,
actor-deletion restriction, grant verification, post-migration schema proof, the
merged RLS policy + FK index, stable error-code assertions, review moderation +
rating sync, customer submission → pending → approve → rating, catalog-facet counts

- visibility filtering, site-settings public/admin projection + audit + single-row
  invariant + grants, media-library bucket + register/upsert/delete/audit + usage
  count + grants, product-gallery atomic replace + library-only + one-primary +
  bounds + audit + grants + duplicate/alt/concurrency, `staff_profiles` direct-write
  lockdown, **Stage 3 order-schema invariants** — pricing balance, owner XOR,
  line-total, append-only status, verified-TrxID guard, idempotency uniqueness,
  RPC-only RLS). The migrate-from-empty job **exposes the `api` schema** in the local
  stack config (never `private`) and runs a **REST smoke test (F-08)** against
  PostgREST on the fresh stack: anon can reach a public `api` RPC (`catalog_facets`),
  anon **cannot** reach a privileged RPC (`set_product_media`), and the service role
  can. The **linked deployed-DB lint step runs** in CI (using `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_PASSWORD` repository secrets). All **4 CI
  checks** green (Quality + Migrations + DB Lint + Supabase Preview).

## Outstanding follow-ups

1. Enable leaked-password protection (Auth dashboard) before broader auth use.
2. Rotate exposed credentials before go-live.
3. Deployed DB lint configured and running in CI.
4. DB integration tests are automated in CI (`pass2_db.test.sql`); a genuine
   two-connection concurrency test (`concurrency.test.sh`) also runs in the
   `migrations-local` job. True multi-session advisory-lock races are verified.
5. Delete the `PRODUCTS` constant itself — every Stage-2 surface is DB-backed
   (facets Pass 3c, settings 3d, media library 3e, galleries 3f, dashboard 3g);
   the only remaining consumers are the legacy order-history/tracking views
   (`orders.ts`, `order-ui.ts`) — to be removed in Stage 4 when order reads are
   DB-backed.
6. GPT-audit remediation status: done — F-02, F-03, F-04, F-05, F-06, F-07, F-08,
   F-10, F-11, F-13, F-15, F-16, F-17, F-19. **F-10** (MFA factor removal now
   requires an AAL2 step-up + a rate limit) and **F-11** (authenticated password
   change requires the verified current password; recovery/invite gated by a
   short-lived httpOnly marker cookie) landed app-layer (no migration).
   _Manual-verify_: **DONE (2026-06-27)** — `scripts/e2e-auth-test.ts` was run
   against a real local Supabase stack (Docker; db+auth+rest+storage, prod-safety
   guard satisfied). All 14 assertions green, including the F-11 primitives:
   recovery → set-password without a current password, original password
   invalidated after reset, and the throwaway-client current-password probe
   accepting the correct / rejecting a wrong password. The run also surfaced &
   fixed a harness false-negative (block 4 read `staff_profiles` as service_role,
   which is intentionally denied — direct table access is RLS-gated to
   self-or-admin and service ops go via SECURITY DEFINER RPCs; now reads as an
   owner). Remaining audit items: F-14 (customer→staff promotion), F-18
   (deployment target — business decision).
7. Live security advisors (2026-06-27): 4 intentional INFO `rls_enabled_no_policy`
   (RPC-only tables) + WARN `anon/authenticated_security_definer_function_executable`
   for `api.catalog_facets()` and `api.get_public_settings()` — **intentional
   public reads** (facets; settings sans payment secrets), accepted posture +
   the deferred leaked-password toggle.
