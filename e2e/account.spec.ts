import { test, expect, type Page } from "@playwright/test";

/**
 * Stage 4 closure spec — customer account CRUD + checkout prefill happy path.
 *
 * GATED: needs E2E_BASE_URL pointing at a dev server backed by a SAFE database
 * (a Supabase branch or local stack — NEVER production) plus a dedicated test
 * customer's E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD. Unlike the admin
 * smoke, this file WRITES — but only to the signed-in test customer's own
 * account rows (server-side owner-scoped RPCs), and every row it creates is
 * deleted before the run ends. Without the env vars the file self-skips so
 * `bun run test:e2e` stays green.
 *
 *   E2E_BASE_URL=http://localhost:3000 \
 *   E2E_CUSTOMER_EMAIL=customer@example.com E2E_CUSTOMER_PASSWORD=... \
 *   bun run test:e2e
 *
 * NOTE ON SELECTORS: the account form fields render a <Label> beside (not
 * linked to) their <Input>, so getByLabel can't resolve them; the dialogs are
 * addressed by stable DOM order instead, with the order pinned in a comment at
 * each site.
 */
const BASE = process.env.E2E_BASE_URL;
const EMAIL = process.env.E2E_CUSTOMER_EMAIL;
const PASSWORD = process.env.E2E_CUSTOMER_PASSWORD;

test.skip(!BASE || !EMAIL || !PASSWORD, "set E2E_BASE_URL + customer creds to run");

// One serial story on a SHARED page: sign in once (the login server fn is
// rate-limited to 8/5min per IP — per-test sign-ins would trip it), then
// profile edit → address CRUD → measurement CRUD → checkout prefill (uses the
// address created earlier) → cleanup.
test.describe.configure({ mode: "serial" });

// Unique per run so list assertions can't collide with pre-existing rows.
const RUN = Date.now().toString(36);
const RECIPIENT = `E2E Addr ${RUN}`;
const MEASUREMENT = `E2E Fit ${RUN}`;

// SSR markup arrives interactive-looking before React attaches: values typed
// into controlled inputs get wiped on hydration and button clicks fall through
// to native form behavior. Every navigation therefore waits for network idle
// (hydration finished) before the test touches anything.
async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function signIn(page: Page) {
  // Belt and braces: if a submit still fell through to the native form GET
  // (back to /login?), retry the whole fill+submit on the now-warm page.
  for (let attempt = 0; attempt < 3; attempt++) {
    await gotoHydrated(page, "/login");
    // The Login tab is active by default; its form holds the only visible
    // email + password inputs.
    await page.getByPlaceholder("you@email.com").first().fill(EMAIL!);
    await page.getByPlaceholder("••••••••").fill(PASSWORD!);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    try {
      // Any post-login destination is fine — just not the login page anymore.
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });
      return;
    } catch {
      // not signed in yet — retry
    }
  }
  throw new Error("sign-in never left /login");
}

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await page?.close();
});

test("account overview renders for the signed-in customer", async () => {
  await gotoHydrated(page, "/account");
  // SSR-hydrated header shows the signed-in identity (never the guest CTA).
  await expect(page.getByText(EMAIL!).first()).toBeVisible();
});

test("profile edit round-trips through the server", async () => {
  await gotoHydrated(page, "/account/profile");
  await page.getByRole("button", { name: "Edit" }).click();
  // The phone input is the only inputmode="tel" field on the page.
  const phone = page.locator('input[inputmode="tel"]');
  await phone.fill("01712345678");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  // Server round-trip: a fresh load hydrates the saved value back.
  await page.reload();
  await expect(page.locator('input[inputmode="tel"]')).toHaveValue("01712345678");
});

test("address add → set default → delete", async () => {
  await gotoHydrated(page, "/account/addresses");
  // Empty state renders two add buttons (header + CTA) — either works.
  await page
    .getByRole("button", { name: /add (your first )?address/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  // "Add address" is both the title and the submit button — pin the heading.
  await expect(dialog.getByRole("heading", { name: "Add address" })).toBeVisible();
  // Input order inside the dialog: 0 label · 1 recipient · 2 phone ·
  // 3 district · 4 area; the full address is the lone textarea.
  const inputs = dialog.locator("input");
  await inputs.nth(1).fill(RECIPIENT);
  await inputs.nth(2).fill("01898765432");
  await inputs.nth(3).fill("Dhaka");
  await inputs.nth(4).fill("Dhanmondi");
  await dialog.locator("textarea").fill("House 1, Road 2, Dhanmondi");
  await dialog.getByRole("button", { name: "Add address" }).click();

  // The new card renders with the recipient name.
  const card = page.locator("div.rounded-2xl", { hasText: RECIPIENT });
  await expect(card).toBeVisible();

  // Promote it to default (button absent if it landed as the only/default one).
  const setDefault = card.getByRole("button", { name: "Set default" });
  if (await setDefault.isVisible().catch(() => false)) {
    await setDefault.click();
    await expect(card.getByText("Default")).toBeVisible();
  }
});

test("measurement profile add → delete", async () => {
  await gotoHydrated(page, "/account/measurements");
  await page
    .getByRole("button", { name: /new|add/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/measurement/i).first()).toBeVisible();
  await dialog.getByPlaceholder("My Regular Fit").fill(MEASUREMENT);
  // Every measure is required (order after the name: bust · waist · hip ·
  // shoulder · sleeve · dress length).
  for (let i = 1; i <= 6; i++) await dialog.locator("input").nth(i).fill("34");
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(MEASUREMENT)).toBeVisible();

  // Delete it again (confirm dialog) — leaves the account as we found it.
  const mCard = page.locator("div.rounded-2xl", { hasText: MEASUREMENT });
  await mCard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(MEASUREMENT)).toHaveCount(0);
});

test("checkout prefills from the saved address", async () => {
  // Put something in the bag (size chosen when the product needs one).
  await gotoHydrated(page, "/shop");
  await page.locator('a[href^="/product/"]').first().click();
  // The shop cards carry their own quick-add buttons, so wait until we are
  // actually on the PDP before touching anything.
  await page.waitForURL(/\/product\//);
  await page.waitForLoadState("networkidle");
  const sizeChip = page
    .locator("button:not([disabled])")
    .filter({ hasText: /^(XS|S|M|L|XL|XXL|Free Size)$/ })
    .first();
  if (await sizeChip.isVisible().catch(() => false)) await sizeChip.click();
  await page.getByRole("button", { name: "Add to bag" }).first().click();
  await expect(page.getByText("Added to bag")).toBeVisible();

  await gotoHydrated(page, "/checkout");
  await expect(page.getByText("Your saved addresses")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(RECIPIENT) }).click();

  // One tap filled the delivery form from the server-saved address.
  await expect(page.getByPlaceholder("Your name")).toHaveValue(RECIPIENT);
  await expect(page.getByPlaceholder("01XXXXXXXXX").first()).toHaveValue("01898765432");
});

test("cleanup: the run's address is deleted", async () => {
  await gotoHydrated(page, "/account/addresses");
  const card = page.locator("div.rounded-2xl", { hasText: RECIPIENT });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(RECIPIENT)).toHaveCount(0);
});
