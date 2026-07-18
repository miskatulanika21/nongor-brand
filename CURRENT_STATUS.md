# CURRENT_STATUS — Nongorr Studio

Authoritative record of verified project state. Code and live-environment
behavior are the source of truth; this file is updated after every stage.

\_Last updated: 2026-07-18 — **Focal Studio + launch-prep polish shipped to
`main`** (PRs #14–#19; **688 Vitest** green, 61 files; CI green). Six changes
landed on top of the 2026-07-17 cut-over, all owner-mergeable and none opening a
new stage:

- **#14 Focal Studio** — non-destructive image framing. A normalized focal point
  (`focal_x`/`focal_y`, 0..1, default 0.5) is stored per banner and per product
  primary image and applied as CSS `object-position`, so subjects stay framed at
  every breakpoint with **no re-cropped file**. Reusable `<ImageFramer>`
  (drag/click reticle, rule-of-thirds, keyboard nudge, WYSIWYG hero preview +
  text-safe-zone overlay) and a shared `image-focal.ts` drive both editor and
  render. Optional ✨ auto-frame uses `FaceDetector` + a saliency fallback.
  Migration `20260717175716` (focal columns + focal-aware `get_active_banners` /
  `upsert_banner`) is additive, backfills existing rows to centre, and is
  **applied to prod**. Also folded in a CSP fix: `upgrade-insecure-requests` is a
  no-op in a Report-Only header (Chrome warned on every page) and is now emitted
  only when the strict policy is enforced. ⚠ PDP is `object-contain` (focal N/A);
  category tiles have no DB-backed image yet (deferred).
- **#15 Shared edge cache** — anonymous public pages (`/`, `/shop`,
  `/product/*`, `/about`, `/size-guide`, `/new-arrivals`) now serve from a shared
  edge cache, cutting the ~1.5 s SSR document-latency the DocumentLatency insight
  flagged. Three fail-closed guards keep per-user data out: a path allowlist, a
  no-auth-cookie requirement, and a plain-200-no-Set-Cookie check. Cached hits
  render nonce-free (the enforced CSP already allows scripts via `unsafe-inline`);
  authenticated/dynamic responses stay fresh and private.
- **#16 Mobile side sheets** sized to the dynamic viewport so bottom actions stay
  reachable on mobile.
- **#17 Proprietary LICENSE + SECURITY.md** + repo metadata.
- **#18 Google Search Console** site-verification meta tag (does **not** change
  `noindex` — indexing is still gated on legal sign-off).
- **#19 Project README** — full README replacing the placeholder.

**What remains to go live is still entirely owner-gated** — see the
`docs/stage-7-launch-cutover.md` §7 go-live checklist. The short list:
`VITE_ALLOW_INDEXING=true` (flip off `noindex`, gated on legal-copy sign-off),
HSTS preload (do LAST), disable the prod Vercel Toolbar → `CSP_ENFORCE_STRICT=true`,
Supabase leaked-password protection, secret rotation, one real end-to-end courier
shipment (SteadFast has **no sandbox** — first booking is billable), Pathao
webhook secret + registration, real product photography, and the legal-copy
review. No code work is blocking.\_

\_Last updated: 2026-07-17 — **DOMAIN CUT-OVER DONE + courier integration
rebuilt against the real provider contracts** (PR #12, `b4d1d44`, CI green;
**670 Vitest**). Two things landed.

