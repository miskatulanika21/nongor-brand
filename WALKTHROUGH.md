# WALKTHROUGH — actual data flows

Reflects what the code does today (Stages 2–6 closed for their shipped scope;
checkout + order management, customer accounts, courier & shipments, and the
Stage-6 content/reports modules all live — 67 migrations). Updated each stage.

> **2026-07-16 Codex order-workflow remediation (merged & deployed, `b17e589`).**
> The guest tracking token is now **client-held**: the browser mints the raw
> token and sends only its SHA-256 hash (`sha256Hex`), the server stores the
> hash, and `place_order`'s idempotent-replay branch returns the **original order
> unchanged with no rotation** (migration `20260713120000_guest_token_client_held.sql`,
> 9-arg RPC with a trailing `p_guest_token_hash`; supersedes the earlier
> rotation-based `20260713090000_order_replay_receipt.sql`). Checkout persists the
> idempotency key + guest token per placement signature and reuses them across
> ambiguous retries. **order-success** never trusts URL params — it fetches a
> server-verified receipt via `track_order` (guest), falling back to
> `get_my_order` (signed-in owner) after a claim invalidates the guest token. The
> **cart store** hydrates independently of the wishlist partition and exposes
> `cartHydrated`; cart and checkout guard their quote fetch with a `quoteSeq`
> sequence and gate submit on a verified price. Order/track reads carry a typed
> `OrderReadReason`. See `docs/Nongorr_Remediation_Report_2026-07-13.md` (rev 2).

## Request → response security wrapper

`src/server.ts` `fetch()` → render via TanStack Start → `normalizeCatastrophicSsrResponse`
→ **`withSecurityHeaders(response, isProduction())`** which returns a NEW Response
with a cloned `Headers` (security headers added; CSP on HTML only; HSTS in prod).
Status/statusText/body (incl. streaming) and all `Set-Cookie` entries are
preserved. No try/catch swallow: a failure surfaces to the outer catch, which
returns a safe error page that is ALSO passed through `withSecurityHeaders`.

## Auth — privileged login

`performEmailLogin` (`auth.api.ts`): CSRF origin check →
**`checkIndependentRateLimit("login", { ip, account: email })`** (separate per-IP
and per-account buckets, both must pass; fail-open on limiter outage) →
`signInWithPassword` → resolve verified identity (`getUser`, strict) →
role-aware destination. Register / password-reset / password-update / MFA-verify /
staff-provision use the same independent-bucket helper. `getClientIp` documents
the trusted-proxy boundary (platform-authoritative source preferred; IP is a
rate-limit dimension only, never authz).

## Auth — staff invitation (Bug 2 path)

`provisionStaff` → `inviteUserByEmail(redirectTo=/auth/confirm?type=invite)` →
invitee clicks link → `auth.confirm.tsx` (allowlist now includes `invite`) →
`performEmailConfirm` `verifyOtp({ type: "invite" })` → routed to
`/auth/update-password` to set an initial password → role-aware redirect to admin.

## Staff mutations (Bugs 1 + 3, Item D + follow-up) — migration applied, `api` exposed

`provisionStaff` / `updateStaffRole` / `setStaffActive` (`staff.api.ts`):
CSRF → **baseline `requireRole("admin")` FIRST** (before the service-role client
is built or `staff_profiles` is queried — no existence oracle for unauthorized
callers) → target lookup → owner elevation via the already-resolved actor role →
**`requireStepUp(role)`** (AAL2, only when `ENFORCE_ADMIN_MFA=true`) →
**`admin.schema("api").rpc(...)`**. The `api.*` wrapper delegates to the
`private.*` function, which performs the staff_profiles mutation AND the canonical
`audit_logs` INSERT in the SAME transaction (no EXCEPTION handler → commit or roll
back together). A supplementary best-effort `writeAudit('staff.invited')` records
the auth.users side-effect only. `authz.denied` audits carry the verified actor id
(null only when unauthenticated).

