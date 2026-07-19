import { defineConfig, devices } from "@playwright/test";

// Playwright E2E / visual tests. SEPARATE from the Vitest unit suite — Vitest
// only includes its src test files, while these live under e2e/.
//
// One-time per machine (the browser binary is NOT committed):
//   bunx playwright install chromium
//
// Run: `bun run test:e2e` (headless) or `bunx playwright test --headed`.
//
// SAFETY: the committed .env targets PRODUCTION. Point E2E_BASE_URL at a dev
// server backed by a SAFE database (a Supabase branch or local stack) before
// exercising any write flow. See e2e/README.md.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Vercel protects preview deployments behind SSO. When the automation-bypass
    // secret is present, send it on EVERY suite — this lived in smoke.spec.ts
    // alone, so a11y runs could not reach a protected preview at all.
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
