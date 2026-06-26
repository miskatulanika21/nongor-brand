import { test, expect } from "@playwright/test";

/**
 * Storefront read-path checks for the Stage 2 DB-backed catalog.
 *
 * READ-ONLY: these exercise only public GET routes (home, shop, product
 * detail), so they need just a running app — no admin credentials and no
 * writes. They are gated on E2E_BASE_URL alone, so `bun run test:e2e` stays
 * green where no app is wired up, but they run against any dev/preview/prod
 * URL safely (nothing is mutated).
 *
 *   E2E_BASE_URL=http://localhost:3000 bun run test:e2e
 */
const BASE = process.env.E2E_BASE_URL;

test.skip(!BASE, "set E2E_BASE_URL to run the storefront read-path checks");

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Nongorr/i);
});

test("shop renders DB-backed products and the filter sidebar", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: /Shop Nongorr/i })).toBeVisible();

  // The filter sidebar is driven by api.catalog_facets() — the Category group
  // is always rendered (it lists DB categories with counts).
  await expect(page.getByText("Category", { exact: true }).first()).toBeVisible();

  // At least one product card links to a detail page (catalog read succeeded).
  await expect(page.locator('a[href^="/product/"]').first()).toBeVisible();
});

test("a product detail page loads from the shop", async ({ page }) => {
  await page.goto("/shop");
  await page.locator('a[href^="/product/"]').first().click();
  await expect(page).toHaveURL(/\/product\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
