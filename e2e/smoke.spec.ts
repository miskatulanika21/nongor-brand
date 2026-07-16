import { test, expect } from "@playwright/test";

/**
 * Post-deploy SMOKE suite (Stage 7 / P5).
 *
 * A fast, READ-ONLY health check run against a freshly-deployed URL (a Vercel
 * preview or production) to gate promotion. It exercises the load-bearing
 * surfaces end-to-end — SSR + security headers + the Data API — WITHOUT mutating
 * anything:
 *   - home renders and carries the enforced CSP header
 *   - /api/health is green (app can round-trip the database via PostgREST)
 *   - the catalog reads (facets + product cards from api.catalog_facets)
 *   - the pricing engine answers (api.quote_order is STABLE / no writes — driven
 *     through the real cart UI, so a total proves the whole quote path works)
 *   - the auth entry page renders
 *
 * SAFETY: every step is a GET or the STABLE quote_order RPC. Nothing here writes
 * to the database, so it is safe against production. Do NOT add a write flow
 * (place order, sign in, admin mutation) to this file — those belong in the
 * credential-gated specs run against an isolated branch. See e2e/README.md.
 *
 * Gated on E2E_BASE_URL so the local `bun run test:e2e` stays green when no
 * deployment is wired up; CI sets it to the deployed URL. See
 * .github/workflows/smoke.yml and docs/stage-7-cicd-and-rollback.md.
 */
const BASE = process.env.E2E_BASE_URL;

test.skip(!BASE, "set E2E_BASE_URL to run the post-deploy smoke suite");

// The smoke gates a deploy, so keep individual steps snappy but tolerant of a
// cold serverless start on the first hit.
test.describe("post-deploy smoke", () => {
  test("home renders with the enforced CSP header", async ({ page }) => {
    const res = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(res, "navigation returned a response").toBeTruthy();
    expect(res!.status(), "home responded 2xx").toBeLessThan(400);
    await expect(page).toHaveTitle(/Nongorr/i);

    // Security posture must survive the deploy: the enforced CSP is always
    // present on the HTML document (the strict nonce policy rides Report-Only
    // until CSP_ENFORCE_STRICT=true — see docs/stage-7 CSP notes).
    const csp = res!.headers()["content-security-policy"];
    expect(csp, "Content-Security-Policy header present").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
  });

  test("/api/health is green (DB reachable via PostgREST)", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status(), "health probe returns 200").toBe(200);
    const body = (await res.json()) as { status?: string; db?: boolean };
    expect(body.status, "health status is ok").toBe("ok");
    expect(body.db, "health reports DB reachable").toBe(true);
  });

  test("catalog reads: facets + at least one product card", async ({ page }) => {
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Shop Nongorr/i })).toBeVisible();
    // Category group is rendered from api.catalog_facets() — proves the read RPC
    // reached PostgREST and returned data.
    await expect(page.getByText("Category", { exact: true }).first()).toBeVisible();
    await expect(page.locator('a[href^="/product/"]').first()).toBeVisible();
  });

  test("pricing engine answers: cart shows a computed total", async ({ page }) => {
    // Add the first directly-addable product to the (client-side) cart, then let
    // the cart page call api.quote_order. A rendered ৳ total proves the pricing
    // path — price_lines + compute_shipping + quote_token — is live end-to-end.
    // quote_order is STABLE, so this mutates nothing server-side.
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    const addToBag = page.getByRole("button", { name: /^Add to Bag$/i }).first();
    await expect(addToBag, "a product is available to add").toBeVisible();
    await addToBag.click();

    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    // A Bangladeshi-Taka amount rendered on the cart summary = quote succeeded.
    await expect(page.getByText(/৳\s*[\d,]+/).first()).toBeVisible();
  });

  test("auth entry page renders", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Sign In or Create Account/i);
    // The email field is the stable anchor of the sign-in form.
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });
});
