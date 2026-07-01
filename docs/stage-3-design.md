# Stage 3 — Checkout, Orders & Payments — Master Design (v2)

Status: **approved & complete** (2026-06-28; Pass-4 app integration completed
2026-07-01). All passes (P1 schema through P4h tests) are implemented + live +
CI-green. 48 prod migrations, 385 Vitest + 3 DB integration suites. Live
progress detail lives in `CURRENT_STATUS.md`; this remains the design source of
truth. Aligns with the Stage 3 line in `IMPLEMENTATION_PLAN.md` and the
established codebase posture (RPC-only tables, `guardAdminWrite`, canonical
audit, stable snake_case error codes, prod-proven migrations, CI-green per pass).

**v2 changelog:** hardened the _inside_ of every pass — deterministic lock
ordering, race-safe idempotency, transition concurrency, price-drift handling,
financial invariants, oversell-on-restock guard, duplicate-TrxID + guest-token
fraud controls, cart reconciliation, and a concrete `PaymentProvider` seam. The
four locked decisions and the phasing are unchanged.

## 0. Decisions locked (owner, 2026-06-27)

| Decision         | Choice                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| Payment methods  | **COD + Manual bKash + Manual Nagad** (no online gateway this stage)    |
| Stock holding    | **Reserve at order + TTL auto-expiry** (no oversell, no permanent lock) |
| Payment evidence | **TrxID + sender number + optional screenshot** (private Storage)       |
| Checkout access  | **Guest + logged-in** (secure guest tracking token; never phone-only)   |

The online gateway (SSLCommerz/bKash PGW) is deliberately deferred; the
`PaymentProvider` seam (§14) leaves room so it drops in later without rework.

## 1. Goals / non-goals

**Goals**

- Server-authoritative pricing — totals **recomputed from the DB**; a tampered
  client total can never be honored.
- Transactional, **idempotent** order creation: validate → reserve → order+items
  → payment → commit. One order per submission under retry.
- **No oversell, ever** — concurrent buyers of the last unit: exactly one wins,
  and a later stock reduction can never strand a confirmed order into oversell.
- Manual payment verification (bKash/Nagad) **and** a separate COD path.
- Stock reservations with a TTL so abandoned/unpaid orders auto-release.
- Real, **race-safe** coupons, replacing the display-only mock.
- Admin order lifecycle (verify/reject/confirm/cancel/return) with status history
  - audit, safe under concurrent admins.
- Private payment evidence (screenshots) reachable only via short-lived signed
  URLs, with **duplicate-TrxID** fraud detection.

**Non-goals (later stages)**

- Courier booking / shipment webhooks / notification outbox → **Stage 5** (the
  `order_status_history` event log in §14 is the seam they’ll consume).
- Online payment gateway + verified webhooks → later phase (seam ready).
- ~~Full customer order-history account UI → Stage 4~~ — **shipped in P4f**
  (customer order list + detail + guest tracking; Stage 4 retains customer
  profiles/addresses/measurements).
- Returns/RMA portal → Stage 3 ships **refund _status_ + optional restock**;
  money movement is manual + Stage 5+.

## 2. Order state machine

Two entry paths converge on one fulfilment tail. Transitions are enforced
server-side by an allowed-transitions table; every change locks the order
(`FOR UPDATE`), checks `version`, is **idempotent** (re-applying a transition is a
no-op), and writes `order_status_history`.

```
MANUAL (bkash | nagad):
  placed(pending_payment)
    → [customer submits TrxID/sender/(screenshot)] payment_submitted
    → [admin verify]  confirmed     (reservation CONSUMED → stock decremented via ledger)
    → [admin reject]  payment_rejected → (customer resubmits → payment_submitted | cancelled)

COD:
  placed(pending_confirmation)
    → [admin confirm (optional confirmation-call gate)] confirmed
       (reservation CONSUMED → stock decremented via ledger)

SHARED TAIL (Stage 3 owns up to delivered; courier mechanics are Stage 5):
  confirmed → processing → ready_to_ship → shipped → delivered → completed

CROSS-CUTTING:
  cancelled   (customer pre-confirm, or admin before shipped) → release reservation
  expired     (reservation TTL elapsed while still pending)   → release reservation
  returned → refund_pending → refund_done   (admin; status + OPTIONAL restock movement)
```

