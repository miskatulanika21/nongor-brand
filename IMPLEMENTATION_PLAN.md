# IMPLEMENTATION_PLAN — Nongorr Studio Phase 2

Stage-by-stage plan with exit criteria. Derived from
`nongorr-phase-2-antigravity-prompt.md` (V3). Update after each stage; keep in
sync with `CURRENT_STATUS.md`.

## Stage 1.5 — Security closure (current)

**Done (code) — four confirmed bugs:**

- [x] Bug 1 — `api` schema wrappers + `staff.api.ts` uses `.schema("api").rpc()`
- [x] Bug 2 — `invite` confirm type wired end-to-end (→ set initial password)
- [x] Bug 3 — `requireStepUp()` (AAL2) in the three staff mutations, gated by
      `ENFORCE_ADMIN_MFA`
- [x] Bug 4 — `admin_read_audit_logs` RLS tightened to owner-only

**Done (code) — five mandatory items (A–E):**

- [x] A — `withSecurityHeaders()` rebuilds the Response (no in-place mutation, no
      swallowed failure); 7 tests incl. multi-`Set-Cookie`, redirect, streaming
- [x] B — `checkIndependentRateLimit()` separate per-IP + per-account buckets at
      all account-bearing auth ops; trusted-proxy boundary documented; 5 tests
- [x] C — `guard_owner_safety` takes a transaction advisory lock before the
      owner-count check (new migration `20260622130000`); SQL proof in report
- [x] D — verified the three critical RPCs write their canonical audit row in the
      same transaction as the mutation (no swallow, rolls back together); not an
      outbox; supplementary best-effort writes clearly distinguished
- [x] E — `.github/workflows/ci.yml` (Bun, frozen lockfile, mandatory
      typecheck/lint/format/test/build, concurrency cancel, least-privilege,
      advisory Supabase lint that skips visibly without secrets)

**Done (code) — follow-up hardening patch (2026-06-23):**

- [x] 1 — env-validation latch fixed (success recorded only after validation)
- [x] 2 — authorize before privileged staff lookup (no existence oracle)
- [x] 3 — MFA enrollment: rate limit + AAL2-when-verified + cleanup + audit
- [x] 4 — `authz.denied` carries the verified actor id (null only if anon)
- [x] 5 — CI: `SUPABASE_DB_PASSWORD` gate + local migrate-from-empty job
- [x] 6 — pinned Bun (1.3.14) and Supabase CLI (2.33.9)
- [x] 7 — operator scripts use `schema("api")`; redundant direct write removed
- [x] 8 — corrected the over-absolute security-header comment

**Stage 1.5: OPERATIONALLY CLOSED (2026-06-23).**

- [x] Migrations applied (now 17 total applied; ledger == repo files)
- [x] `api` exposed in PostgREST (Data API → Settings); `private` hidden
- [x] Ledger reconciled (`supabase migration list` equivalent verified via MCP)
- [x] Item C concurrency + Item D rollback proofs run (rolled-back SQL proofs)
- [ ] Rotate & revoke Stage 1-committed credentials (deferred to go-live, owner)
- [ ] MFA rollout → `ENFORCE_ADMIN_MFA=true` (owner)
- [ ] Enable leaked-password protection (Auth dashboard, owner)
- [ ] Real-email invite E2E (owner)
- [ ] `curl -I` deployed origin for headers (owner, once deployed)

Remaining boxes are owner/operator go-live actions and do not block Stage 2.

## Stage 2 (Pass 2+) — Catalog writes

Admin product/category/inventory/media/settings writes; inventory
movements/reservations; collections; DB-backed category counts &
color/fabric facets; Storage media library; rating/review_count maintenance.
Enforce `products.manage` / `categories.manage`. Retire the `PRODUCTS` array
once the admin write path is DB-backed.

**Progress (2026-06-23):**

- [x] Pass 1 — public catalog read path (DB-backed)
- [x] Pass 2 — admin **product** + **category** writes (DB-backed, transactional
      canonical-audit RPCs, atomic reorder, immutable product code, archive-only)
