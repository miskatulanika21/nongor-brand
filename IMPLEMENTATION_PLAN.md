# IMPLEMENTATION_PLAN — Nongorr Studio Phase 2

Stage-by-stage plan with exit criteria. Derived from
`nongorr-phase-2-antigravity-prompt.md` (V3). Update after each stage; keep in
sync with `CURRENT_STATUS.md`.

> **2026-07-23 — Stage 6 P1/P2 closed + final-stage audit (PRs #44/#45, `main` @
> `1323dab`; 750 Vitest; 92 migrations).** The two owner-deferred Stage-6 passes
> shipped now that an email provider is connected (Resend + Cloudflare, domain
> `nongorr.com` verified DKIM+SPF): **P1 — notification outbox sender** drains
> `notification_events` and emails the customer on every shipment lifecycle event
> (atomic `api.claim_notification_batch`, `FOR UPDATE SKIP LOCKED`, attempts cap
> `< 5`, 15-min lease; best-effort inline drain at both courier webhooks +
> `/api/cron/notifications` daily catch-up) plus two-stage order emails
> (received → confirmed); **P2 — newsletter double opt-in** (footer subscribe
> emails a confirmation link; consent trail; `List-Unsubscribe`; confirm and
> unsubscribe routes under `/newsletter`). Migrations `20260723120000` (outbox
> sender) and `20260723120100` (newsletter double opt-in), both applied to prod.
> A **final-stage full-repo audit** then ran green (typecheck / lint / prettier /
> 750 Vitest / build) with **one dead-code removal** (`c9e5dfc`: unreachable
> footer `placeholder` link branch). Remaining launch work is unchanged and
> owner/legal-gated — see `docs/stage-7-launch-cutover.md` §7.
>
> **2026-07-19 — Launch-prep batch (PRs #25–#36, `main` @ `befa617`, CI green;
> 744 Vitest; 90 migrations).** Non-stage-opening work on top of the cut-over:
> **#25/#26** DB-backed founder profile (`/founder` + `/admin/founder`, migration
> `20260718202331`) + crawlable category landing pages (`/shop/:category` as
> distinct URLs); **#27** guest capability token renamed to "access code" in the
> UI; **#28** repaired `list_shipments` (and closed the API gaps it exposed);
> **#29** real Bangladesh address hierarchy — Pathao now booked **by zone id**
> instead of parsed free text (migrations `20260719124612` `…125350` `…143415`
> `…151130`); **#30** SEO: Bengali brand name নোঙর + product keywords in the
> homepage `<title>`; **#31** aligned two location migration filenames with prod
> history; **#32** owner-settable About-page logo from the admin panel (migration
> `20260719171741`); **#33** footer developer credit; **#34** the axe a11y suite
> now **actually runs** in CI; **#35** the About founder block reads from the CMS
> instead of being hardcoded; **#36** the post-deploy smoke targets the **public**
> domain on production deploys, not the SSO-protected per-deploy URL. Remaining
> launch work is unchanged and owner-gated — see `docs/stage-7-launch-cutover.md`
> §7. Credential exposure (2026-07-20): `TEST_CREDENTIALS.md` removed + **purged
> from git history** (`main` `db6aa88`→`bb3a7c7`, 33 stale branches deleted, push
> protection on); the **6 exposed prod accounts still must be rotated/deleted** —
> the scrub does not undo the public exposure.
>
> **2026-07-18 (evening) — Strict CSP fixed for cached pages + §4 verification +
> cut-over cleanup** (PR #24 `788ffe9`, then `2c7480f`, `ec5b1b8`, `59e9423`,
> `8ea8b19`; **708 Vitest**). `CSP_ENFORCE_STRICT=true` was a **partial no-op**:
> edge-cached public pages render nonce-free by design, and the strict policy was
> gated on a nonce, so the entire storefront would have kept
> `script-src 'unsafe-inline'` while only authenticated routes hardened — and the
> earlier "Report-Only clean" sign-off never covered those pages, which emitted no
> Report-Only header at all. Fixed with a **hashed** CSP for cached responses
> (`csp-hash.server.ts`), derived from the body so header and body cache as one
> unit, failing **open** if hashes can't be built. ⚠ CSP hashes cover the
> **post-parse** script text (U+0000 → U+FFFD, CRLF → LF), so `curl`/`fetch` will
> confirm a policy the browser rejects — verify by real navigation only.
> Separately: indexing was found **ON** in production and re-closed
> (`VITE_ALLOW_INDEXING=false` + redeploy — build-inlined, so the redeploy is
> mandatory); the old `nongor-brand.vercel.app` alias, previously a live 200
> duplicate, now 308s to the apex; `ADDITIONAL_ALLOWED_ORIGINS` cleared and
> verified in both directions; §4 verification passed bar Google OAuth and the
> place-an-order proof; `PATHAO_SANDBOX_ENABLED` verified **absent** from
> Production. Remaining P7 work is owner-gated: legal copy + photography (which
> gate indexing), HSTS preload, the strict-CSP flip, rotation, CI/CD + backup
> secrets, one real shipment.
>
> **2026-07-18 — Focal Studio + launch-prep polish** (PRs #14–#19, `main` @
> `d8120f7`, CI green; **688 Vitest**). Non-stage-opening polish on top of the
> cut-over: **#14 Focal Studio** — non-destructive image framing for banners and
> product primary images (normalized focal point stored as `focal_x`/`focal_y`
> and applied as CSS `object-position`; reusable `<ImageFramer>` + shared
> `image-focal.ts`; optional FaceDetector/saliency auto-frame; migration
> `20260717175716` additive and **applied to prod**; also drops the no-op
> `upgrade-insecure-requests` directive from the Report-Only CSP). **#15** shared
> edge cache for anonymous public pages (three fail-closed guards; nonce-free
> cached render) removing ~1.5 s of SSR document latency. **#16** mobile side
> sheets sized to the dynamic viewport. **#17** proprietary LICENSE + SECURITY.md.
> **#18** Google Search Console verification meta (does not touch `noindex`).
> **#19** project README. Remaining launch work is unchanged and owner-gated —
> see `docs/stage-7-launch-cutover.md` §7.
>
> **2026-07-17 — Domain cut-over + courier contract rebuild** (PR #12,
> `b4d1d44`, CI green incl. migrations-local; **670 Vitest**; migration
> `20260717120221_record_shipment_event` applied to prod). **`nongorr.com` now
> serves this app** — apex Production, `www` 308 → apex, canonical verified live,
> deliberately still `noindex` pending legal sign-off. No DNS change was needed
> (records already pointed at Vercel); the blocker was the domain being claimed by
> a **different Vercel account**. Separately, the Stage-5 courier layer was found
> to have **never been capable of working** — built against guessed provider
> contracts: a NXDOMAIN SteadFast host, an `X-Webhook-Secret` header neither
> provider sends, an unimplementable Pathao registration handshake, a status read
> from a field that doesn't exist, an invented 24-slug vocabulary, and a token
> grant Pathao rejects. Eleven bugs, each verified against published docs **and**
> live probes (`docs/stage-7-launch-cutover.md` §8.1); Pathao sandbox now books
> end-to-end through the real adapter and production auth is verified read-only.
> **The Stage-5 tests passed throughout** because they asserted our own invented
> vocabulary — pinning the bug instead of catching it. Remaining P7 work is
> owner-gated: webhook secrets, `VITE_ALLOW_INDEXING`, HSTS preload, legal copy.
>
> **2026-07-16 — Codex (GPT-5) order-workflow remediation** (MERGED & DEPLOYED,
> `main` @ `b17e589`, CI all-green incl. migrations-local). A cross-cutting pass
> addressing the ten Codex findings: guest idempotent replay redesigned around a
> **client-held capability token** (SHA-256 hash stored server-side, replay
> returns the original order unchanged — no rotation; migration
> `20260713120000_guest_token_client_held.sql`, 9-arg `place_order`, applied to
> prod during the editing phase and verified in a rolled-back transaction),
> idempotency-key persistence, staging guard fail-closed, checkout/cart
> quote-race guard + submit gating, hydration gate, typed order/track error
> states, owner-scoped success fallback, order list/detail correctness, checkout
> a11y (Select aria + payment radiogroup), and DOM-free zoom math. 631 tests;
> browser-retested at 390/768/1440. It does not open/close a numbered stage —
> see `docs/Nongorr_Remediation_Report_2026-07-13.md` (rev 2) for full scope and
> the still-deferred items (#10 pinch matrix, #8 additive projections, real-order
> E2E needs the staging project in `docs/staging-supabase-runbook.md`).

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
- [x] Pass 3g+ — retire the legacy `PRODUCTS` array entirely. **Done in Stage 5**
      (`orders.ts` + `admin-ops.ts` deleted; no `const PRODUCTS` remains in `src/`).

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
- [x] Pass 5 (2026-07-01) — **real coupons** (replaces the display-only mock):
  - [x] **P5a** — `coupons` + `coupon_usages` (RPC-only deny-all; migration
        `20260701150858`). Premium schema: `percent`/`fixed`/`free_shipping`,
        `min_subtotal`/`max_discount`/`usage_limit`/`per_user_limit` (may exceed 1)
        /`first_order_only`/window + maintained `usage_count`.
  - [x] **P5b** (`20260701152057`) — `quote_order`/`place_order` coupon-aware
        (shared `private.coupon_reason`/`coupon_amount`); race-safe consume under
        the coupon row lock; free-delivery threshold stays on pre-discount subtotal;
        codes `invalid_coupon`/`coupon_min_not_met`/`coupon_exhausted`/
        `coupon_not_eligible`. Old 2-arg/7-arg overloads dropped.
  - [x] **P5c** — retired `MOCK_COUPONS`/`findCoupon`/`couponDiscount`; store keeps
        only the code; cart/checkout read the server discount + `coupon.applied/
reason`; stale code silently drops at place (never blocks checkout).
  - [x] **P5d** (`20260701155119`) — admin coupon CRUD RPCs (`list_coupons`/
        `upsert_coupon`/`set_coupon_active`/`delete_coupon`) behind
        `guardAdminWrite("coupons.manage")` + canonical `coupon.*` audit + used-
        coupon delete guard; `admin.coupons.tsx` DB-backed.
  - [x] **P5e** — `pass3_db.test.sql` §P5/§P5-admin (discount math, limits,
        eligibility, usage counter, admin guards, grant posture); fixed the grant-
        check signatures the P5b drops had left stale. 51 migrations; 388 Vitest.