Canonical `status` enum + the transition map live in an isomorphic module
(`order-status.ts`) shared by server guards and the admin UI, so an invalid
transition is impossible from either side.

## 3. Data model

All new tables are **RLS deny-all (RPC-only)**, matching inventory/settings/media.
Writes flow through `SECURITY DEFINER` `api.*` RPCs (service-role); reads through
scoped read RPCs. Money is stored as integer **BDT** (no floats).

- **`orders`** — `id uuid`, `order_no text UNIQUE` (`NGR-2026-000123`),
  `user_id uuid NULL`, `guest_token_hash text NULL`, customer snapshot
  (`name`,`phone`,`email`), address snapshot (`district`,`zone`,`address`,`area`),
  pricing snapshot (`subtotal`,`discount`,`shipping_fee`,`total`),
  `payment_method` enum(`cod|bkash|nagad`), `status` enum, `coupon_code NULL`,
  `reservation_expires_at timestamptz`, `idempotency_key text`, `placed_at`,
  `confirmed_at NULL`, `version int NOT NULL DEFAULT 0`, timestamps.
  - **CHECKs:** exactly one of `user_id`/`guest_token_hash` set; pricing invariant
    `subtotal - discount + shipping_fee = total`; `discount >= 0`,
    `total >= 0`, `subtotal >= 0`.
- **`order_items`** — `order_id`, `product_id`, `variant_size NULL`, **snapshots**
  (`name`,`image`,`unit_price`), `qty CHECK 1..50`, `line_total`,
  **`custom_measurements jsonb NULL`** (P4g: made-to-measure body measurements
  captured at `place_order`, shape-CHECKed object, ≤8KB; excluded from
  `quote_token` canon — fulfilment data, not pricing data). Snapshots make
  historical orders immutable as the catalog changes. FK `ON DELETE RESTRICT`.
  `CHECK (line_total = unit_price * qty)`.
- **`order_status_history`** — append-only domain-event log: `order_id`,
  `from_status`, `to_status`, `actor_id NULL` (null = system/customer), `reason`,
  `created_at`. (UPDATE/DELETE blocked by trigger — same posture as the inventory
  ledger.) **This is the event source Stage 5’s outbox subscribes to.**
- **`payments`** — `order_id`, `method`, `amount`, `sender_number NULL`,
  `trx_id NULL`, `status` enum(`pending|verified|rejected`), `verified_by NULL`,
  `verified_at NULL`, `reject_reason NULL`, `created_at`. COD = one row, method
  `cod`, pending until delivered/collected.
  - **Fraud guard:** partial unique index on `lower(trx_id)` per `method` **where
    `status = 'verified'`** — the same wallet TrxID cannot be verified onto two
    orders. On submit, a non-blocking duplicate check flags it for the admin.
- **`payment_screenshots`** — `payment_id`, `storage_path`, `created_at`. Private
  bucket; never public.
- **`inventory_reservations`** — `order_id`, `product_id`, `variant_size NULL`,
  `qty`, `status` enum(`active|released|consumed`), `expires_at`, `created_at`.
  Reserved at the **same granularity as stock** (per product, or per size for
  sized products). **Available = `stock` − Σ(`active` AND `expires_at > now()`).**
- **`coupons`** — `code PK`, `type`(`percent|fixed`), `value`, `min_subtotal`,
  `max_discount NULL`, `usage_limit NULL`, `per_user_limit NULL`, `starts_at NULL`,
  `ends_at NULL`, `active bool`, timestamps. Replaces `MOCK_COUPONS`.
