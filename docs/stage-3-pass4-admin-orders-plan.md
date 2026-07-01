# Stage 3 Pass 4 (app integration) — Master Plan: Order Management

**Status:** complete (2026-07-01; plan created 2026-06-30). All sub-passes
(P4a–P4h) shipped + CI-green. 48 migrations total (5 new in this pass). The
Pass-4 **DB/RPC layer** was live in repo (43 migrations at plan time); this plan
covered the **app integration** that calls those RPCs. Each sub-pass followed the
project convention: **prod-proven migration (if any) + atomic commit + CI-green**,
committed straight to `main`, push each part (multi-PC).

---

## 1. Goal & current state

Orders can be **placed** (checkout → `api.place_order`) but **not operated on**:
no UI calls the Pass-4 RPCs, so an order can't be confirmed, payment-verified,
shipped, tracked, or returned. This plan delivers the full fulfilment loop.

What already exists (live, service-role-only, REVOKEd from anon/authenticated):

| RPC                                                                                | Purpose                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `api.list_orders(actor,status,search,limit,offset)`                                | admin board list (+ total)                            |
| `api.get_order_detail(order_id,actor)`                                             | admin full detail (items/payment/screenshots/history) |
| `api.transition_order(order_id,to_status,actor,reason,expected_version,restock)`   | state machine (optimistic version)                    |
| `api.verify_payment / reject_payment / confirm_cod / cancel_order / return_order`  | convenience wrappers                                  |
| `api.submit_payment_evidence(order_id,trx_id,sender_number,scope,screenshot_path)` | customer evidence (TrxID + screenshot)                |
| `api.list_my_orders / get_my_order(order_id,actor)`                                | customer reads                                        |
| `api.track_order(order_no,token_hash)`                                             | guest tracking                                        |

What must change / be removed:

- `admin.orders.tsx` (418 L) and `admin.payments.tsx` (150 L) are **mock** — they
  read the legacy `ORDERS` seed and use a **different status vocabulary**
  (`"New Order"`, `"Payment Pending"`, …). They are **replaced** with DB-backed
  screens using the real 15-status model.
- `_site.orders.tsx`, `_site.orders.$id.tsx`, `_site.track.tsx` are demo-gated
  against mock `ORDERS` → rewired to `list_my_orders` / `get_my_order` / `track_order`.
- Legacy `ORDERS` / `orders.ts` and the `isDemoCommerceEnabled()` order paths are
  retired once the real ones land (closes Stage 3 P7 + the `PRODUCTS`-deletion gate).
- **Measurements gap:** custom (made-to-measure) orders record `size='Custom'` +
  the charge, but the actual measurements live only in the buyer's localStorage —
  the workshop can't see them. Fixed here (capture at `place_order`, show in detail).

### The real status model (DB CHECK — single source of truth)

```
pending_payment · payment_submitted · payment_rejected · pending_confirmation
confirmed · processing · ready_to_ship · shipped · delivered · completed
cancelled · expired · returned · refund_pending · refund_done
```

Allowed transitions (from `transition_order`) and the action that drives each:

| From                       | Allowed →                                       | Admin action (RPC)                               |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| pending_payment            | payment_submitted, cancelled, expired           | (customer submits evidence) / cancel             |
| payment_submitted          | confirmed, payment_rejected, cancelled, expired | **verify_payment** / **reject_payment** / cancel |
| payment_rejected           | payment_submitted, cancelled, expired           | (customer resubmits) / cancel                    |
| pending_confirmation (COD) | confirmed, cancelled, expired                   | **confirm_cod** / cancel                         |
| confirmed                  | processing, cancelled                           | transition→processing / cancel                   |
| processing                 | ready_to_ship, cancelled                        | →ready_to_ship / cancel                          |
| ready_to_ship              | shipped, cancelled                              | →shipped / cancel                                |
| shipped                    | delivered                                       | →delivered                                       |
| delivered                  | completed, returned                             | →completed / **return_order**                    |
| completed                  | returned                                        | **return_order**                                 |
| returned                   | refund_pending                                  | →refund_pending                                  |
| refund_pending             | refund_done                                     | →refund_done                                     |

---

## 2. Architecture (match existing patterns)

- **Server fns** live in a new `src/lib/orders.api.ts` (mirrors `staff.api.ts` /
  `checkout.api.ts`): `createServerFn` → `guardAdminWrite()` (from
  `admin-guard.server.ts`, returns `{ actorId, role }`, enforces CSRF + active-staff
  - optional AAL2 step-up) → service-role `admin.schema("api").rpc(<rpc>, { p_actor: actorId, … })`.
    Customer reads use a thinner guard (authenticated identity, not staff).
- **Server-only repo** `src/lib/server/orders.server.ts` wraps the admin client +
  maps RPC errors to stable codes (pattern: `checkout.server.ts`). Raw SQL never
  reaches the client.
- **Isomorphic types + status model** in a new `src/lib/orders-shared.ts`:
  `OrderStatus` union (15), `ORDER_STATUS_META` (label, customer-label, tone, lane),
  `nextActions(status)`, transition request types, error-code map. Replaces the
  mock `orders.ts` status constants. **One source of truth shared by admin +
  customer + checkout.**
- **Rate limit + CSRF**: customer evidence submission and guest tracking go through
  server fns with CSRF + IP/account rate-limit buckets (pattern: `checkout.api.ts`).