**(1) `nongorr.com` now serves this app.** Apex = Production, `www` = 308 → apex,
canonical/`og:url` verified live as `https://nongorr.com/`. Deliberately still
**`noindex`** — that flip is gated on the legal-copy sign-off and is the one step
Google notices. **No DNS change was needed**: the records already pointed at
Vercel, so the cut-over was purely moving the domain between Vercel _projects_
(the old static site held it on a **different Vercel account** — Vercel claims
domains at account _and_ project level, which is what "linked to another Vercel
account" means). Back-out is a Vercel-side click, not a propagation wait, right
up until HSTS preload. Runbook + evidence: `docs/stage-7-launch-cutover.md` §2.

**(2) The courier layer had never worked, and now provably does.** Stage 5 shipped
it against _guessed_ provider contracts: SteadFast booked to a host that does not
exist (`portal.steadfast.com.bd` — NXDOMAIN; the API is `portal.packzy.com`), and
both webhooks checked an `X-Webhook-Secret` header **neither provider sends**
(SteadFast uses `Authorization: Bearer`, Pathao `X-PATHAO-Signature`). Pathao's
webhook could not even be registered — it probes the URL and demands HTTP 202 plus
an integration-secret echo. Pathao's status travels in `event` as one of 24
dotted-kebab slugs (`order.delivered`), not `order_status`; several are
unguessable (`order.paid` = "Payment Invoice"). Its token API only supports the
`password` grant. Eleven bugs total, each verified against the published docs
**and** live probes — full table in `docs/stage-7-launch-cutover.md` §8.1.
**Verified live:** Pathao sandbox books end-to-end through the real adapter
(consignment `DT170726Q3VV3U`) and polls `pending`→`booked`; Pathao production
`issue-token`/`stores`/`price-plan` all 200; SteadFast `/get_balance` 200.

**The lesson worth keeping:** the Stage 5 tests passed the whole time — they
asserted our _invented_ vocabulary, so a green suite actively concealed a dead
integration. Tests over an external contract must cite that contract's published
source; the suite now does, and asserts the old guesses map to `null`. Two of the
eleven bugs (a `SyntaxError` thrown on SteadFast's plain-text `401`, and one
`PATHAO_STORE_ID` serving two environments) were findable **only** by driving the
real API — no amount of doc-reading surfaces them.

**Still owner-gated:** webhook secrets (both endpoints 503 until set — generate
with `openssl rand -base64 32` and paste the _output_, not the command),
`VITE_ALLOW_INDEXING=true`, HSTS preload, legal-copy sign-off. ⚠ SteadFast has
**no sandbox** — its first booking is a real, billable consignment.\_

\_Earlier (2026-07-16) — **Codex (GPT-5) order-workflow remediation —
MERGED & DEPLOYED** (`main` @ `b17e589`; CI all-green incl. the migrations-local
Docker replay). Site is in the **editing / pre-launch** phase (no real
customers); the owner explicitly authorized applying the order-RPC migration to
prod and pushing to `main`. Full change list + verification in
`docs/Nongorr_Remediation_Report_2026-07-13.md` (rev 2). Shipped (typecheck +
lint + format clean + **636 Vitest** green + build ✓): the ten Codex findings.
**#1 guest idempotent replay redesigned around a client-held capability token**
— the browser mints the raw token and sends only its SHA-256 hash; the server
stores the hash and the replay returns the **original order unchanged (no
rotation)**, scope/actor-bound. Migration `20260713120000_guest_token_client_held.sql`
(9-arg `api.place_order`, trailing `p_guest_token_hash`) **applied to prod** and
verified in a rolled-back `DO` block (no row persisted); prod migration-history
version reconciled `074047`→`120000` so it orders after
`20260713090000_order_replay_receipt`, and prod carries only the 9-arg overload.
**#2** idempotency key + guest token persisted per placement signature and reused
across ambiguous retries (no duplicate orders). **#3** staging guard fails
closed + `staging-link` drops `shell:true` / pins `supabase@2.33.9` + runbook
corrections. **#4** `quoteSeq` newest-wins on cart + checkout, submit gated on a
verified price. **#5** checkout `cartHydrated` skeleton gate. **#6** typed
`OrderReadReason` threaded server→UI with distinct unauthenticated / not-found /
rate-limited / network / unavailable states + accessible retry (never reveals a
non-owned order). **#7** success page falls back to owner-scoped `get_my_order`
after a claim invalidates the guest token. **#8** order list/detail correctness

- **enrichment** (migration `20260716120000`, applied to prod): `list_my_orders`
  `item_names` → all-item search; `get_my_order`/`track_order` per-item
  `product_slug`/`sku` (product link + SKU) and a `courier` object (provider /
  consignment / tracking code / status / booked-at) → courier card; the detail +
  track pages now render the **real** `order_status_history` timeline. **#9**
  District/Area `SelectTrigger` real aria + payment `role=radiogroup` roving
  tabindex/arrow keys. **#10** DOM-free `zoom-math` + two-finger pinch/pan wiring,
  covered by `ProductImageViewer.test.tsx` (dispatched-pointer). **Browser retest
  done** (CDP emulation at 390×844 / 768×1024 / 1440×900): #6 error states, #7
  invalid-success fail-safe, #10 zoom (button/keyboard/tap-cycle/focus-return), #9
  checkout aria + error-summary focus

* radiogroup arrows, and #5 hydration all verified live; no console errors. The
  WhatsApp FAB is now **suppressed on `/checkout`** (`isCheckoutRoute` gate in
  `_site.tsx`) so it can't clip the full-width Place Order button — support stays
  inline; re-verified FAB absent on checkout, present on the PDP. **636 Vitest**
  green. Still deferred: an authenticated in-browser walk of the enriched order
  detail (RPC DB-verified; render typed/additive) and a real-order staging E2E
  (`docs/staging-supabase-runbook.md`). Prior context:\_

\_Earlier (2026-07-12) — **Stage 6 content & operational modules: CLOSED
for the content scope (P3/P4/P5/P6 + P7 closure; P1/P2 owner-deferred).**
Master plan `docs/stage-6-content-ops-plan.md` (`0882f0c`). Every
formerly-hidden admin screen (Banners / Reports / Size Settings) is now real,
plus a real policies editor. **P3 banners** (`96eac40`, migration
`20260711162017`): RPC-only `banners` table (schedule window, sort,
media-library-only image; the `delete_media` in-use guard now also covers
banner images), anon `api.get_active_banners` behind a 60s `cachedPublic`,
staff CRUD under `content.manage` with `banner.*` audit (new "content" audit
category), admin screen rebuilt with a media picker, and `HeroSection` renders
the lowest-sorted live banner with the built-in hero as fallback. **P4
policies CMS** (`3425d5b`, migration `20260711165114`): `site_pages` (4 fixed
slugs: delivery/payment/cookie/authenticity; draft jsonb) +
`site_page_revisions` (pruned to 20), seeded byte-identical from the static
copy; a dependency-free React markdown renderer (`Markdown.tsx`, XSS-inert) +
`CmsPolicyPage` shell render the DB page with the static JSX as fallback; the
admin editor is real (Edit/Preview/History, draft→publish→revision→restore —
restore goes to draft, never straight to live); the four designed pages
(return/terms/privacy/custom-size) stay in code and the admin labels them
honestly. **P6 reports + CSV** (`bd84563`, migration `20260711211537`): five
read-only aggregate RPCs (sales summary with documented confirmed/delivered
revenue definitions, top products, coupon ledger, courier performance incl.
avg-hours-to-deliver derived from `order_status_history`, COD reconciliation
— service-role only, active-staff checks, `[from, to)` ranges);
`admin.reports.tsx` rebuilt (URL-backed date range + presets, recharts,
per-section CSV + a deliberately PII-free orders CSV) over a shared `toCsv`
(UTF-8 BOM for Excel/Bangla/৳, RFC-4180 quoting, formula-injection guard, 50k
cap). **P5 size charts** (`657802a`, migration `20260711215507`; owner chose
structured charts over images): `size_charts` (ordered `columns` + aligned
`rows` jsonb kept coherent by deep RPC validation; unit, helper column, "Most
Selected" flags), seeded byte-identical with the three hardcoded charts; the
size-guide fixed tab AND its starting-point helper now read the DB with the
static arrays as fallback; `admin.size-settings.tsx` is a real grid editor
(`sizes.manage`, audited `size_chart.*`). Every pass followed the Stage-5
convention (prod-proven migration via rolled-back proof, ledger==repo,
advisors check, per-job CI verify) **plus a real-browser Playwright visual
test per pass** — which caught real bugs before each ship (a Radix
TabsTrigger-onClick dead spot fixed with controlled Tabs, a leftover
`useRouter` SSR crash, table/spacing polish). **67 prod migrations; 576
Vitest; `stage6_db.test.sql` (§banners/§pages/§reports/§sizes) wired into CI;
advisors clean (only the intentional RPC-only INFO items). P1
(notification-outbox sender) + P2 (newsletter consent) are DEFERRED BY THE
OWNER (2026-07-12) until they connect their own domain — the email provider
needs their DNS (SPF/DKIM) — so `notification_events` rows keep accumulating
with nothing consuming them yet; P1/P2 resume as a Stage-6 addendum when the
domain lands.** Prior context:\_

\_Earlier (2026-07-11) — **Stage 5 courier: IMPLEMENTED + REMEDIATED
(CI-green).** Stage 5 landed as `17dab60` (2026-07-07): SteadFast (API-key) +
Pathao (OAuth2) + Manual adapters behind a `CourierAdapter` interface; 3-phase
booking orchestration (pending row committed → external API call with NO open
transaction → success/failure committed); `courier_providers` / `shipments` /
`shipment_events` / `webhook_events` / `notification_events` (outbox) tables —
all RPC-only deny-all; order statuses **15→17** (`courier_booked`,
`delivery_failed`); secret-gated webhook endpoints; admin courier screen
rewritten DB-backed; legacy `orders.ts` / `admin-ops.ts` mocks deleted.
**A senior code review then independently verified 17 external-audit findings
against the code (12 true / 2 partial / 1 resolved / 1 N/A / 1 false) and a
five-part remediation pass fixed everything launch-blocking (2026-07-10/11):**
**(1)** the admin Audit Logs page was a hardcoded mock while real `audit_logs`
accumulated unseen — now a real owner-only viewer (`api.list_audit_logs`,
migration `20260710190825`; filters/search/pagination; SQL-side actor→email/
name/role resolution; `audit-shared.ts` is the single-source action taxonomy
with compile-time label parity). **(2)** courier lifecycle was broken THREE
ways — `update_shipment_status` guarded its order transition with
`IF v_order IS NOT NULL` on a RECORD (only true when every column is non-null,
never for a real order) so **no webhook had ever transitioned any order**;
SteadFast emits no pickup signal and `courier_booked→delivered` wasn't allowed;
and the manual poll button sent raw statuses the RPC ignores — all fixed
(migration `20260710193507`: `IF FOUND`, `courier_booked→{shipped,delivered,
delivery_failed,cancelled}`, `in_transit`/`out_for_delivery`→shipped; poll now
maps raw→internal like the webhook; "Mark delivered" admin action).
**(3)** booking/webhook integrity (migration `20260710195925`): a carrier
"success" with an empty consignment id is now a failure
(`empty_courier_reference`; adapters + RPC); webhook idempotency keys are
SHA-256 of the raw body (was `Date.now()` — every retry looked unique);
`webhook_events.processed`/`error` are actually maintained
(`set_webhook_event_processed`); the 64 KB body cap is enforced on the read
body, not the spoofable `content-length`. **Plus a runtime P0 found by driving
the live webhook flow:** `courier.server.ts` called RPCs without
`.schema("api")`, so every courier RPC hit a non-existent `public.*` function —
ALL courier operations had been failing at runtime since Stage 5 shipped
(`9c8bd32`). **(4)** courier server fns now gate on `courier.view`/
`courier.manage` (was `orders.*`), matching the nav. **(5)** the storefront
contact form now really submits — `contact_messages` (RPC-only) + rate-limited
`submit_contact_message` + a staff **Messages** inbox (search/filter/triage,
`contact.status_changed` audit, reply-on-WhatsApp; new `messages.view`/
`messages.manage` permissions; migration `20260710204703`) — and the three
mock admin screens (Banners / Reports / Size Settings) are hidden from the nav
behind honest "Coming soon" placeholders (route guards intact). A latent
client-bundle bug was also fixed: `staff.api.ts`/`mfa.api.ts` held module-level
server imports (500'd `/admin/staff` in dev) — server ops moved to
`staff-ops.server.ts`/`mfa-ops.server.ts`. A **P3 polish batch** (`462c42b`,
migration `20260711083958`) then closed every deferred item: booking
`request_hash` enforced (`booking_in_progress` for a duplicate submit vs
`double_booking` for a second intent), constant-time webhook-secret compare
(`timingSafeStringEqual`), the footer newsletter made real
(`newsletter_subscribers` + rate-limited idempotent `subscribe_newsletter`),
courier mutations moved to the `courierWrite` bucket, and the dead `PRODUCTS`
seed deleted (`products.ts` is now the pure isomorphic model). **63 prod
migrations; 543 Vitest; `stage5_db.test.sql` (§audit, §courier lifecycle incl.
the courier_booked→delivered regression, §webhook, §contact, §polish) wired
into CI; every DB change prod-proven via rolled-back proofs; advisors clean
(only intentional INFO items). Every review finding is resolved — the single
carry-over is the notification-outbox sender, now planned as Stage 6 P1 in
`docs/stage-6-content-ops-plan.md` (master plan, 2026-07-11).** Prior
context:\_

\_Earlier (2026-07-03) — **Stage 4 customer accounts: COMPLETE → STAGE 4
CLOSED (P1–P9, CI-green).** Accounts are fully server-authoritative end to end.
**P1/P2** (migrations `20260702080032`, `20260702081309`): `customer_profiles` /
`saved_addresses` / `saved_measurements` (RPC-only deny-all; caps 10/12;
one-default partial unique index) + the 8 account RPCs (CASE-presence patching,
exactly-one-default with oldest-promotion, per-user advisory write lock,
one-shot `import_account_data` with `account.imported` audit). **P3/P4**: shared
DTO/zod layer + service-role repo + guarded server fns (`accountRead`/
`accountWrite` buckets); `/account/*` rewired onto the server with optimistic
mutations + rollback and a one-time localStorage import → purge (sealed per
user). **P5**: checkout saved-address picker + post-order save-back; PDP
saved-measurement prefill + inline save-back. **P6** (`20260702175557`):
`wishlist_items` server sync — guests stay local, signed-in users get per-user
mirror + one-shot merge + optimistic `toggle_wishlist` (stale-response guard);
new `wishlistWrite` rate bucket. **P7** (`20260702181916`):
`api.claim_guest_order` — a signed-in viewer holding the guest capability token
(the ONLY proof; never phone/email matching) attaches the order to their
account in one row-locked update that preserves the owner XOR, kills the
tracking link, audits `order.claimed`, and is idempotent for same-user retries
(cross-account → `order_not_claimable`, non-oracular otherwise);
`ClaimOrderCard` on order-success + `/track` with a sign-in round-trip. **P8**
(`20260703062945`): DB-backed `admin.customers.tsx` on `admin_list_customers`
(auth.users minus staff, LEFT JOIN profile + live order aggregates, derived
VIP/Repeat/High-Risk/Custom-Size tags computed in-app, search + pagination,
sheet linking to the orders board) — mock `CUSTOMERS` retired. **P9** closure:
`stage4_db.test.sql` §1–§18 in CI; new `e2e/account.spec.ts` (sign-in, profile
edit, address + measurement CRUD, checkout prefill — validated 6/6 green
against a live dev server); visual pass on `/account/*` desktop + mobile
(one polish fix: overview quick-action label); advisors clean (security +
performance: only pre-existing INFO items). 5 new prod migrations (56 total);
478 Vitest tests; build/CI green per-job. Prior context:\_

_Earlier (2026-07-01) — **Stage 3 Pass-5 real coupons: COMPLETE → STAGE 3
CLOSED (P1–P5, CI-green).** Replaced the display-only mock coupons with a
server-authoritative, race-safe coupon system end to end. **P5a** (migration
`20260701150858`): `coupons` + `coupon_usages` (RPC-only deny-all) — premium
schema with `percent`/`fixed`/`free_shipping` types, min-spend, max-discount,
global + per-user usage caps (per-user may exceed 1), first-order-only, validity
window, and a maintained `usage_count`. **P5b** (`20260701152057`):
`api.quote_order`/`place_order` are coupon-aware via shared
`private.coupon_reason`/`coupon_amount` helpers (quote and place never diverge);
the discount is validated + consumed under a `SELECT … FOR UPDATE` on the coupon
row (global + per-user limits race-safe), free delivery keeps the pinned
pre-discount-subtotal shipping rule, and the balanced-total CHECK re-asserts
`subtotal − discount + shipping = total`; stable codes `invalid_coupon`,
`coupon_min_not_met`, `coupon_exhausted`, `coupon_not_eligible`. **P5c**: retired
`MOCK_COUPONS`/`findCoupon`/`couponDiscount` + the store's client discount — the
store keeps only the applied code, and the cart/checkout render the server
discount + `coupon.applied/reason` (a stale/expired code silently drops at place
instead of blocking checkout). **P5d** (`20260701155119`): admin coupon CRUD
(`api.list_coupons`/`upsert_coupon`/`set_coupon_active`/`delete_coupon` behind
`guardAdminWrite("coupons.manage")`, canonical `coupon.*` audit, used-coupon
delete guard) + a DB-backed `admin.coupons.tsx`. **P5e**: `pass3_db.test.sql`
§P5/§P5-admin coverage (discount math for all three types, min/limit/first-order
enforcement, usage-counter increment, admin CRUD + guards, grant posture) — this
also fixed the grant-check signatures the P5b function-signature change had left
stale (a from-empty CI regression). 3 new prod migrations (51 total); 388 Vitest
tests and 3 DB integration suites; advisors clean; build clean._

_Sub-pass detail: **P4a** (`f76f009`): isomorphic 15-status model
(`orders-shared.ts`) + server layer (`orders.server.ts` / `orders.api.ts`).
**P4b** (`475ce76`): DB-backed admin orders board. **P4c** (`c34bb57`): order
detail sheet + lifecycle action buttons (`getOrderDetailFn` + `nextActions` →
matching server fn, `expected_version` concurrency guard, return-with-restock
toggle). **P4e** (`15e6d91`): payment evidence — private `payment-evidence`
Storage bucket (prod migration `20260630195555`), customer evidence form
(`submitPaymentEvidenceFn`, CSRF + rate-limit + owner/guest scope), admin
signed-URL viewer. **P4f** (`8cff022`, `0c9cac1`, `1215fb8`): customer read
layer (`listMyOrdersFn` / `getMyOrderFn` / `trackOrderFn` + `customerProgress`
6-step timeline), DB-backed customer order list + detail, DB-backed guest
tracking shifted from phone-lookup to capability model (order number + 32-byte
guest token, `/track?o=&t=`), "save your tracking link" box on order-success
for guests. **P4g** (`ad7a628`): custom-order measurements server capture —
migration `20260701094647` (`order_items.custom_measurements jsonb`), threaded
through `place_order` / all read RPCs, `<MeasurementsList>` component (admin +
customer + guest track); excluded from `quote_token` canon (no drift). **P4d**
(`f0f6b84`, `3d36c67`): DB-backed payment review queue + `admin_order_stats`
RPC (migrations `20260701100539`, `20260701102954`) + duplicate-TrxID warning
surfaced to admin reviewer._

_**Mock retirement** (`657a6b6`–`16e122e`): account overview, order-success,
dashboard stats all off mock `ORDERS` seed onto real RPCs; `order-ui.ts` deleted
(helpers relocated to `bd-phone.ts` + `measurements.ts`). Legacy
`orders.ts`/`PRODUCTS` survive only for `admin.courier.tsx` + `admin-ops.ts` —
courier booking is Stage 5, so their final deletion is Stage-5-gated (corrects
the earlier "gated on Stage 3" note in the 2026-06-27 entry below)._

_**P4h** (`aead7ca`): `pass4_db.test.sql` — bkash happy path (submit → verify →
confirm → processing → … → return + restock), custom-measurement round-trip,
reject → retry → verify, COD confirm, duplicate-TrxID flag, guest track scoping,
transition guards, `admin_order_stats`, grant posture. **Bug fix** (`e3c6753`):
`consume_reservations` + restock branch called a non-existent `set_inventory`
signature + read `product_variants` (doesn't exist) — fixed (migration
`20260701110357`) to use the real parameter names, read `product_size_stock`,
and skip made-to-order 'Custom' lines on restock. Latent since the original
lifecycle migration; surfaced by the P4h lifecycle test. Prior context:_

_2026-06-30 (later) — **Deep-review remediation (43 migrations).**
Independently verified an external file-by-file review and fixed the genuinely-real
findings (several auditor claims were wrong/stale/already-fixed — verified, not
trusted). DB (3 new migrations, prod-applied + ledger-realigned):
**custom-size server pricing** — a `size='Custom'` line was priced at base only
AND ran through ready-size availability (0 for 'Custom'), so EVERY custom order
failed `out_of_stock`; now priced base+`custom_size_charge` and treated
made-to-order (not stock-gated, no ready reservation, valid only for
`custom_size` products); **`order_hold_hours`** is now honoured by `place_order`
(was hardcoded 24h); **payment-rejected reservation lifecycle** —
`transition_order` refreshes the hold window on reject (retry-safe; the auditor's
"release on reject" would have broken resubmit→confirm stock decrement) and
`expire_reservations` now reclaims abandoned rejected orders; **bKash/Nagad
receive numbers** are now projected by `get_public_settings` (customer-facing, not
secrets) so checkout shows them. App/types: audit-action union aligned with
SQL-written actions; mock coupons gated out of prod; eslint `no-unused-vars` at
warn; assorted JSDoc/.env.example. All prod-applied + validated (rolled-back) +
pass3_db.test.sql coverage added. Prior context:_

_2026-06-30 — **Repo↔DB parity restored + CI green.** A multi-PC
audit found the repo was carrying only **34** migration files while the live
project had **40**: six Stage-3 **Pass-4 order-lifecycle/read RPC** migrations
(`order_lifecycle_rpcs`, `order_transition_rpc`, `order_convenience_rpcs`,
`submit_payment_evidence_rpc`, `order_read_rpcs_admin`, `order_read_rpcs_customer`,
versions `…210911`–`…211152`) had been applied directly to prod but their `.sql`
files were never committed — so the repo was silently non-authoritative and the
Supabase Preview branching check failed ("remote migration versions not found in
local migrations directory"). The exact applied SQL was recovered verbatim from
`supabase_migrations.schema_migrations.statements` and committed (`df207c9`); the
repo now holds all **40** migrations and the branching replay passes
(`FUNCTIONS_DEPLOYED`). Separately, a Prettier-on-docs regression that had turned
the Quality CI job red was fixed (`cf6df7c`). **NOTE for the Pass-4 layer:** the
order-lifecycle/admin/customer-read RPCs now exist in the DB **and** the repo, but
their **app integration** (admin order-management UI, customer "my orders" /
order-tracking pages, payment-evidence submission UI) is **not yet built** — that
is the next app-layer work. Prior context:_

_Earlier (2026-06-28) — **Stage 3 checkout complete (backend + app
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
(complete)** is the app integration: the `payment_method_settings` migration
(`…085345`) added admin-configurable payment methods (`cod_enabled` +
`payment_methods_enabled[]`, public-projected), the admin
Settings "Payment methods" toggles, the isomorphic `checkout-shared` module
(cart→lines, error-code map, method derivation, idempotency key), `checkout.server.ts`
repository + `checkout.api.ts` server fns, checkout-route rewire (method selector,
quote-driven totals, placeOrderFn with CSRF + rate-limit + identity, idempotency
key minting + quoteToken drift guard), cart reconciliation (quoteOrderFn on mount,
per-item stock warnings, auto-correct quantities), order-success page refresh
(ServerOrderSuccess component with search-param routing), and removal of the F-04
demo gate. (Now superseded by the 2026-06-30 entry above — 40 migrations applied,
repo↔DB parity restored, all 4 CI checks green.) Prior context:_

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

| Stage        | Scope                                                                                                                                                                | Status                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | Auth, RBAC, CSRF, headers, rate limit, MFA scaffold, audit, owner-safety                                                                                             | Implemented                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.5          | Security closure (4 bugs + A–E + follow-up hardening)                                                                                                                | **Operationally closed** (migrations applied; `api` exposed; proofs run)                                                                                                                                                                                                                                                                                                                                          |
| 2 (Pass 1)   | DB-backed **public catalog read** path                                                                                                                               | Implemented + live                                                                                                                                                                                                                                                                                                                                                                                                |
| 2 (Pass 2)   | Admin **product / category / inventory** writes (DB-backed + hardened)                                                                                               | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3a)  | **Reviews moderation + rating/review_count sync** (DB-backed)                                                                                                        | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3b)  | **Authenticated customer review submission** (persisted + moderated)                                                                                                 | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3c)  | **DB-backed catalog facets & counts** (shop filter sidebar)                                                                                                          | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3d)  | **DB-backed site settings** (announcement bar live; audited admin form)                                                                                              | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3e)  | **Storage-backed media library** (real uploads via signed URLs)                                                                                                      | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3f)  | **Product gallery management** (attach library media; atomic replace)                                                                                                | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3g)  | **Admin dashboard cut off mock `PRODUCTS`** (live catalog widgets)                                                                                                   | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 2 (Pass 3g+) | Delete the `PRODUCTS` constant itself                                                                                                                                | **Gated on Stage 5** (only `admin.courier.tsx` + `admin-ops.ts` still consume it; courier booking is Stage 5)                                                                                                                                                                                                                                                                                                     |
| 3 (Pass 1)   | **Order schema, numbering & idempotency** (RPC-only tables, no behavior)                                                                                             | **Implemented + live**                                                                                                                                                                                                                                                                                                                                                                                            |
| 3 (Pass 1r)  | **Inventory reservations** (soft holds + lazy availability + cron sweep)                                                                                             | **Implemented + live**                                                                                                                                                                                                                                                                                                                                                                                            |
| 3 (Pass 3a)  | **Server-authoritative pricing/order RPCs** (`quote_order`/`place_order`)                                                                                            | **Implemented + live**                                                                                                                                                                                                                                                                                                                                                                                            |
| 3 (Pass 3b)  | **Checkout app integration** (payment settings + checkout-shared + server fns + checkout rewire + cart reconciliation + order-success)                               | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 3 (Pass 4)   | **Order-lifecycle / payment / read RPCs** (transition_order + verify/reject/confirm/cancel/return + submit_payment_evidence + admin & customer reads) — **DB layer** | **RPCs live + in repo (recovered `df207c9`)**                                                                                                                                                                                                                                                                                                                                                                     |
| 3 (Pass 4a)  | **Shared 15-status model + admin order server fns** (`orders-shared` + `orders.server` + `orders.api`, guarded; unit tests)                                          | **Implemented + CI-green** (no UI)                                                                                                                                                                                                                                                                                                                                                                                |
| 3 (Pass 4b)  | **DB-backed admin orders board** (`admin.orders.tsx` on `listOrdersFn`: lanes, server search, pagination, summary sheet) — replaces mock                             | **Implemented + CI-green**                                                                                                                                                                                                                                                                                                                                                                                        |
| 3 (Pass 4c)  | **Admin order detail sheet + lifecycle actions** (`getOrderDetailFn` + `nextActions` → guarded server fns, `expected_version`)                                       | **Implemented + CI-green**                                                                                                                                                                                                                                                                                                                                                                                        |
| 3 (Pass 4d)  | **DB-backed payments review queue** + admin duplicate-TrxID warning (`admin_order_stats`, `get_order_detail.trx_id_duplicate`)                                       | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 3 (Pass 4e)  | **Payment evidence** (private Storage bucket; customer submit; admin signed-URL view)                                                                                | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 3 (Pass 4f)  | **Customer order history + capability tracking** (`listMyOrdersFn`/`getMyOrderFn`/`trackOrderFn`); mock `ORDERS` retired from customer + account + dashboard         | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 3 (Pass 4g)  | **Custom-order measurements** captured server-side (`order_items.custom_measurements`; all read RPCs project it)                                                     | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 3 (Pass 4h)  | **Order-lifecycle DB test** (`pass4_db.test.sql`) + confirm/restock `set_inventory` bug fix; doc refresh                                                             | **Implemented + live + CI-green**                                                                                                                                                                                                                                                                                                                                                                                 |
| 5 (gated)    | Retire mock `orders.ts`/`PRODUCTS` (last consumers = courier + admin-ops)                                                                                            | **Done in Stage 5** (`orders.ts` + `admin-ops.ts` deleted)                                                                                                                                                                                                                                                                                                                                                        |
| 4            | Customer accounts / addresses / measurements / wishlist / guest claim                                                                                                | **CLOSED** (P1–P9, 2026-07-03; CI-green)                                                                                                                                                                                                                                                                                                                                                                          |
| 5            | Courier adapters (SteadFast/Pathao/Manual), shipments, webhooks, outbox                                                                                              | **Implemented + remediated** (`17dab60` + 5-part fix pass, 2026-07-11; CI-green)                                                                                                                                                                                                                                                                                                                                  |
| 5.5          | Review remediation: real audit viewer, courier lifecycle/integrity/RBAC fixes, contact inbox, honest mock-screen placeholders                                        | **Done** (see 2026-07-11 header entry)                                                                                                                                                                                                                                                                                                                                                                            |
| 6            | Banners, CMS, newsletter, reports, size settings, outbox sender                                                                                                      | **CLOSED (content scope)** — P3 banners + P4 policies + P5 size charts + P6 reports/CSV + P7 (2026-07-12); P1 sender + P2 newsletter consent **owner-deferred** (own domain/provider)                                                                                                                                                                                                                             |
| 7            | Hardening, perf/a11y, CI/CD, backups                                                                                                                                 | **In progress — P0 resolved (2026-07-12)** — master plan `docs/stage-7-hardening-launch-plan.md`. Decisions: Sentry / Free-tier backup (pg_dump) / domain-ready / all-four-blocking → **Stage-6 P1/P2 notification sender reactivated as pass P3.5**. Order: P1 security/CSP → P2 concurrency → P3 observability → P3.5 notifications → P4 perf/a11y → P5 CI/CD → P6 backup/DR → P7 domain cut-over → P8. P1 next |

