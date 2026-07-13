# Nongorr — Customer-Experience Remediation & Retest Report

**Date:** 2026-07-13
**Author:** Claude Code (Opus 4.8)
**Scope of this pass:** High-priority findings from the two Codex advanced-QA reports
that are **safe to fix frontend-only** (no schema changes, no production writes,
no order placement). Larger items needing DB migrations, store re-architecture,
or a staging Supabase are triaged at the end as **not done**.

> Safety: `.env` points at the **production** Supabase project. This pass made
> **no** database, order, account, or storage writes. Verification used the
> running dev server (`http://localhost:8080`) and read-only browser inspection.

---

## 1. What changed (by finding)

### Visual/a11y report (AUD-\*)

| ID         | Finding                                                  | Fix                                                                                                                                                                                   | Files                                                                                                                                                                    |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AUD-01** | Product viewer was a static lightbox; 16px close target  | New `ProductImageViewer` with real zoom (wheel, +/-, tap-cycle fit→2×→3×, pinch), image-clamped pan, drag/keyboard pan, announced zoom %, ≥44px controls, focus return to trigger     | `src/components/site/ProductImageViewer.tsx` (new), `src/routes/_site.product.$slug.tsx`, `src/components/ui/dialog.tsx` (opt-in `hideCloseButton` + 44px default close) |
| **AUD-02** | Core forms lacked programmatic labels                    | `Field` wrappers now generate a stable id, associate `<label htmlFor>`, and inject `aria-invalid`/`aria-describedby`; Radix checkbox named                                            | `_site.checkout.tsx`, `_site.contact.tsx`, `_site.account.profile.tsx`, `_site.account.addresses.tsx`, `_site.account.measurements.tsx`, `_site.account.security.tsx`    |
| **AUD-03** | Validation errors not associated; focus stayed on submit | Checkout: announced error **summary** that takes focus on submit failure, each item focuses its field; all forms: `aria-invalid`/`aria-describedby`; stale errors clear on correction | `_site.checkout.tsx` (+ the account/contact forms)                                                                                                                       |
| **AUD-04** | Account-sync / cookie copy contradicted live behavior    | FAQ + cookie-policy copy corrected to reflect real account auth + cross-device sync. **Payment-policy bKash copy left for owner** (depends on deferred payment config)                | `_site.faq.tsx`, `_site.cookie-policy.tsx`                                                                                                                               |
| **AUD-09** | 404 "New Arrivals" used `filter=new` (invalid slug)      | Changed to `new-arrivals`                                                                                                                                                             | `src/components/NotFoundPage.tsx`                                                                                                                                        |

### Order-workflow report (safe frontend batch)

| #                | Finding                                                             | Fix                                                                                                                                                                                                           | Files                                                                      |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **#1**           | `/orders/:id` unreachable — parent route had no `<Outlet/>`         | Split list into `_site.orders.index.tsx`; `_site.orders.tsx` is now an `<Outlet/>` layout; detail sign-in preserves `next=/orders/:id`. Also added **Clear filters** and image `onError` fallback to the list | `_site.orders.tsx`, `_site.orders.index.tsx` (new), `_site.orders.$id.tsx` |
| **#5**           | Payment screenshot upload not tappable/keyboard-accessible          | Drop-zone is now a real focusable `<button>` opening the picker; preview row wraps at 320px; error wired via `aria-describedby`                                                                               | `_site.checkout.tsx`                                                       |
| **#10**          | Track accepted empty/one-field submits; all errors read "not found" | Both fields required with inline accessible errors + focus; distinct not-found vs rate-limit/origin/network states; `role="status"` live region; Try-again retry                                              | `_site.track.tsx`                                                          |
| **#9 (partial)** | Checkout a11y polish                                                | Stale errors clear as fields are corrected; payment method is now a `role="radiogroup"` with `aria-checked`                                                                                                   | `_site.checkout.tsx`                                                       |

Zoom gaps from the order-report's zoom section (double-tap→300, swipe
discrimination, image-based pan bounds, wheel passive-listener flood, Enter/Space

- arrow-pan keyboard, focus return) were **all** closed in the AUD-01 rebuild.

### Store re-architecture + order content (second slice)