- [x] Pass 2 — **inventory**: append-only movement ledger; `api.set_inventory`
      (FOR UPDATE lock, actor/active-staff, sized/non-sized, zero-delta, bounds);
      `products.stock` write-guard; FK RESTRICT; bounded idempotent
      `api.bulk_set_inventory`. All verified via rolled-back SQL proofs.
- [x] Pass 2 follow-up (2026-06-25) — **stable inventory error codes** (RPCs raise
      snake_case code as message + human DETAIL; `InventoryError` single-op path;
      bulk forwards `error_code`; isomorphic `inventoryErrorMessage` so the UI
      shows granular per-item reasons) + **perf advisor cleanup** (merged
      `staff_profiles` SELECT policies → `staff_select_self_or_admin`;
      `idx_movements_actor`). Migrations `20260625120000`, `20260625130000`.
- [x] Pass 3a (2026-06-25) — **review moderation + rating/review_count sync**:
      trigger keeps the product snapshot == aggregate of approved reviews;
      `api.set_review_status` / `api.delete_review` (service-role, stable codes,
      canonical audit); `admin.reviews.tsx` DB-backed (was mock). Migration
      `20260625140000`.
- [x] Pass 3b (2026-06-26) — **authenticated customer review submission**:
      `product_reviews.user_id` + one-per-user-per-product; `api.submit_review`
      (service-role, visibility + bounds + dedupe, inserts pending, audit);
      `submitReview` server fn (auth-required + rate-limited); product-page form
      persists. Migration `20260626120000`.
- [x] Pass 3c (2026-06-26) — **DB-backed catalog facets & counts**: `api.catalog_facets()`
      (STABLE, SECURITY DEFINER, explicit visible-only predicate, anon/authenticated
      EXECUTE) returns per-category counts + distinct colours/fabrics/occasions;
      `getCatalogFacets` server fn; `_site.shop.tsx` sidebar renders DB facets;
      `rollupCategoryCounts` collapses cosmetics types; removed hard-coded
      `COLORS/FABRICS/OCCASIONS` + `categoryCount`. Migration `20260626130000`.
- [x] Pass 3d (2026-06-26) — **DB-backed site settings**: single-row
      `site_settings` (RPC-only) + `api.get_public_settings` (anon, no secrets) /
      `api.get_admin_settings` / `api.save_settings` (service-role + active-staff,
      CASE-presence patch, audited); storefront announcement bar reads the DB
      (`_site` beforeLoad → `SiteHeader`); `admin.settings.tsx` persists via
      `guardAdminWrite("settings.manage")`. Migration `20260626140000`.
- [x] Pass 3e (2026-06-26) — **Storage-backed media library**: `product-media`
      public bucket + `media_assets` (RPC-only); signed-URL upload flow
      (`requestMediaUpload` → browser PUT → `register_media`), `api.delete_media`
      / `api.list_media` (usage counts), audited; `admin.media-library.tsx`
      rewritten DB-backed. Migration `20260626150000`.
- [x] Pass 3f (2026-06-26) — **Product gallery management**: `api.set_product_media`
      (service-role) atomically replaces a product's `product_media` from the media
      library — active-staff check, bounds 0–12, library-only for new images
      (legacy URLs survive resubmit), ≤1 primary (else first), `product.media_changed`
      audit; `admin.products.tsx` Gallery section (picker, reorder, set-primary).
      Migration `20260626160000`. Hardened (`20260626170000`): `(product_id,url)`
      unique index + `duplicate_media`, alt-length CHECK + alt editor, 12-image UI
      guard, optimistic concurrency (`gallery_revision` → `gallery_conflict`).
- [x] Pass 3g (2026-06-27) — **admin dashboard cut off mock `PRODUCTS`**: dashboard
      Low Stock / Best Sellers widgets read the live product table.
- [ ] Pass 3g+ — retire the legacy `PRODUCTS` array entirely; further catalog polish.