- **`coupon_usages`** — `coupon_code`, `order_id`, `scope` (user_id or
  guest_token_hash), `amount`, `created_at`. Partial unique `(coupon_code, scope)`
  enforces per-user limits race-safely; a global `usage_limit` is enforced under
  the coupon row lock (§4.4).
- **`idempotency_keys`** — `key PK`, `scope`, `request_hash`, `order_id NULL`,
  `created_at`. Insert-first with `ON CONFLICT` (§4.1) so it is the serialization
  point for duplicate submissions.
- **Order number** — a Postgres `SEQUENCE` formatted in-RPC to `NGR-YYYY-######`.
  Treated as **non-secret/enumerable** (the guest token, not the number, is the
  secret — see §7).

## 4. Server-authoritative checkout — `api.place_order`

`SECURITY DEFINER`, service-role only, **one transaction**. Inputs: cart lines
(product `code` + size + qty), customer + address, `payment_method`,
`coupon_code?`, `quote_token?`, `idempotency_key`, `actor` (`user_id` or null).

1. **Idempotency (race-safe).** `INSERT INTO idempotency_keys … ON CONFLICT (key)
DO NOTHING`. If the insert returns no row, another request owns the key: read
   its `order_id` (retry/poll until populated) and **return that order**. If the
   stored `request_hash` differs from this payload → `idempotency_conflict`.
2. **Deterministic locking (deadlock-free).** Collect the distinct product ids,
   **sort ascending**, then `SELECT … FOR UPDATE` in that order. Two orders that
   share products always lock in the same sequence, so they serialize instead of
   deadlocking.
3. **Validate lines** — each product publicly visible (active + active category),
   valid size, `qty` within bounds; `unit_price` taken **from the DB** (client
   price ignored).
4. **Oversell guard** — `available = stock − Σ active-unexpired reservations`
   (computed under the product lock from step 2); insufficient → per-line
   `out_of_stock` with the available count.
5. **Recompute pricing (canonical order of operations).**
   - `subtotal` = Σ DB `unit_price × qty`.
   - **Coupon** validated in-txn under the coupon row lock: active, within window,
     `subtotal ≥ min_subtotal`, `per_user_limit` (unique insert), `usage_limit`
     (count under lock); `discount = min(value-or-percent, max_discount)` with
     **integer round-half-up** for percent.
   - **Shipping** from `site_settings` by zone; **free-delivery threshold is
     evaluated on the _pre-discount_ subtotal** (pinned rule — avoids a coupon
     silently removing free shipping).
   - `total = subtotal − discount + shipping_fee` (the DB CHECK re-asserts this).
6. **Price-drift detection.** If a `quote_token` is supplied, compare its snapshot
   hash to the freshly computed `subtotal`/line prices; on mismatch →
   `price_changed` with the new total so the UI re-confirms (no silent surprise).
7. **Reserve** — sorted product order again; insert `inventory_reservations`
   (active, `expires_at = now() + settings.reservation_ttl`). COD reserves too.
8. **Create** — `order_no` from sequence; insert order + item snapshots +
   `order_status_history(placed)` + `payments(pending)` + `coupon_usages` (if any);
   set `idempotency_keys.order_id`.
9. **Guest token** — for guests generate a ≥128-bit random token, store its
   **SHA-256 hash**, return the plaintext **once**.
10. **Commit**; return `{ order_no, order_id, guest_token? }`. Audit `order.placed`.

Stable codes: `out_of_stock`, `price_changed`, `invalid_coupon`,
`coupon_exhausted`, `coupon_min_not_met`, `invalid_payment_method`,
`invalid_address`, `empty_cart`, `idempotency_conflict`, `product_not_purchasable`.

**`api.quote_order`** (read-only, identical pricing) returns the line breakdown,
total, **and a signed `quote_token`** (snapshot hash + issued-at) for §4.6. It is
the source of the honest pre-submit total and powers **cart reconciliation**: it
echoes per-line `{available, current_price, changed}` so the UI can show "3 items
changed" instead of a blunt rejection. Coupon application is **rate-limited**
(per IP/account) and does not distinguish "expired" from "invalid" in its message.

