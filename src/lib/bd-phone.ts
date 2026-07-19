/**
 * Bangladesh mobile-number normalization for account forms (addresses/profile).
 *
 * Robust variant: strips ALL non-digits, maps the 880 country code and a bare
 * 10-digit 1XXXXXXXXX to the local 01XXXXXXXXX form. (checkout/auth use the
 * stricter validation.ts `normalizeBDPhone` + `bdPhoneSchema` for their own
 * flow; this one is intentionally lenient about messy pasted input.)
 * Pure — no imports, browser-safe.
 *
 * This module is the single source of truth for the BD-mobile pattern. Every
 * other module (validation.ts, account-shared, checkout-shared, contact-shared,
 * newsletter-shared) imports `BD_PHONE_REGEX` from here rather than re-declaring
 * the literal, so the accepted shape can never drift between forms.
 */

/** Canonical Bangladesh mobile pattern: `01` + operator digit `3–9` + 8 digits. */
export const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;

export function normalizeBDPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("880")) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.length === 10 && digits.startsWith("1")) {
    digits = `0${digits}`;
  }
  return digits;
}

export function isValidBDPhone(input: string): boolean {
  return BD_PHONE_REGEX.test(normalizeBDPhone(input));
}