**Exit:** one order per submission under retry; totals recomputed server-side;
checkout fully server-authoritative; admin runs the full lifecycle (confirm
through return+restock) safely under concurrent admins; customers track via
account or guest capability links; custom measurements captured server-side;
**coupons real, race-safe and admin-managed**. **STAGE 3 COMPLETE** (P1–P5,
2026-07-01). Legacy `orders.ts`/`PRODUCTS` remain Stage-5-gated (courier booking).

## Stage 4 — Customer accounts

Replace `account-ui.tsx` localStorage with `createServerFn`. Tables:
customer_profiles, saved_addresses, saved_measurements. Order history by
`auth.uid()`. Secure guest tracking (order id + verification factor, never phone
alone).

**Master plan (2026-07-02):** `docs/stage-4-customer-accounts-plan.md`. Note:
order history, guest capability tracking and order-time measurement capture
were already delivered by Stage 3 P4f/P4g — Stage 4 does not rebuild them.
Sub-passes:

- [x] **P1** (2026-07-02) — schema: `customer_profiles` / `saved_addresses` /
      `saved_measurements` (RPC-only deny-all; caps 10/12 documented for the P2
      RPCs; one-default partial unique index; bounded CHECKs; touch triggers).
      Migration `20260702080032` (prod-applied + rolled-back proof);
      `stage4_db.test.sql` §1–§6 wired into CI.