## Migrations (live project xomjxtmhkglhuiccekld)

**67 migrations**, all applied; the remote `supabase_migrations.schema_migrations`
ledger matches the 67 repo files exactly (versions + names), in order. _(MCP-applied
migrations are stamped with the prod-server clock then the repo file is named to
match; the six `…627211*` Pass-4 RPCs were recovered earlier — see the header
notes. Parity is verified after every apply via `supabase migration list`.)_ In order:

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
                                          …627210911 order_lifecycle_rpcs
                                          …627210936 order_transition_rpc
                                          …627210959 order_convenience_rpcs
                                          …627211019 submit_payment_evidence_rpc
                                          …627211045 order_read_rpcs_admin
                                          …627211152 order_read_rpcs_customer
                                          …630120000 order_custom_pricing_and_hold_hours
                                          …630120100 reject_retry_window_and_expiry
                                          …630120200 public_payment_numbers
                                          …630195555 payment_evidence_bucket
                                          …701094647 order_custom_measurements
                                          …701100539 order_detail_duplicate_trx_id
                                          …701102954 admin_order_stats
                                          …701110357 fix_order_confirm_restock_inventory_calls
                                          …701150858 coupons_schema
                                          …701152057 coupon_pricing
                                          …701155119 coupon_admin_rpcs
                                          …702080032 stage4_account_schema
                                          …702081309 stage4_account_rpcs
                                          …702175557 stage4_wishlist
                                          …702181916 stage4_claim_guest_order
                                          …703062945 stage4_admin_customers
                                          …707150000 stage5_courier_schema
                                          …707162039 stage5_fix_transition_restock
                                          …710190825 audit_read_rpc
                                          …710193507 courier_lifecycle_fix
                                          …710195925 webhook_booking_integrity
                                          …710204703 contact_messages
                                          …711083958 stage5_polish
                                          …711162017 stage6_banners
                                          …711165114 stage6_pages
                                          …711211537 stage6_reports
                                          …711215507 stage6_size_charts
