# Security and customer workflow audit — 11–12 September 2026

## Scope and evidence

Reviewed production behavior at `https://nongorr.com` and tested local changes on a production-mode build. Playwright CLI 1.61.1 is installed. Chromium, Firefox and WebKit are installed; projects include desktop browsers, iPhone Safari and iPad Safari. Device projects are browser emulation, not physical-device testing.

The repository inventory covers 612 tracked files: 586 text files, 115,197 lines, and 26 binary assets. Every tracked text file received an automated line scan. This is **not a claim that every line received manual review**. Manual review concentrated on identity, CSRF, rate limiting, privileged provisioning, payment evidence, order quoting, server/client boundaries, database permissions, and the customer routes exercised below. Local evidence includes per-file hashes and scan locations in `docs/.visual-audit-assets/repository-inventory.json`.

Screenshots, browser logs, auth state, the demo access code, and test credentials remain ignored local artifacts. Do not attach raw browser traces or credential files to a public issue.

## Confirmed findings and changes

1. **Critical — known passwords on production test accounts.** All four fixed test accounts in the old provisioning script existed in production and matched its embedded password; three held active owner/admin/staff roles. With explicit user authorization, each password was replaced with a different cryptographically generated value and all sessions were revoked. Their access remains active as requested. The replacement credentials are in ignored `test_account.md`. Database verification confirmed the old password no longer matched and session counts were zero. Existing access JWTs may remain cryptographically valid until expiration; session revocation prevents refresh.
2. **High — payment screenshot upload before authorization.** A caller could cause service-role storage writes before the final payment RPC rejected an unrelated order. Upload now checks the authenticated owner or matching guest-token hash and allowed order status before writing bytes. Regression tests cover foreign/missing orders, missing guest hashes, closed orders, lookup errors, valid owners and valid guests. Signed screenshot references are restricted to the generated order/UUID filename format. The final RPC retains its locked ownership/status checks.
3. **Medium — spoofable rate-limit identity on Vercel.** A client-supplied Cloudflare header took priority over platform headers. Vercel now uses its own forwarded header or its overwritten standard forwarded header. Missing trusted headers use the shared anonymous bucket. Four regression tests cover this trust boundary.
4. **Medium — public quote actor substitution.** `api.quote_order` accepted a caller-selected account UUID for coupon-use and first-order eligibility. The migration binds public calls to `auth.uid()` while preserving the service-role path used by order placement. Its guard passed a transaction-scoped regression using a temporary function and a rolled-back coupon fixture. **The migration has not been applied to production.** This finding concerns quote eligibility/privacy; no successful order-price bypass was demonstrated.
5. **Dependency advisories.** Updated Vitest/coverage and pinned transitive browserslist, baseline-browser-mapping and js-yaml fixes. `bun audit` reports no known vulnerabilities in the resulting lockfile.
6. **Unsafe provisioning defaults.** The QA provisioning script now reads only explicit staging configuration, verifies the linked project, creates unique accounts with random passwords, preserves existing users and writes credentials only to an ignored file. The staging URL parser rejects lookalike hosts, embedded credentials, HTTP and unexpected ports.
7. **Product image clicks.** Stock/size badges intercepted clicks on product images. Their decorative overlay now ignores pointer events; the catalog regression clicks the badge area.
8. **Accessibility.** Corrected low-contrast labels on About/Founder/policy pages, persistently distinguished inline links, and made the home testimonial scroller keyboard-focusable. The 29-route audit passed serious/critical axe checks at three widths after these fixes.
9. **Price-service failures.** The cart now identifies fallback totals as estimates and offers a retry instead of silently displaying unverified prices. Browser regression simulates a 503 and checks recovery to a verified quote.
10. **Search input race.** An earlier debounced URL update could replace newer input. Own-navigation acknowledgments now preserve newer typing. Cross-browser capitalization/whitespace regression covers this sequence.
11. **Quick-view accessibility.** Product quick view now provides a linked dialog title and description, with an axe regression for the open dialog and its link to full product details.

Code findings above describe local changes unless a production action is explicitly recorded. A Git upload alone does not apply a database migration.

## Authorized production demo

