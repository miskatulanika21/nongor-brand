import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { addAvailableProduct } from "./helpers/cart";

test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL for the public customer audit");

const routes = [
  "/",
  "/shop",
  "/shop/kurti",
  "/shop/saree",
  "/shop/three-piece",
  "/shop/girls-dress",
  "/shop/cosmetics",
  "/about",
  "/founder",
  "/size-guide",
  "/custom-size-policy",
  "/contact",
  "/faq",
  "/eid-style-guide",
  "/delivery-policy",
  "/payment-policy",
  "/return-policy",
  "/authenticity-policy",
  "/privacy-policy",
  "/cookie-policy",
  "/terms",
  "/wishlist",
  "/cart",
  "/checkout",
  "/track",
  "/login",
  "/account",
  "/orders",
  "/admin",
];

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 1000 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of routes) {
      test(`@regression @a11y UI ${path}: images, text, layout and accessibility`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(60_000);
        const evidence = [];
        const errors: string[] = [];
        const onError = (error: Error) => errors.push(error.message);
        page.on("pageerror", onError);
        const response = await page.goto(path, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        // Scroll every screen so lazy images are requested before inspecting them.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          window.scrollTo(0, 0);
        });
        await page.locator("img").evaluateAll(async (images) => {
          await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
        });
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          brokenImages: Array.from(document.images)
            .filter((image) => !image.complete || image.naturalWidth === 0)
            .map((image) => ({ alt: image.alt, src: image.currentSrc })),
          replacementCharacters: document.body.innerText.includes("\uFFFD"),
          bengaliText:
            document.body.innerText
              .match(/[\u0980-\u09FF][\u0980-\u09FF\s.,।]*/g)
              ?.filter((text) => text.trim() !== "৳") ?? [],
          headings: Array.from(document.querySelectorAll("h1")).map((h) => h.textContent),
        }));
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const violations = axe.violations
          .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
          .map((v) => ({ rule: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
        const file = `${viewport.name}-${path.replace(/\//g, "_") || "home"}.png`;
        await page.screenshot({ path: testInfo.outputPath(file), fullPage: true });
        evidence.push({
          path,
          finalURL: page.url(),
          status: response?.status(),
          errors,
          ...layout,
          violations,
          screenshot: file,
        });
        page.off("pageerror", onError);
        console.log(
          `${viewport.name} ${path}: ${response?.status()} overflow=${layout.overflow} images=${layout.brokenImages.length} a11y=${violations.length} errors=${errors.length}`,
        );
        expect.soft(response?.status(), path).toBeLessThan(400);
        expect.soft(errors, `${path} JavaScript errors`).toEqual([]);
        expect.soft(layout.overflow, `${path} horizontal overflow`).toBe(false);
        expect.soft(layout.brokenImages, `${path} image loading`).toEqual([]);
        expect.soft(layout.replacementCharacters, `${path} text encoding`).toBe(false);
        expect.soft(violations, `${path} accessibility`).toEqual([]);
        const evidencePath = testInfo.outputPath("page-evidence.json");
        await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
        await testInfo.attach("page-evidence.json", {
          path: evidencePath,
          contentType: "application/json",
        });
      });
    }

    test("@smoke PDP-008 CART-001 product selection, lightbox, wishlist, cart and checkout entry", async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await addAvailableProduct(page);
      const name = await page.getByRole("heading", { level: 1 }).innerText();
      await page.getByRole("button", { name: "Save to wishlist", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Remove from wishlist", exact: true }).first(),
      ).toBeVisible();
      const viewer = page.getByRole("button", { name: /open.*image|enlarge|view.*full/i }).first();
      await viewer.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
      await dialog.getByRole("button", { name: "Reset zoom", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-lightbox.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await page.goto("/wishlist");
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await page.goto("/cart");
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Increase quantity", exact: true }).first().click();
      await page.getByRole("button", { name: "Decrease quantity", exact: true }).first().click();
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-cart.png`),
        fullPage: true,
      });
      await page.getByRole("link", { name: "Checkout", exact: true }).click();
      await expect(page).toHaveURL(/\/checkout/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Checkout", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Full name *", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Place Order (Cash on Delivery)", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-checkout.png`),
        fullPage: true,
      });
    });
  });
}