| #       | Finding                                                                                                          | Fix                                                                                                                                                                                                  | Files                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **#6**  | Cart hydrated in an effect keyed on the wishlist partition → false empty flash + login/logout clobbered the cart | Cart + checkout UI hydrate **once** on mount (independent of wishlist key); wishlist hydrates separately; `cartHydrated` exposed and the cart page shows a skeleton until hydrated; `pagehide` flush | `src/lib/store.tsx`, `_site.cart.tsx`                                                                         |
| **#7**  | Rapid quantity changes let a slow earlier quote overwrite newer totals                                           | Monotonic `quoteSeq` request guard — only the newest quote may write state                                                                                                                           | `_site.cart.tsx`                                                                                              |
| **#8**  | Duplicate saved/cart lines; moving merged into new lines                                                         | Canonical `lineKey` (product + size + custom measurements + charge); `mergeLine` used by add/save/move; removed the nested-setState anti-pattern                                                     | `src/lib/store.tsx`                                                                                           |
| content | `Cod`/`Bkash` labels; raw `payment_submitted` in the status filter; UTC date off-by-one for Bangladesh           | Shared `paymentMethodLabel`; filter uses `customerLabel`; `fmtDate`/`fmtDateTime` format in fixed Asia/Dhaka (UTC+6, deterministic)                                                                  | `checkout-shared.ts`, `order-status.tsx`, `_site.orders.index.tsx`, `_site.orders.$id.tsx`, `_site.track.tsx` |

New tests: `src/lib/__tests__/store-cart.test.tsx` (5) covering identical-config merge, distinct configs, custom-measurement merge/split, save-for-later dedup + merge-back, and cart-survives-login.

---

## 2. Verification

**Commands (all green):**

- `npm run typecheck` → 0 errors
- `npx eslint .` → **0 errors**, 40 warnings (all pre-existing baseline)
- `npm run test` → **588 passed / 588** (52 files; +5 new store-cart tests)

**Browser (dev server, read-only):**

- **Zoom:** buttons 100%↔300%; tap-cycle 100→200→300→100 (double-tap reaches 300%);
  wheel zoom works with **no passive-listener error flood**; pan clamped to image
  edge (`tx=136` at 3×, no blank-space drag); all controls measured **44×44**;
  focus returns to the opening thumbnail on close (verified `activeElement`).
- **#1:** `/orders/00000000-…` renders the **detail** route (title "Order · Nongorr",
  detail not-found panel) instead of the list.
- **#10:** empty submit shows both inline errors, sets `aria-invalid`, wires
  `aria-describedby`, focuses the first invalid field, and does **not** navigate.

---

## 3. NOT done — needs infra / decisions (triaged)

These are real findings from the order-workflow report deliberately **not**
attempted in this pass because they need DB migrations, store re-architecture,
or a staging Supabase (the acceptance gate's real-order E2E cannot run against
production):

- **#2** Guest idempotent-replay can lose the raw tracking token (migration
  `20260701152057` replay branch returns no `guest_token`). Needs a
  migration-backed recovery contract + concurrency tests.
- **#3 / #4** Success page trusts editable URL params and omits product summary.
  Needs a server-backed receipt/capability RPC.
- **#9 (remainder)** Saved-address radio semantics, full 44×44 mobile-target
  audit, WhatsApp FAB overlap at mobile/tablet, hidden mobile step labels.
- **Order-detail content gaps (remaining):** courier provider / consignment /
  tracking-link / ETA, real status-history timeline (currently synthesized),
  resend-payment-proof control, per-item SKU/link. _(Payment-method labels,
  status-filter labels, and the Bangladesh date off-by-one are now fixed.)_
- **Business decision (#9 payment):** what to do when zero payment numbers are
  configured — and the matching payment-policy copy (AUD-04 remainder).

**Acceptance gate not met:** placing a real disposable guest order and tracing
success→track→claim→detail requires an isolated staging Supabase, which does not
exist yet and must not be run against production.

---

## 4. Suggested next steps

1. Provision a disposable Supabase branch/local stack for order E2E.
2. Tackle #2/#3/#4 together (they share the receipt/capability contract).
3. Store re-architecture (#6/#7/#8) as one reviewable change with unit tests for
   add-then-remount, hard reload, login/logout, and stale-quote ordering.
4. Owner decision on payment-unconfigured behavior (#9) → then finish AUD-04 copy.