## MFA enrollment (follow-up hardening)

`startMfaEnrollment` (`performStartMfaEnrollment`): CSRF → strict staff identity →
independent per-IP/per-account rate limit (`mfaEnroll`) → `listFactors`. If a
VERIFIED factor exists, an AAL2 session is required to add another (an aal1
session cannot attach a factor). Stale UNVERIFIED factors are `unenroll`-ed so
they cannot pile up. Initiation/denial/failure are audited with NO secret/QR in
metadata.

## Startup env validation (follow-up hardening)

`server.ts` fetch → `ensureEnvValidated()` (in `env.server.ts`): validates once,
recording success ONLY after `validateEnvAtStartup()` completes — a failed
validation does not latch, so later requests are not silently bypassed.

## Last-owner protection (Item C) — applied

Any UPDATE/DELETE on `staff_profiles` fires `private.guard_owner_safety()`, which
now takes `pg_advisory_xact_lock(...)` BEFORE counting other active owners, so
concurrent owner-removing transactions are serialized and the last owner cannot
be removed even under a race.

## Audit-log visibility (Bug 4) — applied; viewer live

`admin_read_audit_logs` RLS allows SELECT only when
`private.current_staff_role() = 'owner'`, matching `audit.view` being owner-only
in `permissions.ts`. Admins can no longer read `audit_logs` directly.

The trail is now also **visible**: `/admin/audit` is a real owner-only viewer —
URL-as-state loader → `listAuditLogsFn` (`requirePermission("audit.view")`) →
`audit-read.server.ts` → service-role `api.list_audit_logs` (re-checks
`role='owner'`, resolves actor id → email/display-name/role SQL-side, filters
by action/actor/date/search, clamped pagination). `audit-shared.ts` is the
single source of the action taxonomy: the writer (`audit.server.ts`) imports
its `AuditAction` type and the viewer renders from its
`Record<AuditAction, meta>`, so an action can never lack a label at compile
time. (It replaced a hardcoded mock list — found in the Stage-5 review.)

## Storefront catalog (Stage 2 Pass 1) — live

Route loaders call `catalog.api.ts` server fns → `catalog.server.ts` repository
(per-request ANON client, RLS-enforced, no mock fallback) → `catalog-map.ts`
maps rows to `Product`. Shop, index, PDP, search, cart, wishlist, sitemap read
from the `product_*` tables. Cart/wishlist hold ids only in `localStorage`.

## Admin catalog writes (Stage 2 Pass 2) — live

All admin catalog mutations share one guard: `guardAdminWrite(permission, op)`
(`admin-guard.server.ts`) → no-store headers → CSRF → `requirePermission(..,
{strict})` → MFA step-up (when `ENFORCE_ADMIN_MFA`) → per-IP/account rate limit
(`catalogWrite`) → audited denial. Reads (`products.view`) also set no-store.

- **Products** (`admin.products.tsx` → `catalog-admin.api.ts` →
  `catalog-admin.server.ts`): list/edit load all statuses via the service-role
  repository. Save routes through `api.save_product` (mutation + canonical
  `product.created/updated` audit in one txn); `code` is an independent immutable
  id (never the slug); the editor's stock is read-only (owned by Inventory);
  status comes from the selector. Removal is **Archive** (`api.set_product_status`)
  — permanent delete/bulk-delete are not in the UI.
- **Categories** (`admin.categories.tsx`): `api.save_category` /
  `set_category_active` / `delete_category` (all with canonical audit); reorder is
  one atomic statement via `api.reorder_categories`. Product counts come from the DB.
