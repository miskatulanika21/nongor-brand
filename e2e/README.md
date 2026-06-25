# Visual / E2E tests (Playwright)

These drive a real Chromium browser to visually verify UI flows (e.g. admin
review moderation, inventory adjustments). They are **separate** from the Vitest
unit suite (`bun run test`), which only includes `src/**/*.test.{ts,tsx}`.

## One-time setup per machine

```sh
bun install                       # installs @playwright/test (committed dep)
bunx playwright install chromium  # downloads the browser binary (NOT committed)
```

## Running

```sh
E2E_BASE_URL=http://localhost:3000 bun run test:e2e   # headless
bunx playwright test --headed                          # watch in a visible window
bunx playwright show-report                            # open the HTML report
```

`E2E_BASE_URL` defaults to `http://localhost:3000`; set it to whatever host the
dev server is actually on.

## ⚠️ Use a SAFE backend for write flows

The committed `.env` points at the **production** Supabase project. Never run
write flows (approve a review, adjust stock, etc.) against prod. Instead:

1. Create an isolated DB copy — a **Supabase branch** (via the Supabase MCP
   `create_branch`, or `supabase branches create`).
2. Start a dev server with that branch's URL/keys and set `E2E_BASE_URL` to it.
3. Provision a test admin against it: `bun run provision-admin`.
4. Run the tests, then delete the branch.

Read-only flows (browsing the storefront) are safe against any backend.

## Layout

- `playwright.config.ts` (repo root) — config: `testDir: ./e2e`, chromium project.
- `e2e/*.spec.ts` — test specs (add as features land).
- `e2e/.auth/` — saved login/storage state (gitignored; contains session tokens).
