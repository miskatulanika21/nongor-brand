# Stage 2 — Pass 1: Catalog Persistence & Public Read Path

Status: **Implemented, type-checked, linted, formatted, unit-tested (180 passing,
+12 new), production build green, DB migrations applied to the connected project,
catalog seeded (idempotent), and RLS/invariant checks verified via SQL.**

Scope delivered: the **public catalog read path is now database-backed**. Admin
writes, inventory movements/reservations, collections, Storage-backed media, and
DB-backed category facets remain for the next Stage 2 pass (the admin UI still
reads the legacy mock array and shows its "preview/mock" badges).

---

## 1. Database

Two migrations applied to project `xomjxtmhkglhuiccekld` via Supabase MCP using
the **exact committed SQL**, with recorded versions aligned to the files:

- `20260621090000_staff_provisioning_and_owner_safety.sql` — the previously
  **unapplied** migration 8 (owner-safety trigger + actor-correct staff RPCs).
  Verified fully unapplied beforehand (no partial state).
- `20260622000000_catalog_schema.sql` — new catalog schema (one atomic migration):
  `product_categories`, `products`, `product_media`, `product_size_stock`,
  `product_reviews`.

Local and remote migration histories now match, **except** a pre-existing naming
drift on the harden migration (file `20260620165800` vs remote `20260620165913`,
identical body) — flagged, not rewritten.

### Schema decisions

- **Normalized category**: `products.category_id` (NOT NULL FK) is the single
  source — there is no duplicate `type`/`category` text column. The mapping
  derives `Product.type` from the category slug and `Product.category` from its
  name.
- **Constraints**: non-negative `price`/`stock`/`quantity`/`custom_size_charge`;
  `sale_price` ≤ `price`; product `rating` 0–5; review `rating` 1–5; `status`
  and media `kind` CHECKed; child tables `ON DELETE CASCADE`; **partial unique
  index** allowing at most one `is_primary` media per product.
- **RLS** (public SELECT only, no public writes): products visible only when
  `status='active'` AND their category is active; media/size/review rows gated by
  `EXISTS (active parent product)` (no blanket `USING(true)`); reviews
  additionally require `status='approved'`. The seed uses the service-role key
  (bypasses RLS).
- `get_advisors` after apply: **no new findings** from the catalog migration
  (all WARNs are pre-existing Stage 1 items; new index INFOs are "unused"
  only because no production queries have run yet).

### Source-of-truth notes (transitional, documented)

- **category** → `category_id` (only source).
- **stock** → `sum(product_size_stock.quantity)` when size rows exist, else
  `products.stock`; seed keeps them consistent. Inventory pass makes movements
  canonical.
- **rating / review_count** → denormalized display snapshot on `products`;
  `product_reviews` is the row store. Not auto-synced this pass (no trigger yet).

## 2. Seed

- Pure, serializable fixture `scripts/seed/catalog-fixture.ts` (no Vite asset
  imports) with stable `code`s ("p1".."p10") and public image paths
  (`/assets/products/*.jpg`; the 6 images were copied into `public/`).
- `scripts/seed-catalog.ts` (`npm run seed-catalog`): requires `SEED_CONFIRM=1`,
  validates the project ref from `VITE_SUPABASE_URL` (optional
  `EXPECTED_SUPABASE_REF` assert), never prints the key. Upserts categories on
  `slug` and products on `code`; replaces per-product children (delete-then-
  insert) so it is idempotent and obsolete-safe.
- **Ran twice → identical counts** (7 / 10 / 18 / 30 / 30).

## 3. Code

- `src/lib/server/catalog.server.ts` — server-only repository, per-request ANON
  client (RLS-safe), typed `CatalogQueryError`, **no silent fallback** to the
  mock array. `fetchProductCards` / `fetchProductCardsByCodes` /
  `fetchProductDetail`.
- `src/lib/catalog-map.ts` — pure row→`Product` mapping (`id`=`code`,
  type/category from the joined category, ordered gallery, sizeStock map,
  newest-first reviews) with **safe missing-media fallback** so cards / PDP /
  metadata / JSON-LD never crash.
- `src/lib/catalog.api.ts` — `createServerFn` read handlers (`listProductCards`,
  `getProductDetail`, `getProductCardsByCodes`); server module imported inside
  the handler closures (never enters the client bundle).
