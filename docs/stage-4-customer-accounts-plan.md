# Stage 4 — Master Plan: Customer Accounts (server-backed, premium)

**Status:** **complete → STAGE 4 CLOSED** (P1–P9, 2026-07-03; plan created
2026-07-02). All sub-passes shipped + CI-green; 56 migrations at closure;
`stage4_db.test.sql` §1–§18 in CI; `e2e/account.spec.ts` validated 6/6 against
a live dev server. Live detail in `CURRENT_STATUS.md`. Each sub-pass followed
the project convention: **prod-proven migration (if any) + atomic commit +
CI-green**, committed straight to `main`, pushed per part (multi-PC).

---

## 1. Goal & current state

Customer account data (profile, saved addresses, saved measurement profiles)
lives **only in localStorage** (`src/lib/account-ui.tsx` — per-user-scoped keys,
legacy keys purged). There is no cross-device sync, no server truth, and the
two prefill adapters that already exist (`savedAddressToCheckoutAddress`,
`measurementProfileToCustomSize`) have **zero consumers** — checkout and the
PDP custom-size form are typed fresh every time. Stage 4 makes accounts real
and turns them into a premium shopping accelerator.

**Already shipped (do NOT rebuild — V3 Stage-4 items closed by Stage 3):**

| V3 Stage-4 item                          | Shipped in                                          |
| ---------------------------------------- | --------------------------------------------------- |
| Order history by `auth.uid()`            | P4f — `list_my_orders` / `get_my_order` + UI        |
| Secure guest tracking (never phone-only) | P4f — capability model (`order_no` + 32-byte token) |
| Measurements captured on the order       | P4g — `order_items.custom_measurements`             |
| Customer auth + account area guard       | Stage 1/2 — `loadCustomerArea` (staff redirected)   |

**What Stage 4 actually builds:**

1. Server-authoritative `customer_profiles` / `saved_addresses` /
   `saved_measurements` (+ premium: `wishlist_items`).
2. `account-ui.tsx` provider re-backed by server fns — **same context contract,
   same route UIs** (V3 preservation), now async + optimistic.
3. One-time localStorage → server migration per the V3 table (flagged, purged).
4. **Prefill wiring** — the premium payoff: checkout address picker + PDP
   measurement picker, plus "save for next time" in both directions.
5. Wishlist server sync (guest local → merged on login).
6. DB-backed `admin.customers.tsx` (profiles + real order aggregates; retires
   the mock `CUSTOMERS` array).
7. Guest-order claim: attach a guest order to the signed-in account via its
   capability token (never via phone/email match).

**Explicitly out of scope:** server-side cart (V3 keeps cart local for guests;
no cart table in the V3 stage list — merge-on-login applies to wishlist only),
courier (Stage 5), newsletter/contact (Stage 6), account deletion/data export
(designed in §8 open decisions; owner-gated — interacts with the orders
owner-XOR invariant).

---

## 2. Architecture & security posture (match existing patterns)

- **Tables are RLS deny-all, RPC-only** — identical posture to
  inventory/settings/orders/coupons. No direct PostgREST reads/writes; every
  mutation flows through one hardened path with stable snake_case error codes.
- **RPCs are `SECURITY DEFINER`, `search_path=''`, service-role-only EXECUTE**
  (REVOKE from anon/authenticated). The server fn passes the **verified**
  user id (`p_user`) from the session — the client never chooses the scope.
  Every RPC's first act: `p_user` must exist / rows must belong to `p_user`.
- **Server fns** (`account.api.ts`, pattern: `checkout.api.ts` /
  `reviews.api.ts`): `createServerFn` → CSRF middleware →
  `getAuthenticatedIdentity()` (else `requiresAuth`) → per-IP + per-account
  rate limit → service-role `.schema("api").rpc(...)`.
  New buckets: `accountRead` (60/min), `accountWrite` (30/10min).
