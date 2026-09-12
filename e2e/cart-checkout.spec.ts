import { test, expect } from "@playwright/test";
import { addAvailableProduct } from "./helpers/cart";

test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL");
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await addAvailableProduct(page);
  await page.goto("/cart", { waitUntil: "networkidle" });
});

test("@smoke CART-009 CHECK-008 server quote and total arithmetic", async ({ page }) => {
  const amount = async (label: string) => {
    const text = await page.getByText(label, { exact: true }).locator("..").innerText();
    const match = text.match(/৳\s*([\d,]+)/);
    if (!match) throw new Error(`Missing ${label} amount`);
    return Number(match[1].replace(/,/g, "")) * 100;
  };
  await expect(page.getByText("✓", { exact: true })).toBeVisible();
  expect(await amount("Total")).toBe((await amount("Subtotal")) + (await amount("Delivery")));
});

test("@regression CART-010 CART-007 cart persists, then removes its item", async ({ page }) => {
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Remove item", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove item", exact: true })).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Checkout", exact: true })).toHaveCount(0);
});

test("@regression COUPON-002 invalid coupon rejected by server", async ({ page }) => {
  await page.getByPlaceholder("Coupon code").fill("QA-NOT-A-REAL-COUPON-9D3D");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("This code isn't valid.")).toBeVisible();
});

test("@smoke CHECK-003 empty shipping form blocks order submission", async ({ page }) => {
  await page.getByRole("link", { name: "Checkout", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Full name *", exact: true })).toBeVisible();
  // The empty form's validation prevents any order mutation.
  await page.getByRole("button", { name: "Place Order (Cash on Delivery)", exact: true }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByRole("textbox", { name: "Full name *", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("@regression API-002 price service failure shows estimates and can retry", async ({
  page,
}) => {
  let blocked = 0;
  const origin = new URL(page.url()).origin;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && new URL(request.url()).origin === origin) {
      blocked++;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else await route.continue();
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("These totals are estimates");
  expect(blocked).toBeGreaterThan(0);
  await page.unrouteAll();
  await page.getByRole("button", { name: "Retry prices", exact: true }).click();
  await expect(page.getByText("✓", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry prices", exact: true })).toHaveCount(0);
});