- `src/lib/supabase/types.ts` — generated DB types.
- **Read-path rewire (loaders, the project's SSR pattern — no React Query
  provider added)**: `_site.shop`, `_site.index`, `_site.product.$slug`
  (async loader + `notFound()`), `_site.wishlist`, `_site.cart`,
  `_site.eid-style-guide`, `SearchDialog` (lazy on open), `sitemap.xml`
  (server handler → repository, active products only).
- `src/lib/store.tsx` — removed the `PRODUCTS`-derived `wishlistProducts`
  getter; the store holds cart/wishlist **ids only** (preserves p1–p10), so an
  empty/loading catalog can never disturb persisted localStorage.

## 4. Tests (Vitest — 180 passing, no DB / no service-role needed)

- `catalog-map.test.ts` — mapping invariants (id=code, type/category, gallery
  order, sizeStock + canonical stock, null sale price, array-category
  normalization) and **missing-media safety**.
- `store-persistence.test.tsx` — legacy `nongorr_cart`/`nongorr_wishlist`
  localStorage survives hydration with an empty catalog and is not rewritten.

## 5. DB invariant checks (via Supabase SQL)

| Check                                                             | Result                                     |
| ----------------------------------------------------------------- | ------------------------------------------ |
| anon baseline counts                                              | 10 / 18 / 30 / 30 / 7 ✓                    |
| hidden product → product + media + size + review hidden from anon | products 9, p1 media/sizes 0, reviews 26 ✓ |
| inactive category → its product hidden                            | 9 visible ✓                                |
| approved-review filter (pending hidden)                           | ✓ (included above)                         |
| one-primary-media enforcement                                     | 2nd primary insert rejected ✓              |
| anon write denied (no write policy)                               | INSERT rejected by RLS ✓                   |
| product order by `sort_order`                                     | p1…p10 ✓                                   |
| seed idempotency (two runs)                                       | identical counts ✓                         |

## 6. Command results

- `tsc --noEmit` → clean.
- `eslint .` → 0 errors (31 pre-existing `react-refresh` warnings).
- `prettier --check` → clean.
- `vitest run` → **180 passed / 13 files**.
- `vite build` → success (client + server).

## 7. Remaining (next Stage 2 pass)

Admin product/category/inventory/media/size/settings **writes**; inventory
movements & reservations; collections; DB-backed category counts &
COLORS/FABRICS facets; Storage media library; rating/review_count maintenance.
The legacy `PRODUCTS` array stays exported (admin + `categories.ts` counts) until
the admin write path is DB-backed. `orders.ts`/`order-ui.ts` stay on mock data
(Stage 4/5). Harden-migration naming drift to reconcile separately.

## 8. Rollback

- Code: `git revert` this commit (storefront returns to reading `PRODUCTS`).
- Data/schema: the catalog tables are additive and isolated; to fully remove,
  `drop table` the five catalog tables (CASCADE) and delete the
  `20260622000000` history row. Migration 8 is independent and should remain.

## 9. Addendum — 2026-06-25 follow-up patch

A post-Pass-2 review found that granular inventory error messages never reached
the user, plus three open Supabase performance advisors. Both fixed:

- **Stable inventory error codes** (migration `20260625120000`): every inventory
  RPC (`set_inventory`, `add_product_variant`, `remove_product_variant`,
  `bulk_set_inventory`) now raises a machine-readable snake_case CODE as the
  exception message, with the human sentence in `DETAIL`. The single-op TS path
  throws `InventoryError(code)`; the bulk path forwards the inner code as
  `error_code` (the previous fragile `SQLERRM ILIKE` mapping is gone). The
  code→message table (`inventoryErrorMessage`) moved to the isomorphic
  `catalog-admin.schema.ts`, so the admin UI surfaces per-item bulk failure
  reasons client-side. Before this, every single-op failure collapsed to a
  generic "Could not complete the change."
- **Advisor cleanup** (migration `20260625130000`): merged the two permissive
  `staff_profiles` SELECT policies into one `staff_select_self_or_admin` with
  sub-select-wrapped auth calls (clears `auth_rls_initplan` +
  `multiple_permissive_policies`); added `idx_movements_actor` (clears
  `unindexed_foreign_keys`).
- **Verification**: `pass2_db.test.sql` §10h/§10i/§11 assert the new policy, the
  index, and `message_text == code` for the inventory RPCs (incl. bulk per-item
  `error_code`). Vitest: **248 passed**. `get_advisors` re-run: the three perf
  advisors are gone; remaining items are the two intentional INFO
  `rls_enabled_no_policy` (RPC-only tables) and the deferred leaked-password WARN.

