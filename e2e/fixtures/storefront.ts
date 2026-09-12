import { test as base, expect } from "@playwright/test";
import { CatalogPage } from "../pages/CatalogPage";

export const test = base.extend<{ catalog: CatalogPage }>({
  catalog: async ({ page }, provide) => {
    await provide(new CatalogPage(page));
  },
});
export { expect };