- [x] **P2** (2026-07-02) — account RPCs: `get_my_account` / `save_profile`
      (CASE-presence patch, lazy create) / address CRUD (`upsert_address`,
      `delete_address`, `set_default_address`; cap 10; exactly-one-default
      invariant with oldest-promotion) / measurement CRUD (cap 12; strict
      numerics; case-insensitive dedupe) / one-time `import_account_data`
      (row-by-row salvage, coercions, single default, `account.imported`
      audit). All SECURITY DEFINER service-role-only; per-user advisory write
      lock. Migration `20260702081309` (prod-applied + rolled-back proof);
      `stage4_db.test.sql` §7–§12.
- [x] **P3** (2026-07-02) — app server layer: `account-shared.ts` (DTOs, zod
      mirroring the DB CHECKs incl. post-round numeric bound, presence-
      preserving snake_case payload builders, defensive row mappers, stable
      error map), `server/account.server.ts` (service-role repo,
      `AccountError`), `account.api.ts` (GET read + 7 guarded POST writes:
      CSRF + verified session + `accountWrite` 30/10min; read `accountRead`
      60/min); `account.imported` added to the audit-action union;
      `account-shared.test.ts` (schema↔CHECK parity, builders, mappers,
      error-map exhaustiveness). No UI change (P4).