## 5. Payment, confirmation & inventory consume

Every admin/customer transition `SELECT … FOR UPDATE`s the order, checks `version`,
and is **idempotent** (re-running yields the same end state, never double-acts).

- **Manual submit** — `api.submit_payment_evidence(order_id, trx_id,
sender_number, screenshot_path?, scope)`: customer (or guest w/ token) attaches
  evidence → `payment_submitted`. A **duplicate-TrxID** check flags reuse for the
  admin (non-blocking at submit). Screenshot uploaded to a **private** bucket via
  the signed-URL flow with F-06-style existence verification on register.
- **Admin verify** — `api.verify_payment(order_id, actor)`: idempotent
  (already-confirmed → no-op). Payment → `verified` (enforces the verified-TrxID
  unique index → a duplicate is rejected hard here), order → `confirmed`,
  **consume reservations**, then **`api.set_inventory`** decrements real stock +
  writes a canonical `sale` movement.
  - **Restock-safety consume guard:** if, between reserve and confirm, an admin
    reduced stock below the reserved qty, the consume would drive stock negative.
    Instead of overselling, the RPC **refuses and flags the order**
    (`insufficient_stock_at_confirm`) for an admin decision (backorder/cancel).
- **Admin reject** — `api.reject_payment(order_id, reason, actor)` →
  `payment_rejected`; reservation kept until TTL or admin cancel; customer may
  resubmit.
- **COD confirm** — `api.confirm_cod_order(order_id, actor)` (optionally gated on
  a "confirmation call done" flag): same consume + guard as verify.
- **Cancel / expire** — release `active` reservations (no stock change).
- **Return / refund** — admin sets `returned` → optional **restock movement** via
  `api.set_inventory` (returns the units to stock through the ledger), then
  `refund_pending` → `refund_done` (status only; money moved manually).

**Invariant:** real `products.stock` only ever moves through `api.set_inventory`
(existing write-guard + append-only movements). Reservations are a _soft hold_;
the hard decrement happens once at confirmation; returns restock through the same
ledger. No double counting, no negative stock.

## 6. Reservation TTL & expiry

- `reservation_expires_at` on the order + `expires_at` per reservation row.
- **`api.expire_reservations()`** (service-role) releases `active` reservations
  past `expires_at` whose order is still pending, sets the order → `expired`,
  writes system status history. Scheduled via **`pg_cron`** every few minutes.
- **Lazy backstop:** availability counts only `active AND expires_at > now()`, so
  even if cron lags, expired holds never block a sale. Correctness does **not**
  depend on the scheduler (confirm `pg_cron` is enabled; backstop covers it).

## 7. Guest tracking & customer reads (hardened)

- `order_no` is **sequential and enumerable** — it is _not_ a secret. The guest
  token is the only secret: ≥128-bit entropy, stored as a SHA-256 hash, compared
  in **constant time**.
- `api.track_order(order_no, token)` is **rate-limited** (per IP) to defeat
  enumeration, returns a safe projection only on a hash match, and the track page
  is `noindex,nofollow`. No phone-only lookup anywhere.
- Logged-in customers: `api.list_my_orders(actor)` / `api.get_my_order` scoped by
  `user_id`. Customer order list + detail shipped in P4f; Stage 4 adds
  profiles/addresses/measurements.

## 8. App integration

- `checkout.server.ts` / `checkout.api.ts`: `placeOrder` (CSRF + per-IP/account
  rate limit + optional auth + `idempotency_key`), `quoteOrder`,
  `submitPaymentEvidence`, `trackOrder`. `orders.api.ts` (admin): `listOrders`,
  `verifyPayment`, `rejectPayment`, `confirmCod`, `cancelOrder`, `updateStatus`,
  `returnOrder` — all via `guardAdminWrite`.
