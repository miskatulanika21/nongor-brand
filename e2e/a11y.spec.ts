/**
 * Stage 7 (P4) — accessibility audit.
 *
 * Runs axe-core (WCAG 2.0/2.1 A + AA rules) against the key storefront routes and
 * fails on any serious/critical violation. Point it at a deployment with
 * E2E_BASE_URL (defaults to the local dev server); in CI/prod use the live URL:
 *   E2E_BASE_URL=https://nongor-brand.vercel.app npx playwright test e2e/a11y.spec.ts
 *
 * Scope: the pages a customer must be able to use. Admin screens are covered by a
 * manual keyboard walkthrough (documented) rather than automated axe here.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES: Array<{ name: string; path: string }> = [
  { name: "home", path: "/" },
  { name: "shop", path: "/shop" },
  { name: "cart", path: "/cart" },
  { name: "checkout", path: "/checkout" },
  { name: "login", path: "/login" },
  { name: "size-guide", path: "/size-guide" },
  { name: "contact", path: "/contact" },
];

for (const route of ROUTES) {
  test(`a11y: ${route.name} has no serious/critical violations`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "networkidle" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    // Human-readable failure output (rule + where).
    if (blocking.length > 0) {
      const summary = blocking
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.help}\n` +
            v.nodes
              .slice(0, 3)
              .map((n) => `      → ${n.target.join(" ")}`)
              .join("\n"),
        )
        .join("\n");
      console.log(`\n${route.name} violations:\n${summary}\n`);
    }

    expect(
      blocking,
      `${blocking.length} serious/critical a11y violation(s) on ${route.name}`,
    ).toEqual([]);
  });
}