- **Inventory** (`admin.inventory.tsx`): stock is canonical. `products.stock` can
  change ONLY via `api.set_inventory` (a DB trigger blocks any other stock write),
  which locks the product row (`FOR UPDATE`), requires an active staff actor,
  enforces sized/non-sized, rejects zero-delta, and writes a movement + canonical
  `inventory.adjusted` audit in one txn. The movement ledger is append-only
  (UPDATE/DELETE blocked) and deleting a product with history is blocked (FK
  RESTRICT). Bulk uses `api.bulk_set_inventory` (bounded 1..100, idempotent op_key,
  structured partial-success). Variants are managed via `api.add_product_variant`
  / `remove_product_variant`. DB-level guarantees verified by reproducible
  rolled-back SQL proofs (see the Stage-2 hardening report).

## Checkout & orders (Stage 3) — complete

The checkout flow is fully server-authoritative: quote-driven pricing, real order
creation via RPCs, cart reconciliation, and server order display.

- **Pricing/quote (public):** `api.quote_order(lines, zone)` prices a cart
  from the DB via `private.price_lines` (the single source shared with placement),
  returning per-line availability/visibility + `subtotal/shipping/total` and a
  `quote_token` (md5 of the visible-line snapshot) used to detect drift at submit.
- **Placement (service-role only):** `api.place_order(lines, customer, zone,
method, idempotency_key, actor?, quote_token?)` runs one transaction: race-safe
  idempotency (INSERT … ON CONFLICT — a replay returns the original order, a
  hash-mismatch throws `idempotency_conflict`), deterministic product locking
  (sorted ids, deadlock-free), server-side re-pricing (client totals ignored),
  oversell guard via `private.available_qty` under the locks, price-drift check
  against `quote_token`, a 24h soft `inventory_reservations` hold, and the order +
  items + payment + append-only status-history writes. COD → `pending_confirmation`,
  manual (bkash/nagad) → `pending_payment`. Guests get a one-time `guest_token`
  (only its sha256 hash is stored). The RPC is REVOKE-d from anon/authenticated; the
  app server fn adds CSRF + rate limit + optional identity and calls it with the
  service-role client.
- **Reservation TTL:** `api.expire_reservations()` (pg_cron, every 5 min) expires
  stale pending orders; correctness does not depend on it — `available_qty` counts
  only unexpired holds (lazy backstop).
- **Payment methods config:** `site_settings.cod_enabled` +
  `payment_methods_enabled[]` are projected by `api.get_public_settings` and edited
  in the admin "Payment methods" section; `checkout-shared.ts` derives the offered
  methods (COD first) for the storefront.
- **App integration (Pass 3b, complete):**
  - `checkout.server.ts` repository + `checkout.api.ts` server fns (TanStack Start).
  - `_site.checkout.tsx` rewired: quote-driven totals on mount + zone/cart change,
    payment method selector (COD + bKash/Nagad from `publicSettings`),
    `placeOrderFn` with CSRF + rate-limit + identity + method validation,
    idempotency key minting + `quoteToken` drift guard.
  - `_site.cart.tsx` reconciliation: `quoteOrderFn` on mount to verify
    stock/availability, per-item warnings (not found, not visible, out of stock,
    low stock), auto-corrects quantity to available max.
  - `_site.order-success.tsx`: accepts `order_id`, `order_no`, `status`, `total`,
    `token` from search params; `ServerOrderSuccess` for real orders; guests see a
    "save your tracking link" box, signed-in orders link to `/orders/$id`. Legacy
    localStorage path removed (P4f).
  - F-04 demo gate (`isDemoCommerceEnabled()`) removed from checkout gating.
  - Rate-limit buckets: `quoteOrder` (60/min), `placeOrder` (10/10min).

## Order management (Stage 3 Pass 4) — complete

The full admin + customer order lifecycle is DB-backed. The 15-status state
machine is enforced server-side; all reads and writes flow through guarded
server fns backed by `SECURITY DEFINER` service-role RPCs.

