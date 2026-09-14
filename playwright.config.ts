import { defineConfig, devices } from "@playwright/test";
import { previewAuthFile, previewOrigin } from "./e2e/helpers/preview-auth";

// Playwright E2E / visual tests. SEPARATE from the Vitest unit suite — Vitest
// only includes its src test files, while these live under e2e/.
//
// One-time per machine (the browser binaries are NOT committed):
//   bunx playwright install chromium webkit firefox
// (or `bunx playwright install --with-deps` in CI). Run one engine with
// `bun run test:e2e -- --project=webkit`.
//
// Run: `bun run test:e2e` (headless) or `bunx playwright test --headed`.
//
// SAFETY: the local .env may target PRODUCTION. Point E2E_BASE_URL at a dev
// server backed by a SAFE database (a Supabase branch or local stack) before
// exercising any write flow. See e2e/README.md.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/preview.setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    // Self-signed local TLS is needed for Safari's upgrade-insecure-requests.
    // Never bypass certificate validation on remote preview/production hosts.
    ignoreHTTPSErrors: process.env.E2E_BASE_URL === "https://localhost:8443",
    // Preview traces can contain the bypass cookie in network metadata.
    // Keep authenticated preview sessions out of uploaded report artifacts.
    trace:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET && previewOrigin(process.env.E2E_BASE_URL)
        ? "off"
        : "on-first-retry",
    screenshot: "only-on-failure",
    // Exchange the secret once for a host-scoped cookie. Browser-wide headers
    // would disclose it to third-party images, analytics and API requests.
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && previewOrigin(process.env.E2E_BASE_URL)
      ? {
          storageState: previewAuthFile,
        }
      : {}),
  },
  // Cross-engine matrix. WebKit is the important one for a BD storefront —
  // iOS Safari is a large share of mobile commerce and has its own layout/JS
  // quirks. Mobile Safari catches viewport/touch regressions the desktop
  // engines miss. Target one engine with `--project=<name>` when iterating.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
    { name: "ipad", use: { ...devices["iPad (gen 7)"] } },
  ],
});
