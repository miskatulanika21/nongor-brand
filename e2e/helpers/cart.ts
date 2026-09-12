import { expect, type Page } from "@playwright/test";

/** Add through the public UI; sample custom measurements stay in the local bag. */
export async function addAvailableProduct(page: Page): Promise<string> {
  await page.goto("/shop", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("nongorr_cart") !== null);
  await expect(page.locator('a[href^="/product/"]').first()).toBeVisible();
  const paths = await page
    .locator('a[href^="/product/"]')
    .evaluateAll((links) => Array.from(new Set(links.map((link) => link.getAttribute("href")!))));
  for (const path of paths) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // This is written by the product's mount effect, after event hydration.
    await page.waitForFunction(() => sessionStorage.getItem("nongorr:recently-viewed") !== null);
    const add = page.getByRole("button", { name: /^Add to bag$/i }).first();
    if (!(await add.isEnabled())) continue;
    const sizes = page.getByRole("button", {
      name: /^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d+\s*[-–]\s*\d+\s*(years|Y)?)$/i,
    });
    if (await sizes.count()) {
      const available = sizes.and(page.locator(":enabled")).first();
      if (await available.count()) {
        await available.click();
      } else {
        const custom = page.getByRole("button", { name: /✦ Custom Size/ });
        if (!(await custom.count())) continue;
        await custom.click();
        for (const [label, value] of Object.entries({
          "Bust (in)": "36",
          "Waist (in)": "30",
          "Hip (in)": "38",
          "Shoulder (in)": "14",
          "Sleeve (in)": "18",
          "Kurti Length (in)": "42",
        })) {
          await page.getByRole("spinbutton", { name: label, exact: true }).fill(value);
        }
      }
    }
    await add.click();
    const added = page.getByText("Added to bag", { exact: true });
    try {
      await expect(added).toBeVisible({ timeout: 2000 });
      return path;
    } catch {
      // Custom-only products require measurements; try the next product.
    }
  }
  throw new Error("No available ready-size or one-size product could be added through the UI");
}