- [x] **P4** (2026-07-02) — account UI rewire: `AccountUIProvider` seeded from
      the `/account` layout loader (SSR snapshot, keyed per user), mutations
      async + optimistic with rollback and stable-code error toasts; one-time
      localStorage import → purge after server confirmation (sealed per user;
      `already_imported` seals too). 15-case provider test.
- [x] **P5** (2026-07-02) — prefill: checkout saved-address chips + post-order
      save-back; PDP saved-measurement picker + inline save-back (`f16532c`).
- [x] **P6** (2026-07-03) — `wishlist_items` server sync (migration
      `20260702175557`): `sync_wishlist` union-merge (dedupe, unknown-drop,
      cap 100) + `toggle_wishlist` (stable `product_not_found`/`wishlist_full`);
      store keeps guests local, gives signed-in users a per-user mirror key,
      one-shot merge on login, optimistic toggles with a stale-response guard;
      new `wishlistWrite` bucket. `stage4_db.test.sql` §13–§16 (`2120e0a`).
- [x] **P7** (2026-07-03) — guest-order claim (migration `20260702181916`):
      `api.claim_guest_order` — token hash is the only proof, `FOR UPDATE`
      row lock, single-statement owner flip preserving the XOR, non-oracular
      `order_not_found` collapse, `order_not_claimable` cross-account,
      idempotent same-user retry, in-transaction `order.claimed` audit;
      `ClaimOrderCard` on order-success + `/track` (sign-in round-trip via
      `next`). `stage4_db.test.sql` §17 (`ce66aff`).
- [x] **P8** (2026-07-03) — DB-backed `admin.customers.tsx` (migration
      `20260703062945`): `admin_list_customers` aggregates (counts/spend
      exclude cancelled+expired, returns, custom-size flag, profile→order
      snapshot identity fallback, search over displayed name/phone + email),
      P4b board pattern UI + detail sheet linking to the orders board; derived
      VIP/Repeat/High-Risk/Custom-Size tags computed in-app; mock `CUSTOMERS`
      retired. `stage4_db.test.sql` §18 (`6a80c1c`).
- [x] **P9** (2026-07-03) — closure: `stage4_db.test.sql` complete (§1–§18 in
      CI), `e2e/account.spec.ts` (account CRUD + checkout prefill; validated
      6/6 against a live dev server), advisors clean, visual pass on
      `/account/*` (desktop + mobile), status docs updated.

**Exit:** account data server-authoritative under deny-all RLS with owner-scoped
RPCs; one-time local import; checkout/PDP prefill one tap from saved data;
wishlist survives devices; guest orders claimable by token only; admin sees real
customers. **STAGE 4 COMPLETE** (P1–P9, 2026-07-03).

## Stage 5 — Admin sales ops & integrations

`CourierAdapter` interface; SteadFast + Pathao + Manual adapters; verified,
idempotent webhooks. Tables: courier_providers, shipments, shipment_events,
webhook_events, notification_events (outbox). Notifications via outbox, never
in the checkout transaction.

- [x] **Courier integration** (2026-07-07, `17dab60`) — migration
      `20260707150000`: shipment schema (RPC-only deny-all), order statuses
      15→17 (`courier_booked`, `delivery_failed`), 3-phase booking (no DB
      locks during external API calls), double-booking partial unique index,
      SteadFast (API-key) / Pathao (OAuth2 + token cache) / Manual adapters,
      secret-gated webhook endpoints, DB-backed `admin.courier.tsx`, COD
      computation + reconciliation fields; mock `orders.ts` / `admin-ops.ts`
      deleted. Hotfix `20260707162039` restored the `transition_order` restock
      branch the Stage-5 migration had broken.
