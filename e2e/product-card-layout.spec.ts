import { test, expect } from "./fixtures/storefront";

test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL");

for (const [route, view] of [
  ["/", "grid"],
  ["/shop", "grid"],
  ["/shop", "list"],
]) {
  test(`@regression UI-001 product photos stay unobstructed on ${route} ${view}`, async ({
    page,
  }) => {
    // Each case verifies two viewport sizes and waits for real catalog photos.
    test.setTimeout(60_000);
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => localStorage.getItem("nongorr_cart") !== null);
    const cards = page.getByTestId("product-card");
    await expect(cards.first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Include a narrow Android width in addition to each browser project's viewport.
    const initialViewport = page.viewportSize()!;
    if (view === "list") {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.getByRole("button", { name: "Compact list view" }).click();
    }
    for (const viewport of [initialViewport, { width: 320, height: 800 }]) {
      await page.setViewportSize(viewport);
      const problems = await cards.evaluateAll((elements) =>
        elements.flatMap((card, index) => {
          const photo = card.querySelector("img")!.closest("a")!.getBoundingClientRect();
          const issues: string[] = [];
          if (card.scrollWidth > card.clientWidth + 1) issues.push(`${index}: card overflows`);
          for (const node of card.querySelectorAll("button, p, span, a:not(:has(img))")) {
            const rect = node.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            if (
              rect.left < photo.right &&
              rect.right > photo.left &&
              rect.top < photo.bottom &&
              rect.bottom > photo.top
            )
              issues.push(
                `${index}: ${node.textContent || node.getAttribute("aria-label")} covers photo`,
              );
            if (node.tagName === "BUTTON" && rect.height < 44)
              issues.push(`${index}: button touch target is too short`);
          }
          return issues;
        }),
      );
      expect(problems).toEqual([]);
      await cards.first().scrollIntoViewIfNeeded();
      await expect
        .poll(
          () =>
            cards
              .first()
              .locator("img")
              .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          { timeout: 15000 },
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            cards
              .nth(1)
              .locator("img")
              .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          { timeout: 15000 },
        )
        .toBe(true);
      await page.screenshot({ path: test.info().outputPath(`cards-${viewport.width}.png`) });
    }
  });
}

test("@regression WISH-001 card wishlist toggles without navigating", async ({ catalog, page }) => {
  await catalog.goto();
  const card = page.getByTestId("product-card").first();
  await card.getByRole("button", { name: "Add to wishlist", exact: true }).click();
  await expect(card.getByRole("button", { name: "Remove from wishlist" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page).toHaveURL(/\/shop/);
  await card.getByRole("button", { name: "Remove from wishlist" }).click();
  await expect(card.getByRole("button", { name: "Add to wishlist", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