- **Shared model (isomorphic):** `orders-shared.ts` is the single source of truth
  for the 15-status lifecycle — `ORDER_STATUS_META` (admin + customer labels, tone,
  one of four lanes), `ALLOWED_TRANSITIONS` (kept in lockstep with
  `api.transition_order`'s CASE arms by a parity test), `nextActions(status)`,
  `customerProgress` (6-step customer timeline), and `CUSTOMER_STEPS`. It carries
  no server imports.
- **Server fns (`orders.api.ts` → `server/orders.server.ts`):** admin reads
  (`listOrdersFn`, `getOrderDetailFn`) set no-store + gate `orders.view`; writes
  (`transition/verify/reject/confirmCod/cancel/returnOrderFn`) go through
  `guardAdminWrite` (CSRF + strict permission + MFA step-up + rate limit + denial
  audit) — payment verify/reject on `payments.verify`, lifecycle on `orders.manage`.
  Customer reads (`listMyOrdersFn`, `getMyOrderFn`, `trackOrderFn`) are
  auth-gated or capability-gated (guest tracking by order number + token).
  `OrderError` maps each stable DB code to a safe message; `transitionOrderFn`
  forwards `expected_version` so two admins get a `version_conflict` instead of a
  silent clobber.
- **Board (`admin.orders.tsx`):** URL-as-state loader on `listOrdersFn` (status /
  search / page), lane-grouped status filter, debounced server search,
  offset/limit pagination, status + payment tone badges, summary sheet.
- **Detail + lifecycle (`OrderDetailSheet`):** `getOrderDetailFn` loads items,
  payment (TrxID/sender/status), screenshots (signed-URL download), status history
  timeline, and the duplicate-TrxID flag. Action buttons driven by
  `nextActions(status)` → matching server fn, each with confirm dialog, reason
  input, `expected_version` guard, optimistic UI. Return offers the `restock` toggle.
- **Payment evidence:** private `payment-evidence` Storage bucket (RLS
  service-role-only write, no public read). Customer: evidence form (TrxID + sender
  - screenshot upload) on `pending_payment`/`payment_rejected` →
    `submitPaymentEvidenceFn` (CSRF + rate-limit + owner/guest scope). Admin:
    signed-URL download in the detail view.
- **Payment review (`admin.payments.tsx`):** filtered queue of `payment_submitted`
  orders; verify/reject with the duplicate-TrxID warning from `get_order_detail`;
  dashboard order stats (`admin_order_stats` RPC) DB-backed.
- **Customer orders (`_site.orders.tsx`, `_site.orders.$id.tsx`):**
  `listMyOrdersFn` / `getMyOrderFn` with `customerProgress` 6-step timeline,
  `CustomerStatusBadge`; guest → sign-in prompt.
- **Guest tracking (`_site.track.tsx`):** capability model — order number + guest
  tracking code (`/track?o=&t=`), two-field form, client-side fetch (child-route-
  safe pattern), `customerProgress` timeline, copy-link, non-oracular not-found.
- **Order success (`_site.order-success.tsx`):** threads the guest token; guests
  get a "save your tracking link" box; signed-in orders link to `/orders/$id`.
- **Custom measurements (`order_items.custom_measurements jsonb`):** captured at
  `place_order` from cart `customSize` (via `cartToPlaceLines` + `normalizeMeasures`),
  excluded from `quote_token` canon, rendered in `<MeasurementsList>` in admin
  detail, customer detail, and guest track.
- **Mock retirement:** `order-ui.ts` deleted (pure helpers relocated to
  `bd-phone.ts` + `measurements.ts`); account overview, order-success, dashboard
  stats all read real data. Legacy `orders.ts`/`PRODUCTS` survive only for
  `admin.courier.tsx` + `admin-ops.ts` (courier = Stage 5).
- **Bug fix (`e3c6753`):** `consume_reservations` + restock branch called a
  non-existent `set_inventory` signature — fixed (migration `20260701110357`) to
  use the real parameter names, read `product_size_stock`, and skip 'Custom' lines.

## Customer accounts (Stage 4) — live

- **Read path:** the `/account` layout loader calls `getMyAccountFn` (GET,
  no-store, `accountRead` bucket) → `api.get_my_account(p_user)` under the
  service role — SSR snapshot seeds `AccountUIProvider` (keyed per user, no
  content flash). Email stays in `auth.users` (read-only in the UI).
- **Write path:** every mutation is a POST server fn (CSRF origin + verified
  session + `accountWrite` 30/10min) → owner-scoped SECURITY DEFINER RPC under
  a per-user advisory lock. Caps (10 addresses / 12 measurements), exactly-one-
  default with oldest-promotion, and field CHECKs are enforced at the DB; the
  provider applies optimistic updates and rolls back on the stable error code.
- **One-time import:** first signed-in visit posts legacy localStorage PII to
  `import_account_data` (row-by-row salvage, single default, `account.imported`
  audit); local keys are purged only after the server confirms, then the flow
  is sealed per user (`already_imported` seals too).
- **Prefill:** checkout renders saved-address chips (one tap fills the form,
  post-order save-back offered); the PDP custom-size flow offers saved
  measurement profiles with inline save-back.
- **Wishlist:** guests stay in `localStorage`; signed-in users get a per-user
  mirror key for instant paint, a one-shot guest→server merge on login
  (`sync_wishlist` union, cap 100), and optimistic `toggle_wishlist` with a
  stale-response guard. Login/logout is SPA navigation — the store re-hydrates
  on the key flip, no remount.
- **Guest-order claim:** a signed-in viewer holding a guest tracking link
  (`/track?o=&t=` — the token is the ONLY proof) can claim the order via
  `claimGuestOrderFn` → `api.claim_guest_order`: row-locked single-statement
  owner flip (XOR preserved), guest token hash cleared (link dies), audited
  `order.claimed`, idempotent same-user retry; wrong/unknown tokens collapse
  to `order_not_found` (non-oracular) and cross-account claims raise
  `order_not_claimable`. `ClaimOrderCard` renders on order-success and /track;
  signed-out visitors get a sign-in round-trip back to the tracking URL.
- **Admin customers:** `/admin/customers` (behind `customers.view`) reads
  `admin_list_customers` — every non-staff account with live order aggregates
  and a profile→latest-order-snapshot identity fallback; VIP/Repeat/High-Risk/
  Custom-Size tags are derived in `customers-shared.ts`, never stored; the
  detail sheet links to the orders board by phone.
- **Tests:** `stage4_db.test.sql` §1–§18 runs in CI from-empty;
  `e2e/account.spec.ts` drives sign-in → profile edit → address/measurement
  CRUD → checkout prefill in a real browser (env-gated).

## Courier & shipments (Stage 5) — live

Booking: `admin.courier.tsx` lists `ready_to_ship` orders → `bookCourierFn`
(`guardAdminWrite("courier.manage")`) → `courier.server.ts#bookShipment`, a
**3-phase** flow so no DB transaction is ever open across network I/O:
(1) `api.create_shipment_attempt` commits a `pending` row (active-staff +
enabled-provider + bookable-status checks; a partial unique index blocks a
second active forward shipment per order); (2) the provider adapter calls the
external API — SteadFast (`Api-Key`/`Secret-Key` headers), Pathao (OAuth2
client-credentials with an in-memory token cache + one 401 retry), or Manual
(admin-supplied tracking code); (3) `api.mark_shipment_booking_success` (order
→ `courier_booked`, `shipment.booked` audit, `shipment_booked` outbox row) or
`api.fail_shipment_booking` (order untouched, retry allowed). An automated
provider returning "success" with no consignment id is treated as a FAILURE
(`empty_courier_reference`) — never an untrackable booked order. Stale pending
attempts (crash between phases) expire after 10 min and are resolved via
`resolveStaleAttemptFn`. COD amount comes from `computeCodAmount`
(prepaid/cod/partial_cod from payment method + verified status); bKash/Nagad
orders must be payment-verified before booking.

Status flow: webhooks (`/api/webhook/steadfast`, `/api/webhook/pathao`) are
POST-only, rate-limited per IP, disabled (503) until their
`*_WEBHOOK_SECRET` env is set, and always answer a generic 200.

**Auth differs per provider** (2026-07-17 — they are _not_ mirror images).
SteadFast authenticates with `Authorization: Bearer <token>`, the value entered
as "Auth Token(Bearer)" in its panel; Pathao sends `X-PATHAO-Signature`. Neither
sends `X-Webhook-Secret` — the header the original code checked, which rejected
100% of real events. Pathao additionally **probes the URL at registration** with
`{event:"webhook_integration"}` and only accepts it if we answer HTTP **202** and
echo `X-Pathao-Merchant-Webhook-Integration-Secret`; that handshake is checked
_before_ the signature, because the probe is unsigned. Pathao's status arrives in
the payload's `event` field as a dotted-kebab slug (`order.delivered`, 24 of
them), never `order_status`. SteadFast sends two `notification_type`s:
`delivery_status` (carrying `status`) and `tracking_update` (carrying only a
`tracking_message`) — the latter is appended via `api.record_shipment_event`,
which deliberately does **not** touch `courier_status`, since routing it through
`update_shipment_status` would overwrite a real "delivered" with a non-status.
Full contract + evidence: `docs/stage-7-launch-cutover.md` §8.1.