```

Note: `apply_migration` (MCP) stamps its own version, so after every MCP apply the
ledger version is realigned to the repo filename in a **standalone** statement
(never bundled with a proof DO-block, whose final `RAISE` would roll the realign
back). Always confirm with `supabase migration list`.

**Process lesson (2026-06-30 drift):** every migration applied to prod MUST be
committed as a `.sql` file in the **same** working session — otherwise the repo
drifts from the live DB invisibly until the Supabase Preview branching check fails.
On any PC, before pushing, confirm parity: compare `mcp.list_migrations` (or
`supabase migration list`) against `ls supabase/migrations` — counts and version
strings must match exactly.

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

## Stage 3 Pass 4 — order-lifecycle / payment / read RPCs (DB layer live; app integration pending)

These six migrations (`…210911`–`…211152`) were applied to prod on 2026-06-27 but
their `.sql` files were only committed to the repo on 2026-06-30 (`df207c9`, recovered
from the migration ledger — see header note). **The RPCs exist and are live; no app
wiring uses them yet.** All are `SECURITY DEFINER`, `service_role`-only (REVOKE from
anon/authenticated), so the app must call them through a server fn (the
`checkout.api.ts` pattern) that enforces CSRF + rate-limit + identity.

- **`order_lifecycle_rpcs`** — widens `payments.status` CHECK to
  `pending|submitted|verified|rejected`; adds `private.consume_reservations`
  (decrements stock via `api.set_inventory` on confirm, guards `insufficient_stock_at_confirm`)
  and `private.release_reservations` (releases active holds on cancel/expire).
- **`order_transition_rpc`** — `api.transition_order(order_id, to_status, actor,
reason, expected_version, restock)`: the state machine (allowed transitions per
  status), optimistic-concurrency `version_conflict`, consumes/releases reservations,
  optional restock on return, writes `order_status_history` + `audit_logs`.
- **`order_convenience_rpcs`** — thin wrappers over `transition_order`:
  `verify_payment` (marks payment verified → confirm), `reject_payment`,
  `confirm_cod`, `cancel_order`, `return_order`.
- **`submit_payment_evidence_rpc`** — `api.submit_payment_evidence(order_id, trx_id,
sender_number, scope, screenshot_path)`: owner/guest-scope check, status guard,
  records TrxID + sender + optional screenshot, flips order to `payment_submitted`,
  flags duplicate verified TrxID (`duplicate_trx_id_warning`).
- **`order_read_rpcs_admin`** — `api.list_orders` (staff-only; status/search filter,
  pagination, items + latest payment) and `api.get_order_detail` (full order + items
  - payment + screenshots + history).
- **`order_read_rpcs_customer`** — `api.list_my_orders` (by `user_id`),
  `api.get_my_order` (owner-scoped detail), `api.track_order(order_no, token_hash)`
  (guest tracking by order number + token hash).

## Stage 3 Pass 4a/4b — order-management app integration (done, CI-green)

Wiring the Pass-4 RPCs into the app (master plan
`docs/stage-3-pass4-admin-orders-plan.md`). No new migrations — these passes are
pure app layer over the live RPCs above.

- **P4a — shared model + admin server fns (`f76f009`).**
  - `src/lib/orders-shared.ts` — the single isomorphic source of truth for the
    15-status lifecycle: `ORDER_STATUS_META` (admin label, customer label, tone,
    lane), the four lanes, `ALLOWED_TRANSITIONS` (asserted in lockstep with
    `api.transition_order`'s CASE arms by a parity test), `nextActions(status)`,
    camelCase DTOs, the stable `orderErrorMessage` map, and zod validators.
  - `src/lib/server/orders.server.ts` — SERVER-ONLY service-role repo over
    `list_orders / get_order_detail / transition_order` + the convenience wrappers;
    `OrderError` carries a stable code; snake→camel mapping; raw SQL never reaches
    the client.
  - `src/lib/orders.api.ts` — `createServerFn` handlers: reads gate `orders.view`;
    writes go through `guardAdminWrite` (CSRF + strict permission + step-up + rate
    limit + denial audit). Payment verify/reject gate on `payments.verify`,
    lifecycle moves on `orders.manage`; the generic `transitionOrderFn` carries
    `expected_version` for optimistic concurrency (the convenience wrappers do not —
    the RPC signatures lack it).
  - Tests: status-set exhaustiveness, transition-table parity, `nextActions`
    invariants, error mapping, validator bounds, API/server wiring.
- **P4b — DB-backed admin orders board (`475ce76`).** `admin.orders.tsx` rewritten:
  URL-as-state via `validateSearch` + `loaderDeps` + `loader` on `listOrdersFn`
  (status / search / page are the source of truth → shareable, server-queried);
  status filter is a Select grouped by the four lanes; debounced server search by
  order-no / name / phone; offset/limit pagination with an accurate "showing X–Y of
  N"; status + payment tone badges; deterministic UTC dates (no hydration drift); a
  read-only summary sheet from the list row. The mock `ORDERS` board is gone. Full
  detail + lifecycle action buttons are P4c.

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

**Real / persistent — order management + fulfilment:** the full order lifecycle
(admin board / detail / lifecycle actions / payments review / payment evidence),
**coupons** (server-authoritative, race-safe, admin-managed), **customer order
history + guest capability tracking + guest-order claim**, **customer accounts**
(profiles / addresses / measurements / wishlist sync), **admin customers**,
**courier & shipments** (SteadFast/Pathao/Manual booking, shipment events,
idempotent webhooks with processed/error tracking, COD + reconciliation fields,
notification outbox rows), the **owner-only audit-log viewer**, the
**contact form + staff Messages inbox**, and the **footer newsletter opt-in**
(`newsletter_subscribers`, idempotent re-consent). The legacy mock `orders.ts` /
`admin-ops.ts` / `CUSTOMERS` / `ORDERS` / `MOCK_COUPONS` / `PRODUCTS` are all
deleted.

**Real / persistent — content & operations (Stage 6):** **homepage hero
banners** (`banners` + `api.get_active_banners`, scheduled, media-library-only
images, admin CRUD), the **policies CMS** (`site_pages` + revisions for the 4
Prose policy pages; markdown drafts → publish → restore; designed pages stay
in code, labeled honestly), **size charts** (`size_charts` powering the size
guide's fixed tab AND its starting-point helper, admin grid editor), and
**business reports + CSV export** (5 aggregate RPCs; PII-free orders CSV).
Every storefront consumer keeps a static fallback, so a DB outage degrades to
the original hardcoded content instead of a blank page.

**Still mock / localStorage / not built:** cart holds item IDs in
localStorage only (no server-side cart — signed-in wishlist IS server-synced);
the notification outbox has no sender yet (rows are written, nothing consumes
them — Stage 6 P1, **owner-deferred** until their own domain/provider is
connected); newsletter unsubscribe/consent management (Stage 6 P2, deferred
with P1).

**Privacy / fail-closed guardrails (F-03 / F-04):** customer account PII lives
server-side under deny-all RLS (Stage 4); the one-time localStorage import
purges legacy keys per verified user id. The F-04 demo checkout gate
(`isDemoCommerceEnabled()`) has been **removed** from the checkout submit path —
checkout calls the real `place_order` RPC.

## CI (honest)

`ci.yml` runs (genuinely): frozen Bun install, typecheck, lint, format, test, build,
**migrate-from-empty** (boots a local Supabase, applies all 67 migrations to a
blank DB — incl. the Stage 3 order schema/reservations/RPCs/payment-method
settings, the Pass-4 order-lifecycle/read RPCs, the Stage-4 account tables/RPCs,
the Stage-5 courier schema + audit/contact RPCs, and the Stage-6
banners/pages/reports/size-chart schema + RPCs), and **DB integration
tests** (`pass2_db.test.sql` + `pass3_db.test.sql` + `pass4_db.test.sql` +
`stage4_db.test.sql` + `stage5_db.test.sql` + `stage6_db.test.sql`
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
  RPC-only RLS; **Stage 3 Pass-4 order lifecycle** (`pass4_db.test.sql`) — bkash
  happy path submit→verify→confirm→…→delivered→returned+restock with reservation
  consume/restock, reject→retry, COD confirm, custom-measurement round-trip through
  all read RPCs, duplicate-TrxID flag, guest-track scoping, transition guards,
  `admin_order_stats`, and pass-4 RPC grant posture; **Stage 4 accounts**
  (`stage4_db.test.sql` §1–§18) — account schema invariants, the 8 account RPCs,
  wishlist sync/toggle, guest-order claim, admin customers; **Stage 5**
  (`stage5_db.test.sql`) — owner-only `list_audit_logs` (grants, actor
  resolution, filters, pagination), the courier lifecycle incl. the
  courier_booked→delivered SteadFast regression + returned_to_merchant no-op +
  failed→delivery_failed, webhook idempotency + processed/error marking +
  empty-reference booking guard, the contact submit/inbox/triage RPCs, and the
  §polish batch — request-hash duplicate detection (`booking_in_progress` vs
  `double_booking`) + newsletter normalize/re-consent/grants; **Stage 6**
  (`stage6_db.test.sql`) — §banners (grant posture, schedule-window filtering,
  media-library-only images, in-use delete guard, CRUD + audits), §pages (fixed
  slugs, seed integrity, draft→publish→revision lifecycle incl. the 20-revision
  prune, restore-to-draft), §reports (fixture orders → exact aggregate
  assertions for all five RPCs), and §sizes (seed integrity, deep jsonb
  validation rejections, CRUD + audits, inactive-hidden public read)).
  The migrate-from-empty job **exposes the `api` schema** in the local
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
4. DB integration tests are automated in CI (`pass2_db.test.sql` +
   `pass3_db.test.sql` + `pass4_db.test.sql` + `stage4_db.test.sql` +
   `stage5_db.test.sql`); a genuine two-connection concurrency test
   (`concurrency.test.sh`) also runs in the `migrations-local` job. True
   multi-session advisory-lock races are verified.
5. ~~Delete the mock `orders.ts` + `admin-ops.ts`~~ — **done in Stage 5**;
   ~~dead `PRODUCTS` export~~ — **done in the polish pass** (`products.ts` is
   now the pure isomorphic model: types + size constants + `requiresSelection`).
6. ~~Stage-5 review remediation deferred P3 items~~ — **done in the polish pass**
   (migration `20260711083958`): booking `request_hash` enforced
   (`booking_in_progress` for a duplicate submit vs `double_booking` for a
   second intent; the unique index stays the concurrency backstop);
   constant-time webhook-secret compare (`timingSafeStringEqual`); footer
   newsletter persists (`newsletter_subscribers` + rate-limited
   `subscribe_newsletter`, idempotent re-consent; unsubscribe UI is Stage 6);
   courier mutations use the `courierWrite` rate bucket. Still open: a
   notification-outbox sender (`notification_events` rows are written but
   nothing consumes them). Planned as **Stage 6 P1** (master plan
   `docs/stage-6-content-ops-plan.md`) and now **DEFERRED BY THE OWNER
   (2026-07-12)** together with P2 newsletter consent: the owner will set up
   the provider (SMS-first BD aggregator recommended — `customer_phone` is
   NOT NULL, `customer_email` nullable; Resend for email needs their own
   domain's DNS for SPF/DKIM) when they connect their own domain. The rest of
   Stage 6 (P3 banners, P4 policies CMS, P5 size charts, P6 reports + CSV,
   P7 closure) shipped 2026-07-11/12 — see the header entry.
7. GPT-audit remediation status: done — F-02, F-03, F-04, F-05, F-06, F-07, F-08,
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
8. Live security advisors (2026-07-12): intentional INFO `rls_enabled_no_policy`
   on every RPC-only table (now incl. the courier/webhook/notification/contact
   tables and the Stage-6 `banners`/`site_pages`/`site_page_revisions`/
   `size_charts`) + WARN `anon/authenticated_security_definer_function_executable`
   for the intentional public reads (`api.catalog_facets()`,
   `api.get_public_settings()`, `api.quote_order()`, and the Stage-6
   `api.get_active_banners()`/`get_site_page()`/`get_size_charts()`) —
   accepted posture + the deferred leaked-password toggle. No unexpected
   advisors from the Stage-5 / remediation / Stage-6 migrations.
