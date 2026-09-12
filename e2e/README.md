# Visual / E2E tests (Playwright)

These drive Chromium, Firefox and WebKit browsers to verify UI flows (e.g. admin
review moderation, inventory adjustments). They are **separate** from the Vitest
unit suite (`bun run test`), which only includes `src/**/*.test.{ts,tsx}`.

## One-time setup per machine

```sh
bun install                       # installs @playwright/test (committed dep)
bunx playwright install chromium firefox webkit  # binaries are NOT committed
```

## Running

```sh
E2E_BASE_URL=http://localhost:8080 bun run test:e2e   # headless
bunx playwright test --headed                          # watch in a visible window
bunx playwright show-report                            # open the HTML report
```

`E2E_BASE_URL` defaults to `http://localhost:8080`; set it to whatever host the
dev server is actually on.

## ⚠️ Use a SAFE backend for write flows

The local `.env` may point at the **production** Supabase project. Never run
write flows (approve a review, adjust stock, etc.) against prod. Instead:

1. Create an isolated DB copy — a **Supabase branch** (via the Supabase MCP
   `create_branch`, or `supabase branches create`).
2. Start a dev server with that branch's URL/keys and set `E2E_BASE_URL` to it.
3. Provision a test admin against it: `bun run provision-admin`.
4. Run the tests, then delete the branch.

Read-only flows (browsing the storefront) are safe against any backend.

## Specs

- `storefront.spec.ts` — **read-only** public catalog paths (home, shop with the
  DB-backed filter sidebar, product detail). Gated on `E2E_BASE_URL` only — no
  admin creds, no writes — so it runs safely against any backend.
- `admin-catalog.spec.ts` — signed-in admin smoke: the dashboard's live catalog
  widgets plus the products / inventory / media-library / settings pages. Gated
  on `E2E_BASE_URL` **and** `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`.
- `reviews-moderation.spec.ts` — admin review moderation (performs a write if a
  pending review exists). Same admin-cred gating; use a SAFE backend.
- `account.spec.ts` — Stage 4 customer-account happy path: sign-in, profile
  edit, address + measurement CRUD, checkout prefill from a saved address.
  Gated on `E2E_BASE_URL` **and** `E2E_CUSTOMER_EMAIL` / `E2E_CUSTOMER_PASSWORD`
  (a dedicated test customer). WRITES to that customer's own account rows and
  cleans up after itself; use a SAFE backend.

The September audit additionally provides:

- `customer-audit.spec.ts`: independent page/layout/image/axe checks at mobile,
  tablet and desktop widths, plus a short custom-fit/lightbox/cart journey.
- `catalog-regression.spec.ts`: Bengali search, empty states, sorting, product
  badge clicks and accessible quick view, using `pages/CatalogPage.ts` and
  `fixtures/storefront.ts`.
- `cart-checkout.spec.ts`: totals, persistence, custom-item removal confirmation,
  invalid coupons, empty checkout validation and simulated price-service failure.
  It never submits a valid order.

Projects are `chromium`, `firefox`, `webkit`, `mobile-safari`, and `ipad`.
Production-mode local builds need `NODE_ENV=production` even when `.env` sets
development mode. Safari needs an HTTPS preview because the production CSP
upgrades insecure requests. Only the local `https://localhost:8443` test endpoint
allows a self-signed certificate; remote certificate validation is retained.

Tags such as `@smoke`, `@regression` and `@a11y` select the new checks. Use explicit
spec filenames when running production-safe tests; the broad suite also contains
credential-gated mutation tests.

Specs skip themselves when their required env vars are unset, so
`bun run test:e2e` stays green where nothing is wired up. A skipped test is not
evidence that a workflow passed. See the workflows for deployed smoke execution.

## Layout

- `playwright.config.ts` (repo root) — config and browser/device projects.
- `e2e/*.spec.ts` — test specs (add as features land).
- `e2e/.auth/` — saved login/storage state (gitignored; contains session tokens).