## 10. Stage 2 Pass 3a — review moderation + rating sync (2026-06-25)

The catalog schema shipped a `product_reviews` table and denormalized
`products.rating` / `review_count`, but the snapshot was never synced and admin
moderation was a mock. Migration `20260625140000` closes both:

- **Sync trigger** — `AFTER INSERT/UPDATE/DELETE ON product_reviews` recomputes
  `rating = round(avg(approved),1)` + `review_count = count(approved)` for the
  affected product (one-time backfill included). Touches only rating/review_count,
  so the `products.stock` write-guard is respected. Correct for moderation,
  seeding, and future customer submissions alike.
- **Moderation RPCs** (service-role EXECUTE only): `api.set_review_status`
  (idempotent — re-applying the same status is a no-op success) and
  `api.delete_review`. Active-staff check, stable snake_case codes
  (`actor_not_authorized` / `review_not_found` / `invalid_status`), canonical
  `review.status_changed` / `review.deleted` audit in the same transaction.
- **TS/UI**: `reviews-admin.server.ts` (`ReviewError`, `fetchAdminReviews`,
  `setReviewStatus`, `deleteReview`) + `reviews-admin.api.ts` behind
  `guardAdminWrite("reviews.manage")`; `admin.reviews.tsx` rewritten to real data
  (pending-first queue, status filter + counts, approve/reject/restore/delete,
  granular errors). `reviewErrorMessage` is in the isomorphic schema module.
- **Verification**: rolled-back SQL proof (pending=0 → approve→4.0/1 →
  approve→3.0/2 → delete→4.0/1; `invalid_status` / `review_not_found` codes) +
  `pass2_db.test.sql` §12 (sync on approve/reject/delete, codes, grants) +
  8 new Vitest specs. Full `check` green (**256 tests**). 21 migrations; ledger
  matches; no advisor regression.

## 11. Stage 2 Pass 3b — customer review submission (2026-06-26)

Closes the loop opened by Pass 3a: a **logged-in** customer can now submit a
review (migration `20260626120000`).

- **Schema:** `product_reviews.user_id uuid REFERENCES auth.users ON DELETE SET
NULL` + partial unique index `(product_id, user_id) WHERE user_id IS NOT NULL`
  → one review per customer per product. Existing/seeded rows stay `user_id` NULL.
- **`api.submit_review`** (SECURITY DEFINER, service-role only): verifies the
  user, requires the product be **publicly visible** (active + active category,
  mirroring the public RLS), bounds-checks rating 1–5 / name ≤80 / body ≤2000,
  dedupes, inserts as **`pending`**, writes a `review.submitted` audit. Stable
  codes (`product_not_visible`/`already_reviewed`/`invalid_rating`/`invalid_author`/
  `invalid_body`). The rating-sync trigger leaves the public rating untouched
  until moderation.
- **App:** `submitReview` customer server fn — CSRF + **authenticated session
  required** (`requiresAuth` otherwise) + `reviewSubmit` per-IP/account rate
  limit. `reviewSubmitSchema` is isomorphic. Product-page form persists (was
  ephemeral local-only).
- **Verification:** rolled-back SQL proof (submit→pending leaves rating 0/0;
  dedupe; draft-not-visible; bad rating; approve→5.0/1) + `pass2_db.test.sql` §13
  - 5 Vitest specs. Full `check` green (**261 tests**). 22 migrations; ledger
    matches; no advisor regression.
- **Deferred (Pass 3c):** Storage media library; DB-backed category facets/counts;
  settings; retire the legacy `PRODUCTS` array.

## 12. Stage 2 Pass 3c — DB-backed catalog facets & counts (2026-06-26)

The shop filter sidebar (category counts, colours, fabrics, occasions) was
computed from the legacy mock `PRODUCTS` array and so drifted from the live
catalog. Migration `20260626130000` makes it a database read.

- **`api.catalog_facets()`** (`STABLE`, `SECURITY DEFINER`, `search_path=''`):
  aggregates over the **publicly-visible** catalog (`status='active'` AND the
  product's category is active — the predicate is explicit, so the result is
  identical whether the caller is anon under RLS or the superuser psql CI role
  that bypasses it). Returns jsonb: `categories` as per-DB-category
  `{slug,name,count}` (only those with visible products), and `colors`/`fabrics`/
  `occasions` as `{value,count}` ordered by frequency then value. It is a public
  read: `REVOKE…FROM public; GRANT EXECUTE TO anon, authenticated, service_role`
  (contrast the service-role-only write RPCs).
