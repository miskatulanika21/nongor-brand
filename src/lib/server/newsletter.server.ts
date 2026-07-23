/**
 * Newsletter emails — Stage 6 P2 (double opt-in).
 *
 * Two sends, both from the marketing identity ("Nongorr" <hello@nongorr.com>) with
 * Reply-To the monitored support inbox:
 *   - sendNewsletterConfirmation → the double opt-in "confirm your email" link.
 *   - sendNewsletterWelcome      → after confirmation, with a working unsubscribe.
 *
 * Both are best-effort and never throw: a mail failure must not fail the subscribe
 * request (the row is already persisted; the cron/user can retry). A missing
 * RESEND_API_KEY makes these no-ops.
 *
 * The .server.ts suffix keeps this off the client bundle.
 */
import process from "node:process";
import { sendEmail, renderBrandedEmail, isEmailConfigured, supportAddress } from "./email.server";
import { safeServerLog } from "./security.server";

function siteUrl(): string {
  return (process.env.VITE_SITE_URL || "https://nongorr.com").replace(/\/$/, "");
}

function confirmUrl(token: string): string {
  return `${siteUrl()}/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

function unsubscribeUrl(token: string): string {
  return `${siteUrl()}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Double opt-in — asks the subscriber to confirm the address they signed up with. */
export async function sendNewsletterConfirmation(
  email: string,
  confirmToken: string,
): Promise<void> {
  if (!isEmailConfigured()) return;
  const url = confirmUrl(confirmToken);
  const { html, text } = renderBrandedEmail({
    preheader: "Confirm your subscription to Nongorr updates",
    eyebrow: "Almost there",
    accent: "gold",
    heading: "One quick step — confirm your email",
    paragraphs: [
      "Thanks for signing up for Nongorr updates: new drops, restocks, and members-only offers.",
      "Please confirm your email address to start receiving them. If you didn't sign up, you can safely ignore this email — nothing will be sent.",
    ],
    cta: { label: "Confirm subscription", url },
    footnote:
      "This link confirms the address it was sent to and expires when a newer one is requested.",
  });

  const res = await sendEmail({
    to: email,
    subject: "Confirm your Nongorr subscription",
    html,
    text,
    from: "news",
    replyTo: supportAddress(),
    idempotencyKey: `nl-confirm-${confirmToken}`,
  });
  if (!res.ok) {
    safeServerLog("warn", "newsletter confirmation send failed", {
      error: res.error.slice(0, 120),
    });
  }
}

/** Sent once, right after the subscriber confirms. Carries a working unsubscribe. */
export async function sendNewsletterWelcome(email: string, unsubToken: string): Promise<void> {
  if (!isEmailConfigured()) return;
  const unsub = unsubscribeUrl(unsubToken);
  const { html, text } = renderBrandedEmail({
    preheader: "You're in — welcome to Nongorr",
    eyebrow: "Welcome to the circle",
    accent: "maroon",
    heading: "Welcome to Nongorr",
    paragraphs: [
      "You're subscribed. You'll be first to hear about new collections, restocks, and members-only offers.",
      "In the meantime, explore the latest at nongorr.com.",
    ],
    cta: { label: "Shop the latest", url: siteUrl() },
    unsubscribeUrl: unsub,
  });

  const res = await sendEmail({
    to: email,
    subject: "Welcome to Nongorr 🌿",
    html,
    text,
    from: "news",
    replyTo: supportAddress(),
    headers: {
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: `nl-welcome-${unsubToken}`,
  });
  if (!res.ok) {
    safeServerLog("warn", "newsletter welcome send failed", { error: res.error.slice(0, 120) });
  }
}