- `checkout-ui.ts` becomes a **display-only estimate**; the real total + a
  `quote_token` come from `quote_order`. Cart shows **reconciliation diffs** from
  the quote. **Remove the F-04 fail-closed demo gate** — real checkout now exists.
- Admin `admin.orders` / `admin.payments` DB-backed ✅ (P4b/P4c/P4d; courier
  booking stays Stage 5; evidence via signed download).
- **Mock retirement ✅** (P4f): `order-ui.ts` deleted, account/order-success/
  dashboard off real RPCs. `orders.ts`/`PRODUCTS` survive only for
  `admin.courier.tsx` + `admin-ops.ts` (Stage-5-gated — courier booking holds the
  mock `Order` shape; final deletion deferred from Pass 3g to Stage 5).

## 9. Settings additions (extend Pass 3d `site_settings` + RPCs)

`reservation_ttl_hours` (default 24), `cod_enabled`, `cod_confirmation_required`
(default false), `payment_methods_enabled` (array), `order_no_prefix` (default
`NGR`), `free_delivery_on` (`subtotal` — the pinned §4.5 rule, surfaced as config).
Bounded CHECKs + the existing public/admin projection + audited save.

## 10. PaymentProvider seam (future-proofing)

A thin isomorphic interface so COD/manual/future-gateway are one shape and the
order RPCs don’t branch on method internals:

```
interface PaymentProvider {
  method: 'cod' | 'bkash' | 'nagad' | 'sslcommerz'
  requiresPrepay: boolean            // manual/gateway true, COD false
  onPlace(order): PaymentInit        // manual: awaiting-evidence; gateway: redirect/intent
  verify(order, evidence): Result    // manual: admin action; gateway: webhook
}
```

Stage 3 implements `Cod`, `ManualBkash`, `ManualNagad`. The (deferred) gateway
implements `verify` off a webhook handler that writes to the same
`order_status_history` event log — no order-core changes.

## 11. Phasing (each sub-pass: prod-proven migration, atomic commit, CI-green)

- **P1 — Order schema + numbering + idempotency.** ✅ DONE (live, migration
  `20260627130000`). Tables, sequence, enums, CHECKs, RLS deny-all, grants,
  append-only history trigger. No behavior yet.
- **P2 — Reservations + availability + expiry.** ✅ DONE (live, migration
  `20260627140000`). `inventory_reservations`, `private.available_qty`,
  `api.expire_reservations` + `pg_cron`, lazy backstop.
- **P3a — `place_order` + `quote_order` RPCs.** ✅ DONE (live, migration
  `20260627150000`). Server pricing, deterministic locking, race-safe idempotency,
  price-drift token, reservation, guest token.
- **P3b — Checkout app integration.** ✅ DONE (live, migration
  `20260627085345`). Admin payment-method settings + `checkout-shared` module +
  `checkout.server.ts` repository + `checkout.api.ts` server fns + checkout-route
  rewire (method selector, quote-driven totals, placeOrderFn with CSRF +
  rate-limit + identity + method validation, idempotency key minting + quoteToken
  drift guard) + cart reconciliation (quoteOrderFn on mount, per-item warnings,
  auto-correct quantities) + order-success page (ServerOrderSuccess component) +
  F-04 demo gate removed. Rate-limit buckets: `quoteOrder` (60/min), `placeOrder`
  (10/10min).
- **P4 — Payment evidence + verification.** ✅ DONE. DB layer (live 2026-06-30,
  migrations `…210911`/`…210936`/`…210959`/`…211019`) + app integration (P4c detail
  + lifecycle buttons, P4e private `payment-evidence` Storage bucket + customer
  submit + admin signed-URL viewer, P4d payments review queue + duplicate-TrxID
  warning + `admin_order_stats`). Migrations `20260630195555`, `20260701100539`,
  `20260701102954`.
- **P5 — Real coupons.** `coupons` + `coupon_usages`, race-safe validation +
  rate-limited application, minimal admin/seed (full coupon admin is Stage 6).