The raw body
is capped at 64 KB (on the actual read bytes), parsed, and recorded via
`api.record_webhook_event` with an idempotency key = SHA-256 of the raw body —
a byte-identical provider retry dedups, a distinct event processes. New events
map the provider vocabulary to internal statuses
(`courier-shared.ts#mapCourierStatusToInternal`) and call
`api.update_shipment_status`: every event is appended to `shipment_events`,
and significant ones transition the order — `picked_up`/`in_transit`/
`out_for_delivery` → `shipped`, `delivered` → `delivered` (allowed straight
from `courier_booked`, because SteadFast never sends a pickup signal),
`failed` → `delivery_failed`; `returned_to_merchant` records but leaves the
decision to the admin (return + restock). The handler then marks the event
`processed` or records its `error` (`api.set_webhook_event_processed`), so
failed webhooks are visible. The admin "poll status" button runs the SAME
raw→internal mapping before recording, and each transition writes a
`notification_events` outbox row (no sender consumes them yet).

Customer contact (delivered early from the Stage-6 scope): `/contact` submits
via `submitContactFn` (CSRF origin + per-IP `contactSubmit` rate limit; the
`api.submit_contact_message` RPC is service-role-only so REST can't be
spammed) into `contact_messages` (RPC-only deny-all). Staff read it at
`/admin/messages` (`messages.view`; search/filter/pagination) and triage
new/handled/archived (`messages.manage`, `contact.status_changed` audit,
reply-on-WhatsApp deep link). Banners / Reports / Size Settings were hidden
behind "Coming soon" placeholders here; Stage 6 built all three for real and
removed the `hidden` flags (below).

