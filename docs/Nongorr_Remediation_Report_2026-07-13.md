# Nongorr — Customer-Order Remediation & Retest Report (rev 2)

**Date:** 2026-07-13 (rev 2: 2026-07-16)
**Author:** Claude Code (Opus 4.8)
**Scope of rev 2:** The ten required fixes from the OpenAI Codex (GPT-5)
independent QA review of the customer order workflow, plus the staging-safety
hardening, documentation corrections, and full local verification.

> **Environment note (rev 2).** The site is in the **editing / pre-launch**
> phase — there are no real customers and no real orders. The owner explicitly
> authorized applying the order-RPC migration to the production Supabase project
> and pushing to `main`. Every database change below was first proven in a
> **rolled-back transaction** (a `DO` block that `RAISE`s to abort), so **no test
> order, account, payment evidence, or bookkeeping row was persisted**, and no
> credentials were rotated or exposed. The migration itself is idempotent and was
> applied via `apply_migration`.

---

## 0. Status at a glance

| #   | Codex finding (short)                                  | Status                                                                 |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Guest idempotent-replay redesign (no rotation)         | ✅ Fixed                                                               |
| 2   | Preserve checkout idempotency key on ambiguous failure | ✅ Fixed                                                               |
| 3   | Staging protection fail-closed + link hardening + docs | ✅ Fixed                                                               |
| 4   | Checkout/cart quote races (newest-wins, gated submit)  | ✅ Fixed                                                               |
| 5   | Checkout hydration gate                                | ✅ Fixed                                                               |
| 6   | Distinct tracking/order error states                   | ✅ Fixed                                                               |
| 7   | Post-claim success refresh with owner fallback         | ✅ Fixed                                                               |
| 8   | Order list/detail correctness                          | ✅ Fixed (all-item search, real status history, SKU/link, courier)     |
| 9   | Checkout a11y (Select aria, radiogroup keys, FAB)      | ✅ Fixed (browser-verified; FAB suppressed on checkout)                |
| 10  | Product zoom interaction + two-finger pan + tests      | ✅ Fixed (browser + component tests incl. two-finger pinch/pan wiring) |

"Partial" items ship real improvements with the residual work explicitly
enumerated in §3 — they are **documented deferrals, not silent gaps**.

---

## 1. What changed, by finding

### #1 — Guest idempotent replay, redesigned (no token rotation)

**Root cause.** The prior `api.place_order` minted a fresh guest tracking token
on the server and, on idempotent replay, returned a **new** token each time —
so a retried request could strand the caller with a token that no longer matched
persisted evidence, and the replay was not bound to the original actor/scope.

**Fix — client-held capability token.** The browser now generates the raw guest
token (`newGuestToken()` — 32 random bytes, hex) and only ever sends its SHA-256
hash (`sha256Hex`). The server stores the **hash**; the raw token never leaves
the browser, so there is nothing to rotate. Migration
`20260713120000_guest_token_client_held.sql`:

- Drops the old 8-arg `api.place_order` and creates a 9-arg version with a
  trailing `p_guest_token_hash text DEFAULT NULL`.
- Assigns `v_guest_hash` only for guest actors (`p_actor IS NULL`), ignoring any
  hash supplied by an authenticated caller.
- **Replay branch returns the original row unchanged** — `('guest_token', NULL,
'replayed', true)` — with **no rotation**, and rejects a replay whose scope
  differs from the stored scope (`idempotency_conflict`).
- Requires a valid 64-hex guest hash on the **success path only** (the check is
  placed late, after coupon validation, so read-only guest calls are unaffected):
  `guest_token_required` otherwise.
- `REVOKE … FROM public/anon/authenticated; GRANT EXECUTE … TO service_role` on
  the new signature.

**Verified in prod (rolled-back `DO` block):** fresh insert stores the hash and
returns `replayed=false`; a second identical call returns the **same** order with
the hash **unchanged**; a scope-bound replay is rejected; a guest success call
with a missing/short hash is rejected; a wrong-payload replay is rejected.

Files: `supabase/migrations/20260713120000_guest_token_client_held.sql` (new),
`src/lib/checkout-shared.ts` (`newGuestToken`, `sha256Hex`, `placementSignature`,
`guestTokenHash` in `placeOrderSchema`), `src/lib/server/checkout.server.ts`,
`src/lib/checkout.api.ts`, `src/routes/_site.checkout.tsx`.

### #2 — Checkout idempotency key survives ambiguous failures

**Root cause.** The submit handler minted a fresh idempotency key per attempt, so
a network timeout after the row was written (but before the response arrived)
would, on retry, create a **duplicate order**.

