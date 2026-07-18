/**
 * Rate-limit COVERAGE audit (Stage 7 / P1).
 *
 * Stage-7 goal: "rate limiting extended to all public mutations." This test is
 * the standing proof + a drift guard. Every `createServerFn` in `src/lib/*.api.ts`
 * must be classified below, and the classification set must exactly match the
 * code — so a NEW server fn shipped without a conscious rate-limit decision
 * fails CI, and a removed/renamed one fails until the manifest is updated.
 *
 * It does not re-implement the limiter; it asserts that every network-reachable
 * server fn has been deliberately placed in one of these buckets:
 *
 *   rate-limited   — applies an explicit per-IP / per-account bucket
 *                    (login/register/checkout/account/contact/newsletter/mfa/
 *                    review/track/claim/evidence/staff-provision + the
 *                    account-security ops). Every customer/guest MUTATION lives
 *                    here or under admin-guarded.
 *   admin-guarded  — goes through guardAdminWrite (RBAC permission + CSRF + MFA
 *                    step-up + an independent rate-limit bucket). All staff
 *                    write RPCs.
 *   rbac-read      — staff READ gated by requirePermission (authenticated +
 *                    authorized, no state change). No bucket by design: the
 *                    caller is a trusted, logged-in staff member.
 *   public-read    — anonymous / cached read (catalog, public settings, active
 *                    banners, published pages, size charts). No state change.
 *   session-scoped — acts ONLY on the caller's own session/identity, CSRF-gated
 *                    when it mutates, no amplification or cross-tenant surface
 *                    (logout, session/area loaders, high-entropy OAuth/email
 *                    token completions).
 *
 * If you add a server fn, add it here with the right classification. If you are
 * tempted to write "rbac-read"/"public-read"/"session-scoped" for something that
 * changes shared state on behalf of an unauthenticated or non-staff caller,
 * it almost certainly needs a rate-limit bucket instead.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Classification =
  | "rate-limited"
  | "admin-guarded"
  | "rbac-read"
  | "public-read"
  | "session-scoped";

const CLASSIFICATION: Record<string, Classification> = {
  // account-security.api.ts
  deleteAccount: "rate-limited",
  signOutEverywhere: "rate-limited",
  getConnectedIdentities: "rate-limited",
  startIdentityLink: "rate-limited",
  unlinkIdentity: "rate-limited",

  // account.api.ts
  getMyAccountFn: "rate-limited",
  saveProfileFn: "rate-limited",
  upsertAddressFn: "rate-limited",
  deleteAddressFn: "rate-limited",
  setDefaultAddressFn: "rate-limited",
  upsertMeasurementFn: "rate-limited",
  deleteMeasurementFn: "rate-limited",
  syncWishlistFn: "rate-limited",
  toggleWishlistFn: "rate-limited",
  importAccountDataFn: "rate-limited",

  // audit.api.ts
  listAuditLogsFn: "rbac-read",

  // auth.api.ts
  loginWithEmail: "rate-limited",
  registerWithEmail: "rate-limited",
  logout: "session-scoped",
  requestPasswordReset: "rate-limited",
  updatePassword: "rate-limited",
  confirmEmail: "session-scoped",
  completeOAuthCallback: "session-scoped",
  confirmAuthToken: "session-scoped",
  startOAuth: "rate-limited",
  loadCustomerArea: "session-scoped",
  loadAdminArea: "session-scoped",
  getSessionSummary: "session-scoped",
  resolveAuthenticatedDestination: "session-scoped",

  // banners.api.ts
  getActiveBanners: "public-read",
  loadBanners: "rbac-read",
  saveBanner: "admin-guarded",
  setBannerActiveFn: "admin-guarded",
  deleteBannerFn: "admin-guarded",
  listMediaForBanners: "rbac-read",

  // catalog-admin.api.ts
  listAdminProducts: "rbac-read",
  listAdminCategories: "rbac-read",
  getAdminProduct: "rbac-read",
  saveProduct: "admin-guarded",
  setProductStatus: "admin-guarded",
  listMediaForProducts: "rbac-read",
  saveProductGallery: "admin-guarded",
  saveCategory: "admin-guarded",
  setCategoryActive: "admin-guarded",
  reorderCategories: "admin-guarded",
  deleteCategory: "admin-guarded",
  listInventory: "rbac-read",
  adjustInventory: "admin-guarded",
  bulkAdjustInventory: "admin-guarded",
  addVariant: "admin-guarded",
  removeVariant: "admin-guarded",

  // catalog.api.ts
  listProductCards: "public-read",
  getCatalogFacets: "public-read",
  getProductDetail: "public-read",
  getProductCardsByCodes: "public-read",

  // checkout.api.ts
  quoteOrderFn: "rate-limited",
  placeOrderFn: "rate-limited",

  // contact.api.ts
  submitContactFn: "rate-limited",
  listContactMessagesFn: "rbac-read",
  setContactMessageStatusFn: "admin-guarded",

  // coupons.api.ts
  loadCoupons: "rbac-read",
  saveCoupon: "admin-guarded",
  setCouponActive: "admin-guarded",
  deleteCoupon: "admin-guarded",

  // courier.api.ts
  listShipmentsFn: "rbac-read",
  listCourierProvidersFn: "rbac-read",
  bookCourierFn: "admin-guarded",
  cancelShipmentFn: "admin-guarded",
  resolveStaleAttemptFn: "admin-guarded",
  pollShipmentStatusFn: "admin-guarded",
  updateReconciliationFn: "admin-guarded",

  // customers.api.ts
  listCustomersFn: "rbac-read",

  // evidence.api.ts
  submitPaymentEvidenceFn: "rate-limited",
  getEvidenceUrlFn: "rbac-read",

  // media.api.ts
  listMedia: "rbac-read",
  requestMediaUpload: "admin-guarded",
  registerMedia: "admin-guarded",
  removeMedia: "admin-guarded",

  // mfa.api.ts
  getMfaState: "session-scoped",
  startMfaEnrollment: "rate-limited",
  verifyMfaEnrollment: "rate-limited",
  challengeMfa: "rate-limited",
  unenrollMfa: "rate-limited",

  // newsletter.api.ts
  subscribeNewsletterFn: "rate-limited",

  // orders.api.ts
  listOrdersFn: "rbac-read",
  adminOrderStatsFn: "rbac-read",
  getOrderDetailFn: "rbac-read",
  transitionOrderFn: "admin-guarded",
  verifyPaymentFn: "admin-guarded",
  rejectPaymentFn: "admin-guarded",
  confirmCodFn: "admin-guarded",
  cancelOrderFn: "admin-guarded",
  returnOrderFn: "admin-guarded",
  listMyOrdersFn: "rate-limited",
  getMyOrderFn: "rate-limited",
  trackOrderFn: "rate-limited",
  claimGuestOrderFn: "rate-limited",

  // pages.api.ts
  // founder.api.ts — owner-only CMS for the /founder page
  getFounderProfile: "public-read",
  loadFounderAdmin: "rbac-read",
  loadFounderRevisions: "rbac-read",
  listMediaForFounder: "rbac-read",
  saveFounderDraftFn: "admin-guarded",
  publishFounderFn: "admin-guarded",
  discardFounderDraftFn: "admin-guarded",
  restoreFounderRevisionFn: "admin-guarded",

  // pages.api.ts
  getSitePage: "public-read",
  loadSitePages: "rbac-read",
  loadSitePageAdmin: "rbac-read",
  saveSitePageDraftFn: "admin-guarded",
  publishSitePageFn: "admin-guarded",
  discardSitePageDraftFn: "admin-guarded",
  loadSitePageRevisions: "rbac-read",
  restoreSitePageRevisionFn: "admin-guarded",

  // reports.api.ts
  loadReports: "rbac-read",
  exportOrdersCsv: "rbac-read",

  // reviews-admin.api.ts
  listReviews: "rbac-read",
  moderateReview: "admin-guarded",
  removeReview: "admin-guarded",

  // reviews.api.ts
  submitReview: "rate-limited",

  // settings.api.ts
  getPublicSettings: "public-read",
  loadAdminSettings: "rbac-read",
  saveSettings: "admin-guarded",

  // sizes.api.ts
  getSizeCharts: "public-read",
  loadSizeCharts: "rbac-read",
  saveSizeChart: "admin-guarded",
  setSizeChartActiveFn: "admin-guarded",
  deleteSizeChartFn: "admin-guarded",

  // staff.api.ts
  listStaff: "rbac-read",
  provisionStaff: "rate-limited",
  updateStaffRole: "rate-limited",
  setStaffActive: "rate-limited",
};

/** Extract every `export const X = createServerFn` name from src/lib/*.api.ts. */
function discoverServerFns(): string[] {
  const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = readdirSync(libDir).filter((f) => f.endsWith(".api.ts"));
  const names: string[] = [];
  const re = /export\s+const\s+(\w+)\s*=\s*createServerFn/g;
  for (const file of files) {
    const src = readFileSync(path.join(libDir, file), "utf8");
    for (const m of src.matchAll(re)) names.push(m[1]);
  }
  return names;
}

describe("rate-limit coverage (Stage 7 P1)", () => {
  const discovered = discoverServerFns();

  it("discovers a plausible number of server fns", () => {
    // Guards against a broken regex silently passing the parity checks below.
    expect(discovered.length).toBeGreaterThan(100);
  });

  it("every server fn is classified (no unclassified mutations can ship)", () => {
    const missing = discovered.filter((n) => !(n in CLASSIFICATION)).sort();
    expect(
      missing,
      `Unclassified server fns — add them to CLASSIFICATION: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has no stale classifications (renamed/removed fns)", () => {
    const set = new Set(discovered);
    const stale = Object.keys(CLASSIFICATION)
      .filter((n) => !set.has(n))
      .sort();
    expect(stale, `Stale entries — remove from CLASSIFICATION: ${stale.join(", ")}`).toEqual([]);
  });

  it("uses only known classifications", () => {
    const allowed = new Set([
      "rate-limited",
      "admin-guarded",
      "rbac-read",
      "public-read",
      "session-scoped",
    ]);
    for (const [name, cls] of Object.entries(CLASSIFICATION)) {
      expect(allowed.has(cls), `${name} has unknown classification ${cls}`).toBe(true);
    }
  });
});