- [x] **Review remediation pass** (2026-07-10/11) — a senior review verified 17
      external-audit findings against the code, then fixed everything
      launch-blocking in five parts (details in `CURRENT_STATUS.md`):
  - [x] **P1** — real owner-only Audit Logs viewer (`api.list_audit_logs`,
        migration `20260710190825`; was a hardcoded mock);
        `audit-shared.ts` single-source action taxonomy.
  - [x] **P2** — courier lifecycle actually progresses (migration
        `20260710193507`): `IF FOUND` record-NULL fix (no webhook had EVER
        transitioned an order), `courier_booked→delivered` direct (SteadFast
        has no pickup signal), transit statuses → shipped, poll maps
        raw→internal, "Mark delivered" admin action.
  - [x] **P3** — booking/webhook integrity (migration `20260710195925`):
        empty-consignment "success" rejected, SHA-256 raw-body webhook
        idempotency (was `Date.now()`), `processed`/`error` maintained, body
        cap on read bytes; **runtime P0**: courier RPCs called without
        `.schema("api")` — all courier ops had failed at runtime.
  - [x] **P4** — courier fns gate on `courier.view`/`courier.manage`.
  - [x] **P5** — real contact form + staff Messages inbox (migration
        `20260710204703`; `messages.view`/`messages.manage`); Banners/Reports/
        Size-Settings hidden behind "Coming soon" (no more mock-that-looks-
        real); client-bundle fix (server ops out of `staff.api`/`mfa.api`).
- [x] **P3 polish batch** (`462c42b`, migration `20260711083958`): booking
      `request_hash` enforcement (`booking_in_progress` vs `double_booking`),
      constant-time webhook-secret compare, real footer newsletter
      (`newsletter_subscribers` + `subscribe_newsletter`), `courierWrite`
      bucket for courier mutations, dead `PRODUCTS` deletion. The
      notification-outbox sender moved to **Stage 6 P1** (channel decision).

**Exit:** courier booking/tracking live end-to-end with idempotent, observable
webhooks; every admin surface either real or honestly labeled; audit trail
visible to the owner; customer contact persists to an inbox. **STAGE 5
IMPLEMENTED + REMEDIATED + POLISHED** (2026-07-11; 63 migrations; 543 Vitest;
`stage5_db.test.sql` incl. §polish in CI).

## Stage 6 — Content & operational modules

Banners, CMS/policies, newsletter consent/unsubscribe, reports + CSV, size
settings (persisted), notification-outbox sender. (Contact storage and the
owner-only audit viewer were delivered early in the Stage-5 remediation pass;
reviews moderation and site_settings landed in Stage 2.)

**Master plan:** `docs/stage-6-content-ops-plan.md` (2026-07-11). Same
posture as every prior stage: RPC-only deny-all tables, guarded server fns,
zod mirrors, audited staff writes, static fallbacks for every storefront
consumer. Sub-passes:

- [x] **P0 — decision gate** (resolved 2026-07-12): policy CMS body format =
      markdown; size-settings shape = structured charts (both shipped below).
      Notification channel/provider + extra events: **DEFERRED BY OWNER** —
      the owner will set up the provider (e.g. Resend needs their own domain's
      DNS for SPF/DKIM) when they connect their own domain; do not start P1/P2
      until then.
- [x] **P1 — notification-outbox sender** — **DONE (2026-07-23, PR #44
      `61ca92a`)** once Resend was connected. Migration `20260723120000` extends
      `notification_events` (`claimed_at/attempts/last_error`) + adds
      `api.claim_notification_batch` (FOR UPDATE SKIP LOCKED, 15-min lease,
      5-attempt ceiling, joins `orders` for recipient). `email.server.ts` =
      fetch-based Resend client (no SDK) with three sender identities
      (`orders@`/`hello@` send-only, `support@` Reply-To) + branded HTML/text
      layout; `notifications.server.ts` renders per-event templates and settles
      each row. Trigger = **best-effort inline drain at both courier webhooks** + `/api/cron/notifications` (`CRON_SECRET`-gated, daily on Vercel Hobby).
      (Simpler than the original pg_cron/pg_net + admin-tab design — inline drain
      covers timeliness on the free plan; kill-switch = unset `RESEND_API_KEY`.)