**Fix.** A per-placement **attempt record** (`loadOrCreateAttempt(signature)`,
`src/lib/checkout-attempt.ts`) persists `{signature, idempotencyKey, guestToken}`
in `localStorage`. The key/token are **reused** while the cart signature
(`placementSignature` — canonical lines, customer, zone, method, coupon) is
unchanged, so a retry replays the same idempotency key and hits the server's
replay branch (#1) instead of inserting again. The attempt is cleared only on a
**definitive** outcome (success, or `out_of_stock`); on an ambiguous
failure/catch it is **kept**. Signature change (edited cart) mints a fresh key.

Files: `src/lib/checkout-attempt.ts` (new), `src/routes/_site.checkout.tsx`,
tests `src/lib/__tests__/checkout-attempt.test.ts` (10).

### #3 — Staging protection fails closed; link hardening; runbook corrections

**Root cause.** `staging-guard.mjs` returned success when it could not determine
the linked project ref (fail-**open**), and `staging-link.mjs` spawned the CLI
with `shell: true` and an unpinned `npx supabase`, exposing it to argument
injection and version drift.

**Fix.**

- `scripts/staging-guard.mjs` rewritten around a pure
  `evaluateStagingGuard({linkedRef, declaredRef, supabaseUrl})` that returns
  `{ok:false, error}` on **any** ambiguity (unknown ref, prod ref, mismatch) —
  fail-closed. CLI execution is gated behind
  `import.meta.url === pathToFileURL(process.argv[1]).href` so it is import-safe
  and unit-testable. Exposes `PROD_REF`, `REF_RE`, `isValidStagingRef`,
  `projectRefFromUrl`, `readEnvVar`.
- `scripts/staging-link.mjs` uses `shell: false`, `npx.cmd` on win32, pins
  `supabase@2.33.9`, and validates the ref before spawning.
- `package.json` staging scripts pin `npx -y supabase@2.33.9`.
- `docs/staging-supabase-runbook.md`: corrected `SEED_CONFIRM=1`, the note that
  reset does **not** re-seed, the pass3/pass4 SQL test command, Vite env
  precedence, and the guard description.

Files: `scripts/staging-guard.mjs`, `scripts/staging-guard.d.mts` (new),
`scripts/staging-link.mjs`, `package.json`, `docs/staging-supabase-runbook.md`,
tests `src/lib/__tests__/staging-guard.test.ts` (18).

### #4 — Quote races: newest-wins, and submit gated on a verified price

**Root cause.** Rapid quantity/zone changes let a slow earlier pricing quote
overwrite a newer one, and checkout could be submitted while the displayed total
was stale or unverified.

**Fix.** A monotonic `quoteSeq` ref guards both cart and checkout: only the
newest in-flight quote may write state; superseded responses are dropped. In
checkout, `pricingVerified = quote !== null && !quoteError` **disables the submit
button** and blocks the handler until a fresh quote lands, with an inline Retry.
On a failed/aborted newest quote the cart clears its stale quote and per-item
warnings rather than showing an out-of-date number.

Files: `src/routes/_site.checkout.tsx`, `src/routes/_site.cart.tsx`.

### #5 — Checkout hydration gate

**Root cause.** Checkout rendered against a not-yet-hydrated cart, flashing an
empty/partial state.

**Fix.** Checkout waits on `cartHydrated` and renders a skeleton until the
persisted cart is loaded, so the summary and line items never flash empty.

Files: `src/routes/_site.checkout.tsx` (`Skeleton` gate), `src/lib/store.tsx`.

### #6 — Distinct order/tracking error states

**Root cause.** All read failures collapsed to a single "not found", so a
signed-in customer hitting a backend fault was wrongly told to sign in, and
existence could be inferred from error wording.

**Fix.** A typed `OrderReadReason`
(`unauthenticated | forbidden | not_found | rate_limited | origin_rejected |
network | unavailable`) with `orderReadReasonMessage` / `orderReadReasonRetryable`
in `orders-shared.ts`, mapped from server errors by `reasonFromOrderError` in
`orders.api.ts` and threaded through `listMyOrdersFn` / `getMyOrderFn` /
`trackOrderFn`. The list, detail, and track routes now render reason-specific
panels: only `unauthenticated` prompts sign-in; backend/network faults offer
**Retry** (`router.invalidate()` / a `reloadKey`); not-found does not reveal
whether the order exists to a non-owner.

Files: `src/lib/orders-shared.ts`, `src/lib/orders.api.ts`,
`src/routes/_site.orders.index.tsx`, `src/routes/_site.orders.$id.tsx`,
`src/routes/_site.track.tsx`, tests in `orders-shared.test.ts` (3 new).

### #7 — Post-claim success refresh with owner fallback

**Root cause.** The success page relied on the guest track path only, so a
signed-in owner arriving with an `order_id` could see a stale/empty summary.

**Fix.** `_site.order-success.tsx` `load()` tries the guest track (using the
client-held token) first, then falls back to the owner read
(`get_my_order`) when `signedIn && order_id`, rendering item thumbnails via
`OrderItemThumb`.

Files: `src/routes/_site.order-success.tsx`.

### #8 — Order list/detail correctness

**First pass (correctness):** placeholder-image `onError` fallback
(`OrderItemThumb`), capitalized payment status, pluralized `item(s)` copy, a
"showing latest N of M" pagination notice, `{qty} × {unitPrice}` per line, and
variant size when present.

**Enrichment pass (2026-07-16, migration
`20260716120000_customer_order_projection_enrich.sql`):** the three customer read
RPCs were additively enriched (same signatures, CREATE OR REPLACE, applied to
prod and verified in a rolled-back `DO` block; the SQL regression tests live in
`pass4_db.test.sql` §1/§1b/§2):

- **All-item search** — `list_my_orders` now returns `item_names` (every line);
  the order list searches across all of them, not just the first.
- **Real status-history timeline** — `get_my_order`/`track_order` already
  returned the true `order_status_history`; the detail and track pages now render
  it (customer status labels + real timestamps) instead of only the synthesized
  step tracker.
- **Per-item SKU + product link** — items carry `product_slug` (→ links to the
  product page) and `sku` (`products.code`).
- **Courier** — a `courier` object (provider, consignment, tracking code, courier
  status, booked-at) from the latest booked shipment, shown as a courier card
  with a "Track with {provider}" link where a public URL exists (SteadFast).

Files: `supabase/migrations/20260716120000_customer_order_projection_enrich.sql`
(new), `src/lib/orders-shared.ts` (`itemNames`, `productSlug`/`sku`,
`OrderCourierInfo`, `courierProviderLabel`/`courierTrackingUrl`),
`src/lib/server/orders.server.ts`, `src/routes/_site.orders.index.tsx`,
`src/routes/_site.orders.$id.tsx`, `src/routes/_site.track.tsx`,
`src/components/orders/OrderItemThumb.tsx`, `supabase/tests/pass4_db.test.sql`.

**Not live-walked:** the enriched **authenticated** order detail (real courier
card + history) wasn't clicked through in-browser — it needs a signed-in customer
with a booked-courier order; the RPC output is DB-verified against prod and the
render is a typed, additive conditional. See §3.

### #9 — Checkout accessibility

**Root cause.** The District/Area `SelectTrigger`s had no programmatic label or
error association, the payment method group was not keyboard-navigable as a
radiogroup, and the WhatsApp FAB could overlap footer controls.

**Fix.** District/Area triggers get explicit `id` / `aria-invalid` /
`aria-describedby` / `aria-required` (via the `Field` `htmlFor` escape hatch).
The payment method list is a `role="radiogroup"` with roving `tabindex` and
arrow-key handling (`onKeyDown`) so it is operable from the keyboard, with
`aria-checked`. Stale field errors clear as the user corrects them.

**Pending:** a live-viewport confirmation that the WhatsApp FAB does not overlap
the checkout submit/footer at 390×844 / 768×1024 — the CSS offset is in place but
not yet re-verified in-browser (§3).

Files: `src/routes/_site.checkout.tsx`.

### #10 — Product zoom interaction

**Root cause.** Two-finger movement scaled but did **not** translate (no pan while
pinching), and the gesture math/wiring was untested.

**Fix.** Extracted DOM-free gesture math to `src/lib/zoom-math.ts`
(`nextZoomStop` tap-cycle fit→2×→3×→fit, `pinchScale`, `clampPanBox` so pan can
never enter the letterbox, `zoomAroundPoint` focal-point-stationary zoom) with
12 unit tests. `ProductImageViewer` now tracks a `pinchMid` ref and, on a
two-finger move, applies **both** the pinch scale **and** the midpoint
translation through `clampPanBox` — so a constant-distance two-finger drag is a
pure pan. The interaction model is documented at the top of `zoom-math.ts`.

**Coverage.** Browser-verified (button zoom, keyboard `+`/`ArrowRight`/`0`,
single-tap cycle → 2×, Escape focus-return). Added
`ProductImageViewer.test.tsx` (5 tests) that mocks layout and dispatches real
pointer events to pin the **DOM wiring** the math tests can't: two-finger pinch
scales, and a **constant-distance two-finger drag pans while zoomed** (clamped
inside the rendered image, never NaN), plus the +/−/0 and close controls. Only a
real-hardware touch pass remains optional.

Files: `src/lib/zoom-math.ts`, `src/components/site/ProductImageViewer.tsx`,
tests `src/lib/__tests__/zoom-math.test.ts` (12) +
`src/components/site/__tests__/ProductImageViewer.test.tsx` (5).

---

## 2. Verification

**Local commands (all green):**

- `npm run typecheck` → **0 errors**
- `npx eslint .` → **0 errors** (pre-existing warning baseline only)
- `prettier --check` on changed files → clean
- `npm run test` → **636 passed / 636** (56 files) — includes the new
  checkout-attempt (10), staging-guard (18), zoom-math (12), order-read-reason
  (3), and ProductImageViewer pointer/pinch (5) suites
- `npm run build` → ✓

**Database (production, non-persisting):** two additive migrations applied via
`apply_migration`, each proven in a rolled-back `DO` block (no row persisted):
`20260713120000` (client-held guest token — fresh insert / identical replay
unchanged / scope-bound rejection / missing-hash rejection / wrong-payload
rejection) and `20260716120000` (enriched customer projections — `product_slug`

- `sku` resolve, `item_names` populated, `courier` populates from a synthetic
  shipment and collapses to null when unbooked). The `pass4_db.test.sql` §1/§1b/§2
  assertions covering the new fields were also replayed against prod in a
  rolled-back block.

**Live browser retest (done, 2026-07-16, CDP device-emulation at 390×844,
768×1024, 1440×900):**

- **#6 error states** — `/track` empty submit sets `aria-invalid` on both fields,
  shows distinct inline errors, focuses the first invalid field, and does not
  navigate; a wrong order/code returns a neutral **"Order not found"** (never
  reveals existence). `/orders` unauthenticated → "Sign in to see your orders";
  `/orders/<bad-uuid>` → "Order not found" (client guard, no server call);
  `/orders/<valid-uuid>` unauthenticated → "Sign in to view this order" — proving
  the unauthenticated vs. not-found distinction end to end.
- **#7** — a synthetic invalid success URL (bad guest token, not signed in) →
  safe **"We couldn't load your order summary"** with no order data exposed.
- **#10** — image viewer: button zoom (→125%), keyboard `+` (→156%) and
  `ArrowRight` pan (translateX −60), `0` reset (→100%), single-tap cycle
  fit→2× (`scale(2)`), and **Escape returns focus to the "Open image viewer"
  trigger**. The group's `aria-label` documents the interaction model.
- **#9** — District `SelectTrigger` carries the aria on the real element
  (`id="checkout-district"`, `aria-required`); on a blocked submit it gains
  `aria-invalid="true"` + `aria-describedby`, an error **summary** (`role=alert`)
  takes focus listing all fields, and the payment `role="radiogroup"` roves
  tabindex with `ArrowDown` moving COD→bKash. Client validation blocked the empty
  submit (no order placed).
- **#5** — `/checkout` hydrated with the persisted cart (badge = 1); no
  "Nothing to checkout" flash.
- **FAB (#9):** the initial retest found that, in the extreme scroll position
  where the Place Order button pins to the viewport bottom, the FAB clipped the
  button's top-right corner (center/label still clickable). **Now fixed** — the
  WhatsApp FAB is suppressed on the `/checkout` route (`isCheckoutRoute` gate in
  `src/routes/_site.tsx`), the same "reduce distraction near the pay action"
  pattern used by top e-commerce checkouts; support stays inline (7 WhatsApp
  links + FAQ/contact on the page). Re-verified: FAB absent on `/checkout`,
  present on the PDP; the Place Order button is unobstructed at the viewport
  bottom.
- Console: no JS errors, no passive-listener flood — only a benign CSP
  report-only advisory (a known Stage-7 CSP item).

**Still not run (honest gap):** an **authenticated** in-browser walk of the
enriched order detail (real courier card + status history — needs a signed-in
customer with a booked-courier order; the projection is DB-verified and the
render is typed/additive), an optional real-hardware touch pass for #10 (the DOM
wiring is now covered by dispatched-pointer component tests), and a real
end-to-end guest order on an isolated staging Supabase — the client-held-token
contract is unit- and DB-proven, but a full success→track→claim→detail live
trace remains outstanding (§3).

---

## 3. Remaining work (documented deferrals & risks)

1. **Authenticated live walk of the enriched order detail (#8)** — sign in as a
   customer with a booked-courier order and confirm the courier card + real
   status-history render in-browser. The RPCs are DB-verified against prod and the
   render is typed/additive, so this is confirmation, not a known risk.
2. **Staging E2E** — provision an isolated Supabase (branch/local) and run a real
   disposable guest order through success → track → claim → owner detail to
   exercise the client-held-token contract end to end. This is the one item still
   blocked purely on infra (no Docker on this PC; a cloud branch is paid).
3. **Optional:** a real-hardware touch pass for #10 (pinch/pan is now covered by
   dispatched-pointer component tests), and an ETA field on the courier card once
   the courier integration surfaces one (the schema has no ETA column today).

---

## 4. Suggested next steps

1. Stand up the staging Supabase and run the guest-order E2E + the authenticated
   order-detail walk above.
2. If/when the courier integration exposes a delivery ETA, add it to the
   `courier` projection and the courier card.