- **P6 — Admin order lifecycle.** ✅ DONE. RPCs (live 2026-06-30) + DB-backed
  `admin.orders`/`admin.payments` UI (P4b board, P4c detail + action buttons,
  P4d review queue). Bug fix (`e3c6753`): `consume_reservations` / restock
  called non-existent `set_inventory` signature — fixed (migration
  `20260701110357`).
- **P7 — Guest tracking + customer reads.** ✅ DONE. RPCs (live 2026-06-30) +
  customer order list/detail (P4f), guest tracking shifted to capability model
  (`/track?o=&t=`). Mock `ORDERS` board + `order-ui.ts` retired; legacy
  `orders.ts`/`PRODUCTS` Stage-5-gated (courier island).
- **P8 — Hardening + concurrency tests** ✅ DONE. `pass4_db.test.sql` (full
  lifecycle, measurements round-trip, guest track scoping, transition guards,
  grant posture); `pass3_db.test.sql` + concurrency tests unchanged and green.
  Custom measurements (P4g, migration `20260701094647`): `order_items.
  custom_measurements jsonb` captured at `place_order`, projected in all reads,
  excluded from `quote_token` canon. Docs/CURRENT_STATUS refreshed.

## 12. Testing (mandatory — matches the spec’s exit bar)

DB integration (`pass3_db.test.sql`) + two-connection `concurrency.test.sh`:

- **Oversell race** — two `place_order` for the last unit; exactly one succeeds.
- **Deadlock-free multi-product** — interleaved {A,B}/{B,A} orders both complete
  (deterministic lock order).
- **Idempotency race** — concurrent retries with one key → exactly one order; same
  key + different payload → `idempotency_conflict`.
- **Coupon race** — per-user and global usage limits hold under concurrent redeem.
- **Price drift** — price changed after quote → `place_order` returns
  `price_changed`; client total never wins.
- **Reservation expiry** — expired holds release; lazy availability ignores them
  even without cron.
- **Restock-safety** — admin lowers stock under active reservations; confirm
  refuses (`insufficient_stock_at_confirm`), never oversells.
- **Double-verify idempotency** — verifying twice decrements stock once.
- **Duplicate TrxID** — second verify of the same TrxID is rejected.
- **COD vs manual** paths; **verify → stock decrement + ledger `sale` movement**;
  **return → restock movement**.
- **Guest token** — wrong token rejected, constant-time; `track_order` rate-limit;
  RLS deny-all + grants on every new table/RPC; private bucket not public.

Vitest: isomorphic pricing/quote schema + rounding, error-message maps, transition
guards, reconciliation-diff shaping. E2E (gated): guest checkout (COD + manual),
track-by-token, admin verify + reject + return.

## 13. Risks / open items

- **`pg_cron`** availability — confirm; lazy backstop makes correctness independent.
- **COD policy** — confirmation call required before `confirmed`? (settings flag,
  default off.)
- **Refunds** — status + restock only this stage; money movement manual + Stage 5+.
- **VAT/tax** — no tax line this stage (explicit decision); revisit if required.
- **localStorage migration** — F-03 partitioning already isolates legacy device
  orders; the one-time flag converts them to view-only history.

## 14. Definition of done (Stage 3)

One order per submission under retry; every total recomputed server-side; **no
oversell under concurrency or under later stock reduction**; manual payments
verified with private evidence + duplicate-TrxID protection; COD confirmed;
reservations expire; coupons real, rate-limited and race-safe; admin runs the full
pre-ship lifecycle (incl. return/restock) safely under concurrent admins; guests
track securely (rate-limited, enumeration-safe); legacy mock `ORDERS` board +
`order-ui.ts` demo retired; `orders.ts`/`PRODUCTS` survive only for the Stage-5
courier island; `pass3_db.test.sql` + `pass4_db.test.sql` + concurrency tests
green in CI; advisors clean.
