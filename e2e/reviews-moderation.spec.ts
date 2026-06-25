import { test, expect } from "@playwright/test";

/**
 * Visual / interactive check for admin review moderation.
 *
 * GATED: only runs when E2E_BASE_URL points at a dev server backed by a SAFE
 * database (a Supabase branch or local stack) — NEVER production, since it
 * performs writes. Provide an admin login via E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 *
 *   E2E_BASE_URL=http://localhost:3000 \
 *   E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=... \
 *   bun run test:e2e --headed
 *
 * Without those env vars the whole file is skipped, so `bun run test:e2e` stays
 * green in environments that have no safe backend wired up.
 */
const BASE = process.env.E2E_BASE_URL;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(!BASE || !ADMIN_EMAIL || !ADMIN_PASSWORD, "set E2E_BASE_URL + admin creds to run");

test("admin can open the reviews queue and moderate", async ({ page }) => {
  // Log in via the admin login route.
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // Reviews moderation page renders with the status filter.
  await page.goto("/admin/reviews");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByRole("button", { name: /pending/i })).toBeVisible();

  // If a pending review exists, approve the first one and confirm a success toast.
  const approve = page.getByRole("button", { name: "Approve review" }).first();
  if (await approve.isVisible().catch(() => false)) {
    await approve.click();
    await expect(page.getByText(/approved/i)).toBeVisible();
  }

  // Visual artifact for the report.
  await page.screenshot({ path: "test-results/admin-reviews.png", fullPage: true });
});
