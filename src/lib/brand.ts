// ============================================================================
// Brand & site configuration — single source of truth for naming, contact,
// payment and site URL. FRONTEND-ONLY. No secrets are stored here; real
// payment numbers and the registered legal name must be supplied later.
//
// Naming hierarchy (do NOT redesign the logo):
//   brandName  → "Nongorr"                         (the brand mark / wordmark)
//   siteName   → "Nongorr Studio"                  (the business / platform)
//   descriptor → "Women's Fashion & Beauty Boutique"
//   legalName  → null  (UNCONFIGURED — never invent a registered legal name)
// ============================================================================

export const BRAND = {
  // Naming hierarchy
  brandName: "Nongorr",
  siteName: "Nongorr Studio",
  descriptor: "Women's Fashion & Beauty Boutique",
  /** Registered legal business name — unconfigured until supplied. Never invent. */
  legalName: null as string | null,

  // Back-compat alias (existing code reads BRAND.name)
  name: "Nongorr",
  tagline: "Anchored in tradition, styled for you",

  // Contact — support@ is the monitored, two-way inbox (Cloudflare Email Routing
  // forwards it to the team; hello@ is send-only for the newsletter).
  phone: "+880 1616-510037",
  whatsapp: "8801616510037",
  email: "support@nongorr.com",
  bkashNumber: "01872-647323",

  // Non-physical location (online boutique — no fabricated street address)
  address: "Online boutique · Bangladesh",

  // Social
  instagram: "https://www.instagram.com/nongorr_/",
  facebook: "https://www.facebook.com/nongorclothingbd/",

  // Site / locale
  siteUrl: "https://nongorr.com",
  currency: "BDT",
  locale: "en-BD",
};

// ---------------------------------------------------------------------------
// Configuration status — granular placeholder detection.
// A value is considered a placeholder when it is empty or its digits contain a
// long zero run (e.g. the seeded "01700-000000" / "8801700000000").
// ---------------------------------------------------------------------------

function isPlaceholderNumber(value: string | null | undefined): boolean {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return true;
  if (/0{6,}/.test(digits)) return true; // zero-filled seed values
  return false;
}

function isPlaceholderUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  // Seeded/example domains are acceptable but flagged as "not a final domain".
  return /example\.(com|org)/.test(value);
}

export const contactConfigured = !isPlaceholderNumber(BRAND.phone);
export const whatsappConfigured = !isPlaceholderNumber(BRAND.whatsapp);
export const paymentConfigured = !isPlaceholderNumber(BRAND.bkashNumber);
export const siteUrlConfigured = !isPlaceholderUrl(BRAND.siteUrl);

/**
 * Safe holding message shown wherever a real bKash number would otherwise be
 * displayed or copied. Keeps the UI honest while payment is unconfigured.
 */
export const PAYMENT_NOTICE =
  "Online payment is being set up. Please contact us on WhatsApp to confirm payment details before sending any money.";

/**
 * The bKash number to actually present to a customer, or `null` when the
 * configured number is still a placeholder (never expose the fake number).
 */
export function activeBkashNumber(): string | null {
  return paymentConfigured ? BRAND.bkashNumber : null;
}

export function formatBDT(amount: number): string {
  return "৳" + amount.toLocaleString("en-BD");
}

export function discountPct(price: number, sale?: number | null): number | null {
  if (!sale || sale >= price) return null;
  return Math.round(((price - sale) / price) * 100);
}