## Content & operations (Stage 6) — live

All four modules share the established posture: an RPC-only deny-all table,
`SECURITY DEFINER` RPCs (anon-granted for public reads that expose no staff
ids; service-role-only for staff ops with SQL-side active-staff re-checks),
guarded server fns (`requirePermission` reads / `guardAdminWrite` writes),
isomorphic zod mirrors, canonical audits, and a **static fallback for every
storefront consumer** (a DB outage renders the original hardcoded content).
Public reads sit behind the 60s `cachedPublic` process-memory cache.

- **Banners** (`banners`, `content.manage`): the homepage loader fetches
  `api.get_active_banners` (active + inside the optional `starts_at`/`ends_at`
  window, ordered by `sort_order`) in parallel with product cards;
  `HeroSection` renders the first live banner (eyebrow/title/subtitle/CTA/
  image/overlay card) or its built-in hero. Admin CRUD picks images from the
  media library only (`image_not_in_library` otherwise), and `delete_media`
  refuses to delete an image a banner still uses (`media_in_use`).
- **Policies CMS** (`site_pages` + `site_page_revisions`, `content.manage`):
  the four Prose policy routes (delivery/payment/cookie/authenticity) load
  `api.get_site_page(slug)` and render `body_md` through a dependency-free
  markdown renderer (`Markdown.tsx` — builds React elements, raw HTML stays
  inert, protocol-filtered links) inside `CmsPolicyPage`, falling back to the
  original static JSX. Admin edits a **draft** (jsonb), previews, then
  publishes — publish snapshots the previous live copy into revisions (pruned
  to 20); restore copies a revision back into the draft, never straight to
  live. The designed pages (return/custom-size/privacy/terms) stay in code and
  the admin screen labels them honestly (Preview only).
