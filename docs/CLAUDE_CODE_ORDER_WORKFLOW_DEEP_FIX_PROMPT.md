# Claude Code prompt: repair and verify Nongorr customer order workflow

You are Claude Code working inside the Nongorr repository at:

`D:\Coding\nongorr\nongor-brand`

I am OpenAI Codex (GPT-5), acting as an advanced customer-experience QA engineer, accessibility reviewer, and first-time shopper. I tested the local development site at `http://localhost:8080` with the in-app Chromium browser. I visually inspected and interacted with the order journey at desktop (1440x900), tablet (768x1024), and mobile (390x844), then corroborated the observed behavior against the React/TanStack Router/Supabase source and focused unit tests.

## Read this evidence first

1. Read the complete Word report:
   `D:\Coding\nongorr\nongor-brand\docs\Nongorr_Advanced_Customer_Visual_Test_Report_2026-07-13.docx`
2. Read this prompt completely before editing anything.
3. Inspect the relevant implementation yourself. Do not blindly copy the proposed fixes. Use your own reasoning to confirm root causes, find related regressions, and improve the solution.
4. Treat the current `.env` Supabase project as production. Do not place an order, provision accounts, upload payment proof, change production data, or run destructive database scripts. Build or use an isolated local/staging Supabase environment for any real order-placement test.

## How the workflow was tested

The test followed a first-time guest customer:

1. Open a product and inspect imagery.
2. Test product zoom, size selection, quantity, wishlist, share, size guide, tabs, and Add to Bag.
3. Open cart; test quantity, removal, save for later, coupon, delivery zone, notes, and checkout navigation.
4. Open checkout; test blank validation, delivery fields, district/area selection, COD/bKash switching, payment instructions, screenshot upload UI, review totals, and the final submit boundary.
5. Do not submit the valid order because local development writes to production and cancellation does not erase the permanent order/audit history.
6. Test `/order-success` using synthetic query values, including guest token, signed-in link, COD, and `payment_submitted` states.
7. Test `/track` with empty, incomplete, and invalid capability pairs.
8. Sign in with the dedicated QA customer, inspect `/orders`, and open `/orders/:id` failure states. The QA customer had no safe existing order.
9. Inspect every order-related icon/button that could be exercised without sending external messages or production writes.
10. Run focused checkout/order/courier unit suites: 91/91 tests passed, but there is no browser E2E coverage for a successful order, tracking result, or customer order detail.

## Critical and high-priority findings

### 1. Customer order detail is unreachable

`src/routes/_site.orders.tsx` is a parent route of `src/routes/_site.orders.$id.tsx`, as confirmed by `src/routeTree.gen.ts`, but the parent component never renders `<Outlet />`. Navigating to `/orders/:id` leaves the customer on the order-list/signed-out screen while the detail URL remains in the address bar. This blocks all ordered-product details for real customers.

Fix the route composition so `/orders` renders the list and `/orders/:id` renders the child detail page. Verify signed-in, signed-out, owned, unowned, invalid UUID, loading, and backend-failure states. Preserve the exact requested detail URL through login instead of always using `next=/orders`.

### 2. Guest idempotent replay can lose the only tracking credential

The replay branch in `supabase/migrations/20260701152057_coupon_pricing.sql` returns only `order_id`, `order_no`, `status`, and `replayed`, while `src/lib/checkout-shared.ts` expects `total`, `coupon`, and `guest_token`. A guest double-submit/network retry can reach success without the only raw tracking token; the database stores only its hash.

Design a safe, migration-backed recovery contract. Do not weaken token hashing or expose another customer's order. Add concurrency/idempotency tests.

### 3. The success page trusts editable URL values

`src/routes/_site.order-success.tsx` renders a convincing success screen from query parameters without server verification. A visitor can fabricate order number, total, status, token, and order ID. Validate success data through a safe server-backed receipt/capability mechanism, with a clear expired/invalid state.

### 4. Success does not confirm ordered products