**Exit:** admin changes persist and drive the storefront; no mock array for
catalog; permissions enforced server-side. (Pass 3g+ outstanding.)

## Stage 3 — Checkout & orders

Server-authoritative pricing (never trust client totals); transactional order
creation (validate stock → reserve → order → items → payment → commit);
idempotency key; sequential server-generated order numbers; `PaymentProvider`
interface + `ManualBkashProvider`. Tables: orders, order_items,
order_status_history, payments, payment_screenshots, coupons, coupon_usages,
idempotency_keys. localStorage migration per the V3 table (one-time flag).

**Progress (2026-06-27):**

- [x] Pass 1 — **order schema, numbering & idempotency** (RPC-only deny-all tables:
      orders / order_items / order_status_history / payments / payment_screenshots /
      idempotency_keys; integer-BDT balanced-total CHECK; append-only status history;
      verified-TrxID uniqueness fraud guard; `order_no_seq`). Migration
      `20260627130000`. Structure only — no behavior.
- [x] Pass 1r — **inventory reservations**: `inventory_reservations` soft holds,
      lazy-backstop `private.available_qty` (counts only unexpired holds), `pg_cron`
      TTL sweep `api.expire_reservations`. Migration `20260627140000`.
- [x] Pass 3a — **server-authoritative pricing/order RPCs**: `api.quote_order`
      (public; per-line availability + `quote_token` drift fingerprint) and
      `api.place_order` (service-role only; race-safe idempotency via ON CONFLICT,
      deterministic product locks, server pricing, oversell + price-drift guards,
      reservation + guest token; stable error codes). Migration `20260627150000`.
- [x] Pass 3b (2026-06-27) — **checkout app integration** (complete): admin-configurable
      payment methods (`cod_enabled` + `payment_methods_enabled[]`, migration
      `20260627085345`) + admin "Payment methods" UI + isomorphic `checkout-shared`
      module + `checkout.server.ts` repository + `checkout.api.ts` server fns +
      checkout-route rewire (method selector, quote-driven totals, placeOrderFn with
      CSRF + rate-limit + identity + method validation, idempotency key minting +
      quoteToken drift guard) + cart reconciliation (quoteOrderFn on mount, per-item
      warnings, auto-correct quantities) + order-success page refresh
      (ServerOrderSuccess component with search-param routing) + F-04 gate removed.
      Rate-limit buckets: `quoteOrder` (60/min), `placeOrder` (10/10min).
- [x] Pass 4 (DB layer) — **order-lifecycle / payment / read RPCs** (live in prod
      2026-06-27; committed to repo 2026-06-30 `df207c9` after a drift was found):
      `api.transition_order` (state machine + optimistic version + reservation
      consume/release + optional restock), convenience wrappers (`verify_payment`,
      `reject_payment`, `confirm_cod`, `cancel_order`, `return_order`),
      `api.submit_payment_evidence` (TrxID/sender/screenshot + duplicate flag),
      admin reads (`list_orders`, `get_order_detail`), customer reads
      (`list_my_orders`, `get_my_order`, `track_order`). Migrations
      `20260627210911`–`20260627211152`. **All service-role-only; no app wiring yet.**