- **App:** `fetchCatalogFacets` (`catalog.server.ts`, anon client →
  `.schema("api").rpc("catalog_facets")`) + `getCatalogFacets` server fn;
  `_site.shop.tsx` loads cards + facets in parallel and renders the DB facets.
  `catalog-facets.ts` is the isomorphic module — `CatalogFacets` type +
  `normalizeFacets` (defensive: a malformed jsonb payload degrades to an empty
  facet set, never crashes the loader) + `facetValues`. `rollupCategoryCounts`
  (in `categories.ts`) collapses the three cosmetics product types
  (cosmetics/makeup/serum) into the single customer-facing "Cosmetics" facet.
  The hard-coded `COLORS`/`FABRICS`/`OCCASIONS` arrays and the `PRODUCTS`-derived
  `categoryCount` were removed.
- **Verification:** rolled-back SQL proof (live counts: kurti 3 / total 10;
  colours 8, fabrics 7, occasions 5) + `pass2_db.test.sql` §14 (active facet
  category counts only its visible products, draft + inactive-category rows
  excluded, colour/fabric/occasion counts, grants) + 7 Vitest specs. Full `check`
  green (**268 tests**). 23 migrations; ledger matches; no advisor regression.
- **Deferred (Pass 3d):** Storage media library; settings; retire the legacy
  `PRODUCTS` array (still bound to the admin dashboard / media-library preview and
  the Stage 3/5 order mocks).

## 13. Stage 2 Pass 3d — DB-backed site settings (2026-06-26)

The admin Settings page and the storefront announcement bar were mock/static.
Migration `20260626140000` makes them a database read/write.

- **`public.site_settings`** — a single-row table (`id smallint PK CHECK (id = 1)`,
  seeded) with bounded CHECK constraints covering store / announcement / delivery
  / contact / policies and **admin-only** payment fields (`bkash_number`,
  `nagad_number`, `payment_instructions`). RLS is enabled with **no policies**
  (deny-all): every access is via a SECURITY DEFINER `api.*` RPC, the same posture
  as the inventory tables.
- **RPCs:** `api.get_public_settings()` (anon/authenticated; jsonb projection that
  **omits** the payment fields); `api.get_admin_settings(actor)` (service-role +
  active-staff; full row); `api.save_settings(patch, actor)` (service-role +
  active-staff; a **CASE-presence** patch so only supplied keys change and a
  present-null clears a nullable column; bounds enforced by the table CHECKs — a
  raw out-of-bounds call surfaces as `23514` → `invalid_settings`; canonical
  `settings.updated` audit recording the changed keys, in the same transaction).
- **App:** `settings.schema.ts` (isomorphic types + `settingsSaveSchema` mirroring
  the CHECKs, normalisation, and `announcementState`); `settings.server.ts`
  (`fetchPublicSettings` via the anon client, `fetchAdminSettings`/`saveSettings`
  via the service-role client, `SettingsError`); `settings.api.ts`
  (`getPublicSettings`, `loadAdminSettings`, `saveSettings` behind
  `guardAdminWrite("settings.manage")`). The storefront announcement bar reads the
  DB (`_site` `beforeLoad` → `SiteHeader`, with a static fallback so it never
  vanishes on a transient failure); `admin.settings.tsx` is a real persisting
  form. `brand.ts` stays the static default for the deeply-embedded SSR
  meta/JSON-LD.
- **Verification:** rolled-back SQL proof (public projection excludes payment;
  non-staff rejected; save updates + clears + audits; bounds enforced; grants) +
  `pass2_db.test.sql` §15 (same, plus the single-row invariant) + 12 Vitest specs.
  Full `check` green (**280 tests**). 24 migrations; ledger matches; no advisor
  regression.
- **Deferred (Pass 3e):** Storage media library; retire the legacy `PRODUCTS`
  array.

## 14. Stage 2 Pass 3e — Storage-backed media library (2026-06-26)

The admin media library was mock (assets fabricated from `PRODUCTS` + ephemeral
object URLs). Migration `20260626150000` makes it real.

- **Storage:** a `product-media` bucket (public read, 5 MB limit, image mime
  allowlist) created via `storage.buckets`. There are deliberately **no storage
  RLS write policies** — uploads are authorised by a one-time signed token, deletes
  by the service role.
