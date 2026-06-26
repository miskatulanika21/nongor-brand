import { test, expect } from "@playwright/test";

/**
 * Smoke check that the Stage 2 DB-backed admin surfaces render for a signed-in
 * admin: the dashboard's live catalog widgets, plus the products, inventory,
 * media-library and settings pages.
 *
 * GATED: only runs when E2E_BASE_URL points at a dev server backed by a SAFE
 * database (a Supabase branch or local stack) — NEVER production. These are
 * read-only navigations (no writes), but they require an admin session, so
 * provide E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD. Without them the file is
 * skipped so `bun run test:e2e` stays green.
 *
 *   E2E_BASE_URL=http://localhost:3000 \
 *   E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=... \
 *   bun run test:e2e
 */
const BASE = process.env.E2E_BASE_URL;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(!BASE || !ADMIN_EMAIL || !ADMIN_PASSWORD, "set E2E_BASE_URL + admin creds to run");

test.beforeEach(async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
});

test("dashboard shows the live catalog widgets", async ({ page }) => {
  await page.goto("/admin");
  // Both widgets read the live product table (Stage 2 Pass 3g). They resolve to
  // real data, an empty state, or an error line — but the section headings are
  // always present once the dashboard renders.
  await expect(page.getByRole("heading", { name: "Low Stock" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Best Sellers/ })).toBeVisible();
  // The live-data framing replaced the old "seed demo data" copy.
  await expect(page.getByText(/reflect the live catalog/i)).toBeVisible();
});

test("products page renders the catalog table", async ({ page }) => {
  await page.goto("/admin/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
});

test("inventory page renders", async ({ page }) => {
  await page.goto("/admin/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
});

test("media library page renders", async ({ page }) => {
  await page.goto("/admin/media-library");
  await expect(page.getByRole("heading", { name: "Media Library" })).toBeVisible();
});

test("settings page renders", async ({ page }) => {
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