- [x] **P2 — newsletter consent management** — **DONE (2026-07-23, PR #44)**.
      Migration `20260723120100` upgrades `newsletter_subscribers` to
      status + `confirm_token`/`unsubscribe_token` + consent trail (source/ip),
      grandfathering existing rows to confirmed. Double opt-in: footer subscribe
      emails a confirm link (address joins only on confirm), welcome mail carries
      `List-Unsubscribe`; `/newsletter/confirm` + `/newsletter/unsubscribe`
      routes. (Admin subscriber list + CSV export not built — deferrable.)
- [x] **P3 — banners** (2026-07-11, migration `20260711162017`): `banners`
      table (schedule window, sort, media-library-only image, RPC-only
      deny-all) + cached public read + admin CRUD (`content.manage`, audited
      `banner.*`); `delete_media` in-use guard extended to banner images;
      `HeroSection` consumes the lowest-sorted live banner with the built-in
      hero as fallback; nav un-hidden; `stage6_db.test.sql` §banners in CI;
      live-drive verified end-to-end (publish → hero swap → cleanup).
- [x] **P4 — policies CMS** (2026-07-11, migration `20260711165114`):
      `site_pages` (fixed slugs, draft jsonb) + `site_page_revisions`
      (pruned to 20), seeded byte-identical from today's static copy; the 4
      Prose pages (delivery/payment/cookie/authenticity) render from the DB
      through a dependency-free React markdown renderer with static JSX
      fallback; designed pages (return/terms/privacy/custom-size) stay in
      code and the admin says so honestly; real editor (Edit/Preview/History
      tabs, draft→publish→revision→restore) replaces the dead Edit button;
      `stage6_db.test.sql` §pages in CI; visually verified end-to-end in a
      real browser (edit → publish → storefront swap → restore).
- [x] **P5 — size settings** (2026-07-12, migration `20260711215507`):
      `size_charts` single table (ordered `columns` + aligned `rows` jsonb,
      deep RPC validation, `label_header`/`helper_column`/unit/popular flag),
      seeded byte-identical with the three hardcoded charts; size-guide fixed
      tab + its starting-point helper render from the DB with the static
      arrays as fallback (measurement ILLUSTRATION stays a static image);
      `admin.size-settings.tsx` rebuilt as a real grid editor (add/remove
      rows+columns, ★ Most Selected, live toggle, `sizes.manage`, audited
      `size_chart.*`); nav un-hidden (staff lack `sizes.manage` — tested);
      `stage6_db.test.sql` §sizes in CI; visually verified end-to-end (grid
      cell edit → storefront table + helper → reverted via audited RPC).
- [x] **P6 — reports + CSV** (2026-07-12, migration `20260711211537`): five
      read-only aggregate RPCs (sales summary with confirmed/delivered
      definitions, top products, coupon ledger, courier performance with
      avg-hours-to-deliver from the history log, COD reconciliation) —
      service-role only, active-staff checks; `admin.reports.tsx` rebuilt
      (URL-backed date range + presets, StatCards, recharts, per-section CSV + PII-free orders CSV via the shared BOM/quoting/formula-safe `toCsv`);
      nav un-hidden (staff lack `reports.view` — verified in tests);
      `stage6_db.test.sql` §reports in CI; visually verified in a real
      browser against seeded fixtures with hand-checked figures.
- [x] **P7 — closure** (2026-07-12): nav/RBAC sanity + real-browser visual
      pass + live-drive verification were done per pass as each screen
      shipped (`admin-routes.test.ts` asserts visibility per role); the
      notification-send check moves to P1 (deferred with it); single
      status-doc sync done at closure (this file + `CURRENT_STATUS.md` +
      `WALKTHROUGH.md`).

**Exit:** every hidden admin screen real and visible; storefront content
(banners/policies/size charts) DB-backed with static fallbacks; reports run
off live data with CSV export. **STAGE 6 CLOSED for the content scope
(P3/P4/P5/P6 + P7, 2026-07-12; 67 migrations; 576 Vitest;
`stage6_db.test.sql` in CI; every pass visually verified in a real
browser).** The notification sender (P1) + newsletter consent (P2) are an
owner-deferred addendum: they resume when the owner connects their own
domain and picks the provider — the original exit criteria for
notifications/newsletter apply to that addendum, not to this closure.

## Stage 7 — Hardening & launch

**Master plan:** `docs/stage-7-hardening-launch-plan.md` (2026-07-12). The
go-live stage — deliverable is **operational confidence, not features** (ships
zero new customer-facing functionality). Hardens the unhappy paths (attack,
load, provider outage, data loss, bad deploy) and proves what we can assert
about them. Sub-passes:

- [x] **P0 — decision gate** (resolved 2026-07-12): monitoring = **Sentry**;
      backup tier = **Free** (no PITR → P6 builds a scheduled `pg_dump`
      pipeline + restore drill); launch domain = **ready** (P7 full cut-over;
      SPF/DKIM prerequisite satisfied); legal copy = **launch-blocking** (owner
      to supply); go-live bar = **all four blocking** (real photography, legal,
      notification sender, visual-audit polish). **Consequence: the deferred
      Stage-6 P1/P2 notification sender + newsletter consent are REACTIVATED
      into launch scope as pass P3.5** — SMS provider + Resend confirmation is a
      sub-decision asked at that pass's start.
- [x] **P1 — security hardening & closure** (2026-07-12): **P1a CSP nonce**
      — per-request nonce (ALS-shared: `getRouter` `ssr.nonce` + header) drives
      a strict `Content-Security-Policy-Report-Only` (nonce + `strict-dynamic`,
      no `unsafe-inline`, `report-uri /api/csp-report`) alongside the unchanged
      enforced policy; live-verified (header nonce == all 76 script nonces ==
      csp-nonce meta); flip `CSP_ENFORCE_STRICT=true` after the prod watch.
      ⚠ **Amended 2026-07-18:** that flip was a **partial no-op** — edge-cached
      public pages render nonce-free, so the strict policy skipped them entirely
      and they never emitted a Report-Only header to reveal it. Cached responses
      now carry a **hashed** CSP (`csp-hash.server.ts`); the flip is only
      genuinely whole-site from that commit (`788ffe9`) onward.
      **P1b** rate-limit coverage audit enforced by `rate-limit-coverage.test.ts`
      (all ~124 server fns classified; caught+fixed 3 unthrottled ops).
      **P1c/F-14** `api.promote_to_staff` — invite-or-promote flow (owner/MFA
      gated, audited; migration `20260712124515`). **P1d** secrets inventory +
      rotation runbook (`docs/stage-7-secrets-and-rotation.md`). **P1e** security
      review + advisors sweep (`docs/stage-7-security-review.md`; advisors =
      known-intentional only, no new items). **Two owner-gated flips remain:**
      set `CSP_ENFORCE_STRICT=true` (after watch) and enable leaked-password
      protection (dashboard).
- [x] **P2 — concurrency & correctness suite** (2026-07-12): `concurrency-orders.test.sh`
      fires N=8 parallel psql connections at `api.place_order` proving oversell
      (product-row FOR UPDATE → exactly 1 order, rest `out_of_stock`), duplicate
      order (idempotency*keys unique key → exactly 1 order for a shared key), and
      coupon exhaustion (coupon-row FOR UPDATE + `usage_count`, `usage_limit=1` →
      exactly 1 consumed, no over-grant). Wired into the migrations-local CI job;
      **passed in CI under real parallel connections** (logic also prod-proven
      sequentially via a rolled-back txn). *(Reservation-expiry race + a k6/
      autocannon throughput baseline deferred as optional — not launch-gating.)\_
- [x] **P3 — observability & error monitoring** (2026-07-13): `/api/health`
      readiness probe (DB round-trip via `api.healthz()` migration
      `20260712171719`; 200 ok / 503 degraded; verified) for uptime + P5 smoke;
      **Sentry** error monitoring behind the DSN flag — client `@sentry/react`
      (lazy) + server `@sentry/node` (`captureServerException` on both SSR error
      paths, release=sha), CSP `connect-src` opens `*.sentry.io` only when
      configured; server capture **verified end-to-end against the real DSN**.
      Chose the lean SDK over `@sentry/tanstackstart-react` to preserve the
      security-critical custom `server.ts`. `docs/stage-7-observability.md` has
      owner setup. **Owner action:** add `SENTRY_DSN` + `VITE_SENTRY_DSN` to
      Vercel + point an uptime monitor at `/api/health`. _(Source-map upload +
      structured request-id logging + admin dead-letter tile deferred as
      optional, non-launch-blocking.)_
- [ ] **P3.5 — notification sender + newsletter consent** (reactivated from
      Stage 6 by the P0 decisions; built per `docs/stage-6-content-ops-plan.md`
      §P1/§P2): outbox `notification_events` extension (status/attempts/backoff/
      `dedupe_key`/recipient snapshot) + `claim_notification_batch` (SKIP LOCKED) + `mark_notification_result` (backoff + dead-letter), Settings kill switch;
      `NotificationChannelAdapter` seam + first adapter (SMS BD aggregator +
      Resend email), unit-tested templates, secret-gated `pg_cron`+`pg_net`
      drain, admin visibility tab; P2 = `unsubscribe_token` + one-click
      `/newsletter/unsubscribe` + `List-Unsubscribe` + admin subscriber list/CSV.
      Live-drive one real send before closing.
- [~] **P4 — performance & accessibility** (2026-07-13): **A11y DONE** —
  `e2e/a11y.spec.ts` (axe WCAG 2.0/2.1 A+AA) **passes on all 7 key routes**
  (home/shop/cart/checkout/login/size-guide/contact); fixed eyebrow gold
  contrast (→ #7d5e22), slider label, every SelectTrigger `aria-label`,
  social `role="img"`, a muted note. **Perf BASELINED** (Lighthouse mobile:
  score 74, LCP 4.5s, **CLS 0**, TBT 200ms; hero img already optimal, LCP
  anchored by FCP/payload) — `docs/stage-7-perf-a11y.md`. **LCP-to-<2.5s
  optimization** (shrink the 609 KiB entry chunk + 158 KiB CSS + self-host
  fonts) is a scoped follow-up (iterative bundle work). Bundle-budget CI
  guard + manual keyboard walkthrough also outstanding.
- [x] **P5 — CI/CD & release engineering** (SHIPPED, 2026-07-16): post-deploy
      Playwright smoke (`smoke.yml`) on the deploy URL, gated preview→prod
      promotion, migration-parity guard, rollback runbook (app = Vercel instant
      revert; DB = forward-only + PITR break-glass), release-notes convention. See
      `docs/stage-7-cicd-and-rollback.md`. (2026-07-19 `#36`: the smoke job now
      targets the **public** domain on production deploys, not the SSO-protected
      per-deploy URL.)
- [x] **P6 — backup / restore / DR** (SHIPPED, 2026-07-16; restore drill VERIFIED
      GREEN, RTO ≈ 1 s): runbook + working tooling (`backup.yml`,
      `restore-drill.yml`, `scripts/backup-db.sh`, `scripts/backup-storage.mjs`);
      Storage-bucket backup verified live; DR decision tree. See
      `docs/stage-7-backup-and-dr.md`. _(Owner action: add the three backup secrets
      per §7 to enable the encrypted DB backup — the drill needs none of them.)_
- [ ] **P7 — content, legal & launch cut-over**: visual-audit fix list (real
      photography, badge clutter, star rounding, ৳ glyph, social buttons);
      legal copy finalized via the P4 CMS `site_pages`; domain + TLS + HSTS
      preload + OAuth redirect + cookie domain cut-over; **final credential
      rotation**; confirm the launch domain string + set email SPF/DKIM (the
      notification/newsletter rail itself ships in P3.5); go-live checklist.
- [ ] **P8 — stage closure**: full regression + smoke green; final advisors /
      security-review / a11y / CWV numbers recorded; status docs synced once.

**Exit:** CSP nonce-enforced with no `script-src 'unsafe-inline'`; every server
fn rate-limited (test-enforced); F-14 shipped; the three money-path races
proven under parallel connections; an unhandled server error is visible in the
tracker within seconds; LCP < 2.5s mobile captured; a restore drill completed
with recorded RTO/RPO; production promotion gated + reversible; domain live and
secrets rotated. Stage-6 P1/P2 (notification sender + newsletter consent) are
**not** built here — P7 only opens their gate.

**Recommended order:** P0 ✓ → P1 → P2 → P3 → P3.5 → P4 → P5 → P6 → P7 → P8
(P2/P4/P6 are independent, good multi-PC parallel candidates).

## Working rules (every stage)

Baseline `bun run check` and read source before changing it. Preserve the
existing UI/flows (V3 preservation contract). Never fake integrations,
credentials, or payment/courier responses. Update `CURRENT_STATUS.md`,
`IMPLEMENTATION_PLAN.md`, `WALKTHROUGH.md` after each stage.
