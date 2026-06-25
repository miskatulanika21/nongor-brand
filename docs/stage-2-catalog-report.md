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
- **Deferred (Pass 3b):** persisting _customer_ review submissions (authenticated
  write path + anti-abuse) — the trigger foundation already supports it.