The success page shows order number, status, and total only. It omits product name/image, size, quantity, custom measurements, delivery address/zone, and payment method. Add an appropriate verified summary without exposing private data through editable query parameters.

### 5. Payment screenshot upload is not tappable or keyboard-accessible

In `src/routes/_site.checkout.tsx`, the visible upload `<label>` is not associated with the separate hidden file input. Mobile users cannot drag files, and keyboard users cannot focus a `display:none` input. Connect the label/input or use an accessible button that opens the picker. Preserve type/size validation, errors, preview, replace, and remove behavior. At 320px, make the preview row wrap/stack so filename and actions do not overflow.

### 6. Cart hydration/persistence is fragile

`src/lib/store.tsx` starts with an empty cart, hydrates it in a passive effect, and persists additions in another passive effect. Full navigation/reload can show a false empty-cart state; immediate hard navigation can occur before persistence commits. Cart hydration also reruns when the account-scoped wishlist key changes, allowing login/logout transitions to overwrite in-memory cart state with stale storage.

Hydrate cart independently, expose a hydration-ready state, prevent false empty UI, and make add/update persistence robust across reload/provider remount/session changes. Add tests for add-then-remount, hard reload, login, logout, and cross-tab/session behavior.

### 7. Cart quote race produces stale totals

Rapid quantity changes reproduced a state where the line quantity returned to 1 but the summary remained at the 2-item subtotal/free-delivery quote until another action refreshed pricing. Guard asynchronous quote responses with a request sequence/abort strategy and ensure the latest cart snapshot wins.

### 8. Save-for-later duplicates are not consolidated

Two identical saved variants could coexist. Moving one to the bag moved both into separate identical cart lines. Define a canonical line identity (product + variant + custom measurements/options), deduplicate saved/cart entries, and merge quantities only when configurations are truly identical.

### 9. bKash checkout is contradictory while payment is unconfigured

The UI says the payment number is not set up and tells customers to contact WhatsApp, yet still exposes TrxID and a production order submission path. Decide the intended business rule. If no payment number is configured, disable manual-payment checkout and provide a clear support action. Never silently fall back to COD when zero payment methods are enabled.

### 10. Tracking validation and errors mislead customers

The Track button accepts empty or one-field submissions. Empty does nothing; one field updates the URL but returns the generic idle prompt. Add explicit required validation for both order number and tracking code. Distinguish not-found/invalid capability from rate limiting, invalid origin, network/backend failure, and temporary service errors. Announce loading/results/errors with appropriate live-region or focus behavior.

## Product zoom findings

The visible zoom toolbar works from 100% to 300%; +, -, reset, and close were exercised. However:

- Double-tap cannot reach 300% because the first tap immediately changes 100% to 200%, and the second resets to 100%.
- A swipe at 100% is treated as a tap because movement is tracked only while already zoomed, causing accidental 200% zoom.
- Pan bounds use the viewport instead of the object-contained image, allowing portrait/letterboxed images to move into blank space.
- Pinch changes scale but does not pan with the gesture midpoint.
- Enter/Space do not activate the focusable click-to-zoom viewport, and keyboard users cannot pan while zoomed.
- Close focus is not reliably restored because the controlled Radix dialog has no actual trigger reference.
- The named product has one unique image after URL deduplication, so previous/next could not be verified. The fixture repeats one URL and conflicts with the database unique `(product_id, url)` index.
- The 800x1024 source is too small for crisp 300% fabric/embroidery inspection.

Repair gesture discrimination, double-tap logic, image-based pan bounds, midpoint pinch translation, keyboard interaction, focus restoration, accurate instructions, and gallery fixtures. Add unit and browser tests for one-image and multi-image products.

## Checkout accessibility and mobile findings

