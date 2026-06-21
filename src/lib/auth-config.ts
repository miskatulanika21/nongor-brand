/**
 * Public auth feature flags — isomorphic, safe for the browser.
 *
 * Only PUBLIC configuration belongs here. Provider client secrets live in the
 * Supabase dashboard (Supabase performs the OAuth exchange), never in the app.
 * These flags only decide whether to OFFER a provider button / MFA UI.
 */

function readFlag(value: unknown): boolean {
  return value === "true" || value === "1" || value === true;
}

/** Whether to show the Google sign-in button. */
export const googleOAuthEnabled = readFlag(import.meta.env.VITE_ENABLE_GOOGLE_OAUTH);

/** Whether to show the Facebook sign-in button. */
export const facebookOAuthEnabled = readFlag(import.meta.env.VITE_ENABLE_FACEBOOK_OAUTH);

export type OAuthProvider = "google" | "facebook";

export function isOAuthProviderEnabled(provider: OAuthProvider): boolean {
  return provider === "google" ? googleOAuthEnabled : facebookOAuthEnabled;
}