- **Isomorphic module** `account-shared.ts`: DTO types, zod validators
  mirroring the DB CHECKs, `accountErrorMessage` map, snake↔camel mapping.
  `account-ui.tsx` keeps the React provider but delegates persistence.
- **Server repo** `src/lib/server/account.server.ts`: service-role client +
  `AccountError(code)`; raw SQL/PostgREST shapes never reach the client.
- **Audit:** routine customer self-writes are **not** written to `audit_logs`
  (staff-canonical table; would be noise). Exceptions that ARE audited:
  `account.imported` (one-time migration), `order.claimed` (ownership change —
  security-relevant). Decision recorded in §8.

---

## 3. Data model (migration `stage4_account_schema`)

All money-free; all text bounded by CHECKs; all tables `user_id uuid NOT NULL
REFERENCES auth.users(id) ON DELETE CASCADE`; `created_at`/`updated_at`
timestamptz with the standard touch trigger.

**`customer_profiles`** — one row per user, lazily created on first write.

- `user_id` PK
- `full_name` text CHECK (1..120)
- `phone` text NULL CHECK (`^01[3-9][0-9]{8}$` — normalized BD format; the
  app normalizes via `normalizeBDPhone` before send, DB re-asserts)
- `birthday` date NULL CHECK (between 1900-01-01 and now())
- Email is **not** stored here — `auth.users.email` stays the single source
  (profile reads join it server-side; F-11 change-email flows stay in auth).

**`saved_addresses`** — cap **10 per user** (enforced in RPC; defensive CHECK
via count in the insert RPC, not a trigger).

- `id` uuid PK default `gen_random_uuid()`
- `label` text NULL CHECK (≤40); `recipient` 1..120; `phone` BD CHECK;
  `district` 1..80; `area` 1..120; `address` 1..500
- `is_default` boolean NOT NULL default false
- **Partial unique index `(user_id) WHERE is_default`** — the DB, not the
  client, guarantees at-most-one default (the current client-side
  `normalizeDefaults` becomes a UI nicety, not the invariant).

**`saved_measurements`** — cap **12 per user**.

- `id` uuid PK; `name` 1..80 + **unique `(user_id, lower(name))`** →
  `duplicate_measurement_name` (client keeps its "(Copy n)" naming helper)
- `bust/waist/hip/shoulder/sleeve/dress_length` numeric(5,1) NULL
  CHECK (> 0 AND < 200) — inches, matching the PDP custom-size bounds
- `fit_preference` text NOT NULL CHECK in ('Fitted','Regular','Relaxed')
  default 'Regular'

**`wishlist_items`** (P6) — cap **100 per user**.

- PK `(user_id, product_id)`; `product_id` references `products(code)`
  ON DELETE CASCADE; `created_at`

---

## 4. RPC surface (all service-role-only)

