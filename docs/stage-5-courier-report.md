# Stage 5 — Courier Integration + Review Remediation: Delivery Report

**Status:** **implemented + remediated, CI-green** (courier landed 2026-07-07,
`17dab60`; five-part remediation pass 2026-07-10/11). 62 prod migrations;
539 Vitest; `stage5_db.test.sql` in CI. Living detail: `CURRENT_STATUS.md`
(2026-07-11 header entry) and `WALKTHROUGH.md` ("Courier & shipments").

## What shipped (courier, `17dab60` + hotfix `20260707162039`)

- **Schema** (`20260707150000`, all RPC-only deny-all): `courier_providers`
  (registry, NO secrets — credentials stay in env), `shipments` (one row per
  booking attempt; 3-phase `booking_status`; COD + reconciliation fields;
  partial unique index = one active forward shipment per order),
  `shipment_events` (append courier status log), `webhook_events`
  (idempotency ledger), `notification_events` (outbox). Order statuses
  **15→17**: `courier_booked`, `delivery_failed`.
- **Adapters** (`src/lib/server/courier/`): SteadFast (Api-Key/Secret-Key),
  Pathao (OAuth2 client-credentials, cached token, one 401 retry, 2025+
  auto-address payload), Manual (admin-supplied tracking code).
- **3-phase booking** (`courier.server.ts`): pending row committed → external
  API call with no open DB transaction → success/failure committed. Stale
  pending attempts expire (10 min) and are admin-resolvable.
- **Webhooks** (`/api/webhook/{steadfast,pathao}`): POST-only, per-IP
  rate-limited, disabled (503) until `*_WEBHOOK_SECRET` is set, generic 200s.
- **App**: DB-backed `admin.courier.tsx`; 7 guarded server fns; COD
  computation (`prepaid`/`cod`/`partial_cod`); bKash/Nagad must be
  payment-verified before booking. Legacy mock `orders.ts` / `admin-ops.ts`
  deleted (the last mock-data island).

## The remediation pass (2026-07-10/11)

A senior review independently verified 17 external-audit findings against the
code (12 true / 2 partial / 1 already-resolved / 1 N/A / 1 false) and fixed
everything launch-blocking in five parts — each part: prod-proven migration
(rolled-back proof) where applicable + tests + CI-green + live verification.

1. **Real audit viewer** (`173d434`, migration `20260710190825`) — the admin
   Audit Logs page had been a hardcoded mock while every RPC wrote real
   `audit_logs` rows nobody could see. Now an owner-only viewer
   (`api.list_audit_logs`: role re-check, SQL-side actor→email/name/role
   resolution, filters + clamped pagination); `audit-shared.ts` is the
   single-source action taxonomy with compile-time label parity.
2. **Courier lifecycle actually progresses** (`588a01c`, migration
   `20260710193507`) — three stacked bugs: `update_shipment_status` guarded
   its transition with `IF v_order IS NOT NULL` on a RECORD (only true when
   every column is non-null — never for a real order), so **no webhook had
   ever transitioned any order**; `courier_booked→delivered` was not an
   allowed transition even though SteadFast emits no pickup signal; and the
   manual poll button sent raw provider statuses the RPC ignores. Fixed:
   `IF FOUND`; `courier_booked→{shipped,delivered,delivery_failed,cancelled}`;
   `in_transit`/`out_for_delivery`→`shipped`; poll maps raw→internal exactly
   like the webhook; "Mark delivered" admin action for signal-less couriers.
3. **Booking & webhook integrity** (`00cd75d`, migration `20260710195925`) —
   a carrier "success" carrying no consignment id is now a booking FAILURE
   (`empty_courier_reference`; adapters + RPC guard, manual exempt); webhook
   idempotency keys are SHA-256 of the raw body (the old key embedded
   `Date.now()`, so every provider retry looked unique and reprocessed);
   `webhook_events.processed`/`error` are maintained
   (`api.set_webhook_event_processed`); the 64 KB cap applies to the read
   body, not the spoofable `content-length`. **Plus a runtime P0 found only
   by driving the live webhook flow** (`9c8bd32`): `courier.server.ts` called
   RPCs without `.schema("api")`, so every courier RPC resolved to a
   non-existent `public.*` function — all courier operations had failed at
   runtime since Stage 5 shipped, invisible to SQL/unit tests that call the
   functions directly.
4. **Courier RBAC** (`533438d`) — courier server fns gate on
   `courier.view`/`courier.manage` (was `orders.*`), matching the nav link
   and enabling a future courier-only role.
5. **Contact inbox + honest admin UI** (`87b1592`, migration
   `20260710204703`) — the storefront contact form (previously "demo form
   does not send") persists to `contact_messages` via a CSRF- and
   rate-limited server fn; staff triage it at `/admin/messages`
   (`messages.view`/`messages.manage`, `contact.status_changed` audit,
   reply-on-WhatsApp). Banners / Reports / Size Settings — mock screens that
   looked real — are hidden from the nav behind "Coming soon" placeholders
   (route guards intact). Follow-up (`ea7bf9a`): module-level server imports
   moved out of `staff.api.ts`/`mfa.api.ts` into
   `staff-ops.server.ts`/`mfa-ops.server.ts` (client-bundle import-protection;
   `/admin/staff` 500'd in dev).

## Verification

- Every migration prod-applied via the MCP with a **rolled-back functional
  proof** first; ledger↔repo parity confirmed after each apply; security
  advisors clean (only intentional INFO items) after every change.
- `stage5_db.test.sql` in CI (migrate-from-empty job): §audit (grants,
  owner-only, actor resolution, ordering, filters, pagination), §courier
  (SteadFast direct `courier_booked→delivered` regression, Pathao
  `in_transit→shipped→delivered`, `returned_to_merchant` no-op,
  `failed→delivery_failed`, grant posture), §webhook (record idempotency,
  processed/error, empty-reference guard, manual exempt), §contact
  (submit/list/triage/audit/grants).
- Live end-to-end drives against the dev server + prod DB: owner audit page
  with real rows; webhook POSTs (dedup → exactly one processed
  `webhook_events` row); contact form submit → admin inbox → mark-handled;
  nav/deep-link checks for the hidden screens. Test data cleaned up after.

## Deferred (tracked in `CURRENT_STATUS.md` follow-ups)

Booking `request_hash` enforcement (true idempotency beyond the unique
index); constant-time webhook-secret compare; footer newsletter form;
`courierWrite` rate bucket for courier mutations; notification-outbox sender;
delete the dead `PRODUCTS` export.