- **Optimistic concurrency**: the board passes `expected_version` from the loaded
  row into `transition_order`; a `version_conflict` → toast "Order changed, refresh"
  and re-fetch. No blind overwrites.

---

## 3. Phased delivery (each = commit + push; CI-green)

### P4a — Shared status model + admin server fns (no UI yet)

- New `orders-shared.ts` (status meta/lanes/nextActions, request/response types,
  `orderErrorMessage`). Unit tests (status map exhaustive over the 15 + transition
  table parity with the RPC).
- New `orders.server.ts` + `orders.api.ts`: `listOrdersFn`, `getOrderDetailFn`,
  `transitionOrderFn`, `verifyPaymentFn`, `rejectPaymentFn`, `confirmCodFn`,
  `cancelOrderFn`, `returnOrderFn` — all staff-guarded.
- Vitest for the server fns (mock admin client; assert guard + p_actor wiring +
  error mapping), mirroring the existing `*.api` tests.

### P4b — Admin Orders board (`admin.orders.tsx`, DB-backed)

- Replace mock with: lanes (Needs action / In progress / Closed / Problem),
  status + search filter + pagination via `listOrdersFn`; row → detail sheet.
- Preserve the good legacy affordances from `admin-ops` (WhatsApp templates, print
  invoice, date-range filter) rewired to DB rows.
- Loading/empty/error states; numbers in integer BDT via `formatBDT`.

### P4c — Order detail + lifecycle actions (sheet/drawer)

- `getOrderDetailFn`: items, payment (TrxID/sender/status), screenshots (signed
  download — see P4e), full status history timeline.
- Action buttons driven by `nextActions(status)` → the matching server fn, each
  with confirm dialog, reason input where relevant, `expected_version` guard,
  optimistic UI + re-fetch. Return action offers the `restock` toggle.

### P4d — Payments review (`admin.payments.tsx`, DB-backed)

- Queue of `payment_submitted` orders (filter on `list_orders`); verify/reject with
  the duplicate-TrxID warning surfaced from the order/payment row; links into the
  P4c detail. (May merge into P4c as a filtered view to avoid duplication — decide
  at build time.)

### P4e — Payment evidence: customer submit + admin view (private Storage)

- **Migration:** a private `payment-evidence` Storage bucket + RLS (service-role
  write via server fn; no public read). `submit_payment_evidence` already records
  `payment_screenshots.storage_path`.
- Customer: on `pending_payment` / `payment_rejected`, an evidence form (TrxID +
  sender + screenshot upload) → `submitPaymentEvidenceFn` (CSRF + rate-limit +
  owner/guest scope) → uploads to the bucket, calls the RPC. Replaces the
  checkout-time localStorage TrxID stash.
- Admin: signed-URL download of the screenshot in the detail view.

### P4f — Customer order history + tracking (retire mocks)

- `_site.orders.tsx` → `listMyOrdersFn`; `_site.orders.$id.tsx` → `getMyOrderFn`;
  `_site.track.tsx` → `trackOrderFn(order_no, token)` (guest, rate-limited).
- Remove `isDemoCommerceEnabled()` order paths + the mock `ORDERS`; **delete the
  legacy `PRODUCTS`/`orders.ts`** once nothing references them (closes P7 + the
  `PRODUCTS`-deletion gate).

### P4g — Custom-order measurements server capture (fulfilment)

- **Migration:** `order_items.custom_measurements jsonb` (nullable); `place_order`
  threads an optional per-line `measures` object into it (excluded from pricing +
  `quote_token` canon, so no drift); `get_order_detail` / `get_my_order` project it.
- Checkout/cart already hold `customSize`; pass it on `place_order`. Admin detail +
  customer detail render the measurements table. Closes the workshop-visibility gap.

### P4h — Tests + docs + advisors

- Extend `pass3_db.test.sql` (or new `pass4_db.test.sql`): full lifecycle
  (place→submit_evidence→verify→confirm→…→delivered→returned+restock), reject→retry,
  guest track scoping, measurements round-trip, RLS/grant posture.
- E2E (Playwright) happy path: place order → admin verify → status visible to
  customer. `get_advisors` after the Storage/RLS migration. Refresh
  `CURRENT_STATUS.md` / `IMPLEMENTATION_PLAN.md` / `stage-3-design.md`.

---

## 4. Risks & decisions

- **Status-vocabulary migration:** the mock UI vocabulary is abandoned, not mapped.
  `orders-shared.ts` is the only status source post-P4a; grep-kill the old constants.
- **Optimistic concurrency is mandatory** on every transition (`expected_version`)
  — two admins acting at once must not silently clobber.
- **Evidence bucket is private** — never public-read; admin views via short-lived
  signed URLs only. Customer upload is server-mediated (no direct client write).
- **Measurements** are excluded from the price token (P4g) to avoid spurious
  `price_changed`; they are fulfilment data, not pricing data.
- **COD vs manual** drive different lanes/actions: COD → `pending_confirmation` →
  `confirm_cod`; manual → `pending_payment` → evidence → `verify/reject`.
- **Open call:** whether Payments (P4d) is a standalone screen or a filtered view of
  the Orders board — lean to a filtered view (one detail surface, less drift).

---

## 5. Suggested order of execution

P4a → P4b → P4c → (P4d folded in) → P4e → P4g → P4f → P4h. This yields a usable
admin fulfilment loop after P4c, adds evidence handling and measurements before
exposing the customer-facing views, and retires the mocks last.