- Pass 4 (app integration) — wiring the live Pass-4 RPCs into the UI. Master plan:
  `docs/stage-3-pass4-admin-orders-plan.md`. Sub-passes:
  - [x] **P4a** (2026-07-01) — shared 15-status model (`orders-shared.ts`: meta,
        lanes, `ALLOWED_TRANSITIONS` in lockstep with `api.transition_order`,
        `nextActions`, DTOs, error map, zod) + server layer (`orders.server.ts`
        service-role repo, `orders.api.ts` guarded server fns: list/detail +
        transition/verify/reject/confirm-cod/cancel/return) + unit tests. No UI.
  - [x] **P4b** (2026-07-01) — DB-backed **admin orders board** (`admin.orders.tsx`):
        URL-as-state loader on `listOrdersFn`, lane-grouped status filter, debounced
        server search, pagination, tone badges, read-only summary sheet. Replaces the
        mock `ORDERS` board.
  - [x] **P4c** (2026-07-01) — order detail sheet + lifecycle action buttons
        (`getOrderDetailFn` + `nextActions` → matching server fn,
        `expected_version`, return with restock toggle).
  - [x] **P4d** (2026-07-01) — DB-backed payments review queue
        (`admin.payments.tsx` off `listOrdersFn`); duplicate-TrxID warning;
        `admin_order_stats` RPC; dashboard stats off mock onto real data.
        Migrations `20260701100539`, `20260701102954`.
  - [x] **P4e** (2026-07-01) — payment evidence: private `payment-evidence`
        Storage bucket (prod migration `20260630195555`), customer evidence form
        (`submitPaymentEvidenceFn`, CSRF + rate-limit + owner/guest scope), admin
        signed-URL viewer.
  - [x] **P4f** (2026-07-01) — customer order history + tracking:
        `listMyOrdersFn` / `getMyOrderFn` / `trackOrderFn` + `customerProgress`
        6-step timeline; DB-backed customer order list/detail; guest tracking
        shifted to capability model (order number + token, `/track?o=&t=`).
        Mock `ORDERS` board paths retired; `order-ui.ts` deleted (helpers
        relocated to `bd-phone.ts` + `measurements.ts`). Legacy
        `orders.ts`/`PRODUCTS` survive only for courier (`admin.courier.tsx` +
        `admin-ops.ts`) — Stage-5-gated.
  - [x] **P4g** (2026-07-01) — custom-order measurements captured server-side:
        `order_items.custom_measurements jsonb` (migration `20260701094647`),
        threaded through `place_order` / all read RPCs, rendered in
        `<MeasurementsList>`; excluded from `quote_token` canon (no drift).
  - [x] **P4h** (2026-07-01) — `pass4_db.test.sql` (order lifecycle + customer
        reads + grant posture); confirmed/fixed a latent bug in
        `consume_reservations` / restock (called non-existent `set_inventory`
        signature; migration `20260701110357`). 48 migrations total; 385
        Vitest + 3 DB integration suites green.

**Exit:** one order per submission under retry; totals recomputed server-side;
checkout fully server-authoritative; admin runs the full lifecycle (confirm
through return+restock) safely under concurrent admins; customers track via
account or guest capability links; custom measurements captured server-side.
**Pass-4 app integration complete.** Legacy `orders.ts`/`PRODUCTS` remain
Stage-5-gated (courier booking).

## Stage 4 — Customer accounts

Replace `account-ui.tsx` localStorage with `createServerFn`. Tables:
customer_profiles, saved_addresses, saved_measurements. Order history by
`auth.uid()`. Secure guest tracking (order id + verification factor, never phone
alone).

## Stage 5 — Admin sales ops & integrations

`CourierAdapter` interface; `SteadFastAdapter` then `PathaoAdapter` (only with
rotated credentials); verified, idempotent webhooks. Tables: courier_providers,
shipments, shipment_events, webhook_events, notification_outbox. Notifications
via outbox, never in the checkout transaction.

## Stage 6 — Content & operational modules

Reviews moderation, banners, CMS/policies, contact storage, newsletter
consent/unsubscribe, reports + CSV, owner-only audit viewer, site_settings
(move `brand.ts` values to DB).

## Stage 7 — Hardening & launch

Security review, rate limiting extended to all public mutations, concurrency
tests (oversell/coupon race/duplicate order), error monitoring, CI/CD deploy,
backup/restore docs, perf (LCP < 2.5s mobile) and a11y audits, CSP tightening,
legal review.

## Working rules (every stage)

Baseline `bun run check` and read source before changing it. Preserve the
existing UI/flows (V3 preservation contract). Never fake integrations,
credentials, or payment/courier responses. Update `CURRENT_STATUS.md`,
`IMPLEMENTATION_PLAN.md`, `WALKTHROUGH.md` after each stage.