- Order: **NGR-2026-000032**; one custom-size মিদোরি item, ৳1,200 plus ৳80 delivery = **৳1,280**.
- Cash on delivery; no payment sent, courier booking made, or fulfillment transition requested.
- The stored delivery address includes **TEST ORDER, DO NOT SHIP**; the cancellation reason also records the QA restriction.
- Browser order confirmation matched the database. Guest tracking worked; the temporary customer claimed the order and saw it in order history. The temporary admin inspected and cancelled that same order through the UI. The database status is **cancelled**.
- A different saved test customer was denied access to the demo order and to admin pages. Logout showed the signed-out order-history gate. Test sessions were revoked afterwards.
- The temporary QA account was deactivated, banned, password-rotated and had its sessions revoked. The four reusable test accounts remain active.

## Coverage and limitations

The page audit covers home, shop, five category pages, About, Founder, size/custom-size guides, Contact, FAQ, Eid guide, six policy pages plus Terms, wishlist, cart, checkout, tracking, login, and guest account/order/admin entry points. It captures screenshots, image decode failures, horizontal overflow, JavaScript errors, replacement characters, Bengali text and serious/critical accessibility violations. Routes run independently so one failure cannot hide the others.

Interactive checks cover Bengali product search, no-result/special-character queries, case and whitespace handling, real price sorting, badge clicks, custom measurements, product lightbox zoom, wishlist, cart quantity changes, persistence/removal, total arithmetic, invalid coupons, empty shipping validation, and pricing-service recovery. The full customer journey is limited to a small smoke test; other checks have their own tests and IDs. Reusable page objects and fixtures live under `e2e/pages` and `e2e/fixtures`.

Visual inspection found readable Bengali titles/descriptions and loaded product imagery in the captured views. Automated encoding checks do not prove perfect shaping of every possible Bengali word. Browser emulation does not replace real iOS/Android hardware or a screen-reader audit.

Card-gateway success/decline/timeout, separate billing addresses and separate tax lines do not describe this store's current COD/manual-bKash workflow. No real bKash payment was submitted. Inventory race tests, coupon exhaustion, courier booking and broad admin mutation tests were not run against production; they require disposable data and a staging backend. The currently active catalog contains custom-fit kurtis, so ready-stock variant coverage needs suitable fixtures.

Supabase reported leaked-password protection disabled. This setting remains an operational follow-up. Several deny-all RLS tables intentionally expose data only through guarded RPCs; the absence of table policies alone is not a reason to grant direct access. Distributed rate-limit configuration in the deployed environment was not independently verified. This report does not certify that no other security issues exist.

## Validation

- Unit tests with coverage: **776 passed across 68 files**, including the final application changes. Coverage thresholds passed (statements 19.50%, branches 16.88%, functions 15.34%, lines 19.46%). These are regression floors, not comprehensive coverage.
- Dependency audit: **no known vulnerabilities**.
- Migration naming/order: **95 migrations passed**.
- TypeScript check and formatting: passed; ESLint has zero errors and existing warnings.
- Production-mode build: completed. The local `.env` sets development mode, so builds for this audit explicitly set `NODE_ENV=production`.
- Browser checks: all 13 catalog/cart/checkout scenarios passed across Chromium, Firefox, WebKit, iPhone Safari and iPad Safari (65 combinations). The final feature run passed 62/65; the three Safari quick-view checks sampled an entrance animation. Waiting for the actual animation to finish resolved that measurement issue, and all five quick-view projects passed their focused rerun. No accessibility rules were disabled.
- Page audit: 29 routes at mobile, tablet and desktop widths passed image, overflow, encoding, JavaScript-error and serious/critical axe checks (87 combinations). Three viewport journeys each in Chromium and WebKit passed product selection, lightbox, wishlist, cart and checkout entry (six combinations). Earlier failed runs remain diagnostic evidence and are not counted as passing.
- Local logs: `docs/.visual-audit-assets/final-feature.log`, `quick-view-final.log`, `hydrated-journey.log`, and `coverage-release.log`. Fresh migration-chain application remains a CI check because the local Docker daemon is unavailable; the isolated quote-identity SQL guard test passed and rolled back its fixture.

## Local test operation

Use `E2E_BASE_URL` and `playwright test` with the desired project. Production-mode Safari testing needs HTTPS because the site sends `upgrade-insecure-requests`; HTTP localhost failures were diagnosed as an environment issue. The localhost TLS exception is restricted to `https://localhost:8443`; remote certificate verification remains enabled. Keep real credentials and saved authentication state out of Git.