| RPC                                                              | Purpose / notes                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.get_my_account(p_user)`                                     | One round trip: `{profile (joined w/ auth email), addresses[], measurements[]}` — powers the account layout loader                                                   |
| `api.save_profile(p_user, p_patch)`                              | CASE-presence patch (nullable fields clearable) + lazy row create                                                                                                    |
| `api.upsert_address(p_user, p_id?, p_address)`                   | Insert (cap check → `too_many_addresses`) or owner-scoped update; atomic default flip under a per-user advisory/row lock; first address → default                    |
| `api.delete_address(p_user, p_id)`                               | Owner-scoped; promotes oldest remaining to default if the default was removed                                                                                        |
| `api.set_default_address(p_user, p_id)`                          | Atomic re-point (single UPDATE pair in one txn)                                                                                                                      |
| `api.upsert_measurement(p_user, p_id?, p_data)`                  | Cap → `too_many_measurements`; name dedupe → `duplicate_measurement_name`                                                                                            |
| `api.delete_measurement(p_user, p_id)`                           | Owner-scoped                                                                                                                                                         |
| `api.import_account_data(p_user, p_payload)`                     | **One-time** bounded import (skips entirely if any server rows exist → `already_imported`; payload re-validated row-by-row; caps enforced; `account.imported` audit) |
| `api.sync_wishlist(p_user, p_codes[])` + `api.toggle_wishlist`   | P6 — merge (union, capped) on login; single toggle thereafter; returns canonical list                                                                                |
| `api.claim_guest_order(p_user, p_order_no, p_token)`             | P7 — verifies the capability token hash, order must be guest-owned → sets `user_id`, clears `guest_token_hash` (preserves owner-XOR CHECK), `order.claimed` audit    |
| `api.admin_list_customers(p_actor, p_search, p_limit, p_offset)` | P8 — active-staff only; profiles LEFT JOIN order aggregates (orders count, lifetime spent, returns, last order at); search by name/phone/email                       |

Stable error codes (added to `account-shared.ts` map):
`invalid_profile · invalid_phone · invalid_birthday · invalid_address ·
address_not_found · too_many_addresses · invalid_measurement ·
measurement_not_found · too_many_measurements · duplicate_measurement_name ·
already_imported · wishlist_full · order_not_found · order_not_claimable ·
actor_not_authorized`

---

## 5. Sub-pass plan

**Core (the Stage-4 contract):**

- **P1 — schema.** Migration `stage4_account_schema` (3 tables + indexes +
  grants revoked + touch triggers). `stage4_db.test.sql` structural section:
  CHECK bounds, one-default partial index, name-dedupe index, cascade, RLS
  deny-all + grant posture. No behavior.
- **P2 — account RPCs.** `get_my_account / save_profile / address CRUD /
measurement CRUD / import_account_data`. Rolled-back prod proofs + DB tests:
  owner-scoping (user A can never touch B's rows), cap enforcement, default
  promotion/flip atomicity, import idempotency (`already_imported`), error
  codes as messages.
- **P3 — app server layer.** `account-shared.ts` (types/zod/error map) +
  `account.server.ts` (repo) + `account.api.ts` (server fns: CSRF + auth +
  rate limit). Vitest: validator bounds mirror DB CHECKs, error mapping,
  wiring. No UI change.
- **P4 — account UI rewire + localStorage migration.** `/account` layout
  loader calls `getMyAccountFn` (SSR — no skeleton flash for the header);
  `AccountUIProvider` keeps its exact context shape but mutations become
  `async` (routes await + toast on failure — smallest honest diff), optimistic
  update with rollback on error. **Migration:** on first authenticated account
  load, if server is empty and the user's scoped local keys hold data →
  `importAccountDataFn`, set `nongorr_account_migrated_v1::u:<id>`, purge the
  local PII keys only after a confirmed import. Local keys stop being written
  entirely from this pass on.
- **P5 — prefill (the premium payoff).**
  - Checkout: signed-in users get a saved-address selector (default
    pre-applied, chips for others, "new address" always available) +
    a **"save this address"** opt-in that fires **after** successful order
    placement (best-effort, never blocks or delays the order redirect).
  - PDP custom-size form: "use a saved profile" dropdown
    (`measurementProfileToCustomSize`) + "save these measurements as a
    profile" (named inline, capped, duplicate-name toast).
  - Both are additive UI — guest flows are pixel-identical to today.

**Premium (world-class extras):**

- **P6 — wishlist server sync.** `wishlist_items` migration + RPCs; the store
  keeps localStorage for guests, and on login merges local → server
  (union, cap 100) then treats the server as truth (local mirror for instant
  paint). Wishlist survives devices; heart states stay optimistic.
- **P7 — guest-order claim.** On order-success and `/track`, a signed-in
  viewer holding a valid guest token sees "add this order to my account" →
  `claimGuestOrderFn`. Claimed orders appear in `/orders` history. Token is
  the proof — phone/email matching is never used (V3 hard rule).
- **P8 — DB-backed admin customers.** `admin_list_customers` behind
  `requirePermission("customers.view")` (add to permissions matrix); rewrite
  `admin.customers.tsx`: server search + pagination (P4b board pattern),
  real aggregates, detail sheet linking to the customer's orders on the
  admin board (`?search=`). Retires the mock `CUSTOMERS` array. Derived tags
  (VIP / repeat / custom-size) computed from aggregates, not stored.

**Closure:**

- **P9 — stage closure.** `stage4_db.test.sql` complete (all sections),
  E2E spec (account CRUD + checkout prefill happy path), advisors clean,
  visual pass on `/account/*` against the premium bar, update
  `CURRENT_STATUS.md` / `IMPLEMENTATION_PLAN.md` / `WALKTHROUGH.md` (doc
  cadence: only at this closure, not per sub-pass).

---

## 6. UX bar (premium checklist for P4/P5)

- SSR-hydrated account pages — no content flash; skeletons only on
  client-side navigations.
- Optimistic mutations with rollback + specific error toasts (never a generic
  "something went wrong" when a stable code exists).
- Default-address and default-measurement affordances one tap from checkout/PDP.
- Empty states keep the current premium illustrations/copy; hydrate from
  server data without layout shift.
- The `/account` meta description drops the "local demo account UI" line —
  accounts are real after P4.

---

## 7. Testing matrix

| Layer                  | What                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB (CI)                | `stage4_db.test.sql`: grants/RLS posture, owner-scoping cross-user denial, caps, default invariants, dedupe, import idempotency, claim (token ok / wrong / already-owned), admin aggregates, wishlist merge |
| Vitest                 | zod ↔ CHECK parity, error map exhaustiveness, provider optimistic/rollback logic, migration-flag gating, `cartToQuoteLines`-style adapters                                                                  |
| E2E                    | login → add address → set default → checkout shows it prefilled → place COD order → "save address" round-trip; measurement save → PDP prefill                                                               |
| Rolled-back SQL proofs | Every P2/P6/P7 RPC against prod before its commit (house rule)                                                                                                                                              |
| Manual                 | Two-account same-browser isolation (F-03 regression), migration one-shot on a browser with legacy data                                                                                                      |

---

## 8. Open decisions (defaults chosen; flag at review)

1. **Async provider contract** — context mutation methods change
   `boolean → Promise<boolean>`. Route diffs are mechanical (`await` + toast).
   Chosen over a parallel new hook to avoid two account APIs.
2. **No audit rows for routine self-writes** — only `account.imported` and
   `order.claimed`. Rationale: `audit_logs` is the canonical **staff** trail;
   customer PII churn there is noise + a retention liability.
3. **Email stays in `auth.users`** — profile exposes it read-only; email
   change remains an auth flow (F-11 posture), not a profile field.
4. **Account deletion / data export** — deferred (owner decision): deletion
   collides with `orders` owner-XOR (`user_id` cascade would orphan history);
   likely design = scrub PII tables + keep orders keyed to a tombstoned auth
   user. Not built in Stage 4; documented so it isn't forgotten.
5. **Server cart** — intentionally not built (V3 keeps guest cart local;
   wishlist is the synced surface). Revisit only if multi-device cart becomes
   a real ask.

---

## 9. Stage-4 exit criteria

- Profile, addresses, measurements persist server-side, cross-device, RPC-only,
  owner-scoped, capped, with stable error codes — localStorage PII writes gone.
- One-time local → server migration runs once per user per browser, then purges.
- Checkout prefills the default saved address; PDP prefills saved measurements;
  both offer save-back. Guest flows unchanged.
- Wishlist survives login across devices (merge, then server-truth).
- A guest order can be claimed into an account via its capability token only.
- `admin.customers.tsx` is DB-backed with real aggregates; mock `CUSTOMERS`
  deleted.
- `stage4_db.test.sql` + Vitest + E2E green in CI; advisors clean; the three
  status docs updated at closure.
