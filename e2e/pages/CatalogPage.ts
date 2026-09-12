import { expect, type Page } from "@playwright/test";

export class CatalogPage {
  constructor(readonly page: Page) {}
  readonly search = this.page.getByRole("textbox", { name: "Search products", exact: true });
  readonly images = this.page.locator('main a[href^="/product/"] img');
  async goto() {
    await this.page.goto("/shop", { waitUntil: "domcontentloaded" });
    await this.page.waitForFunction(() => localStorage.getItem("nongorr_cart") !== null);
    await expect(this.images.first()).toBeVisible();
  }
  async find(query: string) {
    await this.search.fill(query);
    await expect.poll(() => new URL(this.page.url()).searchParams.get("q")).toBe(query.trim());
    await expect(this.search).toHaveValue(query.trim());
  }
  async sort(label: string) {
    await this.page.getByRole("combobox", { name: "Sort products" }).click();
    await this.page.getByRole("option", { name: label, exact: true }).click();
  }
  async prices() {
    // The product image's card contains exactly one current price; a sale's
    // crossed-out original amount must not participate in sorting assertions.
    return this.images.evaluateAll((images) =>
      images.map((image) => {
        const card = image.closest(".group");
        const price = card?.querySelector(".font-semibold.text-primary")?.textContent ?? "";
        if (!price.includes("৳")) throw new Error("Missing product price");
        return Number(
          price
            .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
            .replace(/[^0-9.]/g, ""),
        );
      }),
    );
  }
}
