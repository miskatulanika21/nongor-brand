# WALKTHROUGH — actual data flows

Reflects what the code does today (Stage 2 closed; Stage 3 checkout complete —
backend + app integration live; Stage 3 Pass-4 order-management app integration
under way — admin orders board DB-backed). Updated each stage.

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

## Audit-log visibility (Bug 4) — applied

`admin_read_audit_logs` RLS allows SELECT only when
`private.current_staff_role() = 'owner'`, matching `audit.view` being owner-only
in `permissions.ts`. Admins can no longer read `audit_logs` directly.

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
  - `_site.order-success.tsx`: accepts `order_id`, `order_no`, `status`, `total`
    from search params; `ServerOrderSuccess` component for real orders; legacy
    localStorage path preserved for backward compat.
  - F-04 demo gate (`isDemoCommerceEnabled()`) removed from checkout gating.
  - Rate-limit buckets: `quoteOrder` (60/min), `placeOrder` (10/10min).

## Order management (Stage 3 Pass 4a/4b) — admin board live

The Pass-4 order RPCs are `SECURITY DEFINER`, `service_role`-only, so the app
reaches them only through guarded server fns — the same spine as the catalog
admin path.

- **Shared model (isomorphic):** `orders-shared.ts` is the single source of truth
  for the 15-status lifecycle — `ORDER_STATUS_META` (admin + customer labels, tone,
  one of four lanes), `ALLOWED_TRANSITIONS` (kept in lockstep with
  `api.transition_order`'s CASE arms by a parity test), and `nextActions(status)`
  (which admin action drives each transition). It carries no server imports.
- **Server fns (`orders.api.ts` → `server/orders.server.ts`):** reads
  (`listOrdersFn`, `getOrderDetailFn`) set no-store + gate `orders.view`; writes
  (`transition/verify/reject/confirmCod/cancel/returnOrderFn`) go through
  `guardAdminWrite` (CSRF + strict permission + MFA step-up + rate limit + denial
  audit) — payment verify/reject on `payments.verify`, lifecycle on `orders.manage`.
  The repo uses the service-role client to call the `api.*` RPC with the verified
  actor id as `p_actor`; `OrderError` maps each stable DB code to a safe message,
  and the generic `transitionOrderFn` forwards `expected_version` so two admins
  acting at once get a `version_conflict` instead of a silent clobber. The canonical
  `order.transition` audit is written inside the RPC's transaction.
- **Board (`admin.orders.tsx`):** the URL is the source of truth — `validateSearch`
  parses `status` / `q` / `page`, `loaderDeps` feeds them to the `loader`, and the
  loader calls `listOrdersFn` → `api.list_orders` (server-side status filter, ILIKE
  search over order-no/name/phone, offset/limit). The status filter is a Select
  grouped by lane; search is debounced into the URL; pagination shows an accurate
  "X–Y of N". A row opens a read-only summary sheet built from the list row. Order
  detail + the lifecycle action buttons (calling the write fns above) land in P4c.

## CI

`.github/workflows/ci.yml` runs on push to `main` and all PRs: Bun (pinned
1.3.14) frozen install → typecheck → lint → format:check → test → build (all
mandatory). A `migrations-local` job applies every migration to a fresh LOCAL
Supabase DB (Docker, no creds) — the authoritative migrate-from-empty check —
then runs the DB integration tests (`pass2_db.test.sql`, `pass3_db.test.sql`)
and the two-connection concurrency test (`concurrency.test.sh`). A separate job
runs `supabase db lint --linked` against the DEPLOYED DB using the
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_ID` + `SUPABASE_DB_PASSWORD`
repository secrets (now configured); it skips with a visible notice only if a
secret is missing. Note it lints the deployed DB and does not validate pending
migrations — that is the `migrations-local` job's role.

## Still mock / localStorage (later stages)

Cart and wishlist hold item IDs in `localStorage` only (no server-side cart).
Coupons (display-only until Stage 5); order **detail + lifecycle action buttons**
(P4c), **payment-evidence** submit/view (P4e), and **customer order history /
tracking** (P4f, still on the mock `ORDERS` seed); customer
profiles/addresses/measurements (Stage 4), courier adapters (Stage 5),
CMS/banners/newsletter (Stage 6), reports (Stage 6). (Reviews moderation, site
settings, checkout, and the admin orders board are DB-backed.) See
`CURRENT_STATUS.md`.