- **`public.media_assets`** — the catalogue (`storage_path` unique, `public_url`,
  `file_name`, `content_type`, `size_bytes`, `width/height`, `created_by`). RLS
  deny-all (RPC-only).
- **RPCs (service-role + active-staff):** `api.register_media(...)` (idempotent
  **upsert** on `storage_path`, `media.uploaded` audit), `api.delete_media(id,
actor)` (returns `storage_path` so the repo can drop the object; `media.deleted`
  audit), `api.list_media(actor)` (newest-first jsonb with a **product-usage
  count** via a LEFT JOIN of `product_media` on URL).
- **Upload flow (no binary through the app server):** `requestMediaUpload`
  (service-role) validates type/size and mints a signed upload URL for a generated
  `YYYY/MM/<id>-<name>` path; the browser PUTs the file straight to Storage (the
  bucket enforces size + mime); `registerMedia` records the row. `media.schema.ts`
  is the isomorphic module (`mediaStoragePath`, `validateMediaFile`, row mapping);
  `media.server.ts` holds the service-role repo (`MediaError`); `media.api.ts`
  guards every write with `guardAdminWrite("media.manage")`.
  `admin.media-library.tsx` is now a real DB-backed grid/list with true upload and
  delete-with-confirm.
- **Verification:** rolled-back SQL proof + `pass2_db.test.sql` §16 (bucket exists
  - public; register/upsert/non-image/bad-actor; usage count; delete + audit +
    `media_not_found`; grants) + 11 Vitest specs (`mediaStoragePath`,
    `validateMediaFile`, error map, row mapping). Full `check` green (**291 tests**).
    25 migrations; ledger matches; no advisor regression. The one path CI cannot
    exercise is the actual browser file PUT to Storage — the bucket config (size +
    mime) is the server-side guarantee.
- **Deferred (Pass 3f):** attach library media to a product's gallery (the product
  editor has no gallery UI yet); retire the legacy `PRODUCTS` array.

## 15. Stage 2 Pass 3f — Product gallery management (2026-06-26)

The product editor had no way to build a product's image gallery; `product_media`
rows could only be set by the seed. Migration `20260626160000` adds the authoring
path that connects the Pass 3e media library to products.

- **`api.set_product_media(p_code, p_items, p_actor)`** (SECURITY DEFINER,
  service-role only) **atomically replaces** a product's `product_media` rows:
  active-staff check (`actor_not_authorized`), product resolved by `code`
  (`product_not_found`), bounds 0–12 (`invalid_gallery`).
- **Library-only for new images:** each submitted URL must be EITHER a
  `media_assets.public_url` OR already on this product — so the picker enforces
  library-only for newly added images while preserving legacy/seeded images that
  predate the library (`invalid_media` otherwise).
- **Primary:** at most one image may be flagged primary (`invalid_gallery` if more);
  when none is flagged the first becomes primary, matching the
  `uq_product_media_one_primary` partial unique index. `sort_order` follows array
  order via `jsonb_array_elements … WITH ORDINALITY`. `product.media_changed` audit.
- **App:** `catalog-admin.schema.ts` gains `productGalleryItemSchema` /
  `productGallerySchema` (max 12, ≤1 primary) / `productGallerySaveSchema` and
  `galleryErrorMessage`. `fetchAdminProductDetail` now selects + returns the sorted
  `gallery`; `setProductMedia` repo + `GalleryError` in `catalog-admin.server.ts`;
  server fns in `catalog-admin.api.ts`: `saveProductGallery`
  (`guardAdminWrite("products.manage")`) and `listMediaForProducts`
  (`requirePermission("products.manage")` — reuses `listMedia` so a products manager
  needs no `media.manage`). `admin.products.tsx` adds a **Gallery** section (when
  editing) with an inline library picker, add/remove, set-primary, and ↑/↓ reorder.
- **Verification:** rolled-back SQL proof + `pass2_db.test.sql` §17 (replace +
  sort_order + first-becomes-primary; explicit primary; preserve-legacy resubmit;
  non-library rejection → `invalid_media`; two-primary → `invalid_gallery`; bounds;
  bad actor; unknown product; empty clears; service-role-only grant) + Vitest gallery
  schema specs. Full `check` green (**301 tests**). 26 migrations; ledger matches.
- **Deferred (Pass 3g+):** retire the legacy `PRODUCTS` array; further catalog polish.
