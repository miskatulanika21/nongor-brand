import { test, expect } from "./fixtures/storefront";
import AxeBuilder from "@axe-core/playwright";

test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL");

test("@smoke SEARCH-001 Bengali product search and clear", async ({ catalog }) => {
  await catalog.goto();
  const name = await catalog.images.first().getAttribute("alt");
  expect(name).toBeTruthy();
  await catalog.find(name!);
  await expect(catalog.images).toHaveCount(1);
  await expect(catalog.images.first()).toHaveAttribute("alt", name!);
  await catalog.page.getByRole("button", { name: "Clear search" }).click();
  await expect(catalog.search).toHaveValue("");
  await expect.poll(() => catalog.images.count()).toBeGreaterThan(0);
});

for (const query of ["unavailable-qa-product-9d3d", "<script>alert('qa')</script>"]) {
  test(`@regression SEARCH-004 SEARCH-005 no-result query ${query}`, async ({ catalog }) => {
    await catalog.goto();
    await catalog.find(query);
    // The empty state intentionally offers recommendations below the results.
    await expect(catalog.page.getByText(/^Showing 0 of \d+ products$/)).toBeVisible();
    await expect(catalog.page.getByRole("heading", { name: /no products/i })).toBeVisible();
  });
}

test("@regression SEARCH-003 SEARCH-006 case and surrounding spaces", async ({ catalog }) => {
  await catalog.goto();
  await catalog.find("kurti");
  const count = await catalog.images.count();
  await catalog.find("  KURTI  ");
  await expect(catalog.images).toHaveCount(count);
});

for (const [label, direction] of [
  ["Price: Low to High", 1],
  ["Price: High to Low", -1],
] as const) {
  test(`@regression PLP-006 PLP-007 ${label} orders actual prices`, async ({ catalog }) => {
    await catalog.goto();
    await catalog.sort(label);
    const prices = await catalog.prices();
    expect(prices.length).toBeGreaterThan(1);
    expect(prices.every((price) => price > 0)).toBe(true);
    expect(prices).toEqual([...prices].sort((a, b) => direction * (a - b)));
  });
}

test("@regression HOME-003 product badge area opens detail", async ({ catalog, page }) => {
  await catalog.goto();
  // Regression: floating stock/size badges used to intercept this image click.
  const image = catalog.images.first();
  await image.click({ position: { x: 24, y: 25 } });
  await expect(page).toHaveURL(/\/product\//);
});

test("@regression PDP-008 A11Y-003 quick view has a name and opens full product", async ({
  catalog,
  page,
}) => {
  await catalog.goto();
  const name = await catalog.images.first().getAttribute("alt");
  await page.getByRole("button", { name: "Quick view", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: name!, exact: true });
  await expect(dialog).toBeVisible();
  // Visibility can precede the end of the dialog's opacity/filter entrance.
  // Measure the settled surface rather than a partially transparent frame.
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  await dialog.getByRole("link", { name: "Choose size & options", exact: true }).click();
  await expect(page).toHaveURL(/\/product\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name!);
});