- **Size charts** (`size_charts`, `sizes.manage`): each chart is ordered
  `columns` + aligned `rows` jsonb (deep-validated in the RPC — ragged rows,
  bogus helper column, >12 cols/>30 rows all rejected with stable codes). The
  size-guide's fixed-chart tab AND its starting-point helper both read
  `api.get_size_charts` (the helper computes from the same numbers), with the
  original hardcoded arrays as fallback; per-chart unit drives the
  inches/centimetres copy; ★ marks the storefront "Most Selected" badge.
  Admin is a real grid editor (add/remove rows + columns kept aligned by
  construction).
- **Reports + CSV** (`reports.view`): `admin.reports.tsx` is URL-as-state
  (`?from&to` + presets) over `loadReports`, which `Promise.all`s five
  read-only aggregate RPCs (sales summary with documented confirmed/delivered
  definitions, top products, coupon ledger, courier performance incl.
  avg-hours-to-deliver from `order_status_history`, COD reconciliation; all
  half-open `[from, to)` ranges). Every section exports CSV via the shared
  `toCsv` (UTF-8 BOM for Excel/Bangla/৳, RFC-4180 quoting, formula-injection
  guard, 50k-row cap); the orders export is deliberately PII-free.

The notification-outbox **sender** and newsletter consent management remain
unbuilt — **deferred by the owner** until they connect their own domain and
pick a provider; `notification_events` rows keep accumulating unconsumed.

## CI

`.github/workflows/ci.yml` runs on push to `main` and all PRs: Bun (pinned
1.3.14) frozen install → typecheck → lint → format:check → test → build (all
mandatory). A `migrations-local` job applies every migration to a fresh LOCAL
Supabase DB (Docker, no creds) — the authoritative migrate-from-empty check —
then runs the DB integration tests (`pass2_db.test.sql`, `pass3_db.test.sql`,
`pass4_db.test.sql`, `stage4_db.test.sql`, `stage5_db.test.sql` — covering the
owner-only audit reader, the courier lifecycle incl. the
courier_booked→delivered regression, webhook idempotency/processed marking,
the empty-reference booking guard, and the contact RPCs — and
`stage6_db.test.sql` §banners/§pages/§reports/§sizes) and the
two-connection concurrency test (`concurrency.test.sh`). A separate job runs `supabase db lint --linked` against
the DEPLOYED DB using the `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_ID` +
`SUPABASE_DB_PASSWORD` repository secrets (now configured); it skips with a
visible notice only if a secret is missing. Note it lints the deployed DB and
does not validate pending migrations — that is the `migrations-local` job's role.

## Still mock / localStorage (later stages)

Cart holds item IDs in `localStorage` only (no server-side cart; the signed-in
wishlist is server-synced as of Stage 4). Notification-outbox sender (rows
written, nothing consumes them) + newsletter unsubscribe/consent management —
both **owner-deferred** until their own domain/provider is connected. (Reviews
moderation, site settings, checkout, the full order lifecycle, coupons,
customer accounts, courier & shipments, the audit viewer, the contact inbox,
the footer newsletter opt-in, banners, the policies CMS, size charts, and
reports are all DB-backed.) See `CURRENT_STATUS.md`.