- Corrected fields keep stale inline errors and remain in the validation summary until another submit.
- Payment and saved-address choices use color/border only; expose radio/pressed/checked semantics and a selected label.
- District/area errors are not correctly wired to the DOM trigger.
- Required fields are visually marked with `*` but not consistently programmatically required.
- Mobile step labels are hidden, leaving bare numbers without accessible stage names/current state.
- Most secondary controls are 32-36px high; target at least 44x44px for key mobile actions.
- The fixed WhatsApp button covers checkout/payment helper content at mobile/tablet widths.
- Long product rows, prices, coupon/zone labels, and screenshot filenames need 320px stress tests.

## Order list/detail/tracking content gaps

- Actual `payment_submitted` renders as raw snake_case on success and in filters.
- Order list search checks only the first product, caps at 50 without pagination, and provides no Clear Filters action.
- Payment labels render as `Cod`/`Bkash` instead of customer-facing names.
- Bangladesh dates can display the previous day because formatting is forced to UTC.
- Tracking/detail ignore returned status history and synthesize a generic timeline without event timestamps.
- There is no courier provider, consignment/tracking ID, courier link, ETA, or delivery event detail.
- Ordered-item detail lacks SKU/code, product link, clear per-unit price, and full variant metadata. Broken non-null images have no `onError` fallback.
- Checkout says failed payment proof can be resent from the order page, but no resend/upload control exists.

## What currently works

- Size-required Add to Bag validation.
- Product zoom toolbar buttons and 100%-300% limits.
- Share menu, WhatsApp URL construction, and copy-product-link toast.
- How-to-measure dialog and product content tabs.
- Cart quantity, removal, delivery-zone selector, coupon validation/removal, notes, and normal SPA checkout link after hydration.
- Checkout validation summary and its buttons focus the associated field.
- COD/bKash visual switching and review totals.
- Success-page order-number copy, tracking-link copy, tracking CTA, sign-in CTA, WhatsApp URL, and Continue Shopping link.
- Track Clear button, order-list search input, sign-out confirmation, and mobile/tablet stacking.

## Required implementation approach

1. Reproduce each issue before editing and write a failing automated test where practical.
2. Fix in small, reviewable groups. Do not modify unrelated user work.
3. Use existing shared components and status-label helpers; avoid one-off duplicate logic.
4. Add browser E2E coverage at 390x844, 768x1024, and 1440x900.
5. Add accessibility assertions for names, required/invalid/describedby, selected state, focus return, live announcements, and touch target/layout behavior.
6. For real order -> success -> track -> claim -> order-detail testing, first create an isolated Supabase branch/local stack with disposable fixtures and deterministic cleanup. Never run this flow against the current production project.
7. Run focused unit tests, typecheck/lint, and browser tests. Report exact commands, pass/fail counts, residual risks, and anything you could not verify.
8. Re-run the entire first-time customer journey visually after fixes. Use your own judgment to look for adjacent problems not listed here.

## Acceptance gate

Do not call the work complete until:

- A real disposable guest order can be placed in staging, verified on a server-backed success page, tracked with its capability pair, optionally claimed, and opened in `/orders/:id` after login.
- The order-detail route visibly renders the child page and preserves its URL through authentication.
- Ordered products, quantity, size/options, totals, delivery, payment, status history, and courier information are accurate.
- Reload/login/logout cannot flash or lose the cart, and stale quote responses cannot overwrite newer quantities.
- Mobile screenshot upload opens reliably and never causes horizontal overflow at 320px.
- Product zoom passes click, wheel, +/-/reset, drag, pinch, double-tap, keyboard, focus-return, one-image, and multi-image tests.
- Empty/incomplete track submissions show specific accessible errors; backend failures are not mislabeled as not found.
- All key mobile controls meet the intended touch-target standard and the WhatsApp FAB does not cover required content/actions.
- All automated checks pass and a final first-time-customer visual retest finds no release-blocking regressions.

When finished, update the Word report or create a clearly named remediation/retest report under `D:\Coding\nongorr\nongor-brand\docs\`, and summarize changed files, verification evidence, remaining risks, and the exact location of the saved report.
