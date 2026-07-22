/**
 * Resend transactional email client — server-only.
 *
 * A thin `fetch` wrapper around the Resend REST API (no SDK dependency, mirroring
 * the courier layer's fetch-based adapters). Env is read at REQUEST time, never at
 * module scope. When RESEND_API_KEY is absent, `isEmailConfigured()` is false and
 * sends are skipped rather than throwing — email is a non-critical enhancement, so
 * a missing key must never break the request that triggered it.
 *
 * Also provides `renderBrandedEmail()` — a single branded HTML+text layout shared
 * by every outbound email (order notifications, newsletter double opt-in) so the
 * brand voice and styling stay consistent.
 *
 * The .server.ts suffix keeps this off the client bundle.
 */
import process from "node:process";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "noreply@nongorr.com";
const SEND_TIMEOUT_MS = 10_000;

// ── Config ───────────────────────────────────────────────────────────────────

export interface ResendConfig {
  apiKey: string;
  /** Fallback bare from address, e.g. "noreply@nongorr.com". */
  from: string;
}

/** Returns the Resend config, or null when RESEND_API_KEY is not set. */
export function getResendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  return { apiKey, from };
}

/** Whether transactional email can be sent (RESEND_API_KEY present). */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// ── Sender identities ──────────────────────────────────────────────────────────
//
// The domain nongorr.com is verified in Resend, so we can send from any address on
// it with no per-address setup. Purpose-specific identities keep transactional and
// marketing mail separate (better inbox placement + clearer to the recipient).
// Each is overridable via env; defaults are the conventional local-parts.

export type SenderKey = "orders" | "support" | "news" | "default";

interface Sender {
  name: string;
  address: string;
}

function senderFor(key: SenderKey): Sender {
  switch (key) {
    case "orders":
      return {
        name: "Nongorr Orders",
        address: process.env.RESEND_FROM_ORDERS?.trim() || "orders@nongorr.com",
      };
    case "support":
      return {
        name: "Nongorr Support",
        address: supportAddress(),
      };
    case "news":
      return {
        name: "Nongorr",
        address: process.env.RESEND_FROM_NEWS?.trim() || "hello@nongorr.com",
      };
    default:
      return {
        name: "Nongorr",
        address: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM,
      };
  }
}

/** The support address — used as Reply-To on transactional mail and for help. */
export function supportAddress(): string {
  return process.env.RESEND_FROM_SUPPORT?.trim() || "support@nongorr.com";
}

// ── Send ─────────────────────────────────────────────────────────────────────

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Which sender identity to send as. Defaults to the generic "Nongorr". */
  from?: SenderKey;
  /** Optional Reply-To (e.g. the monitored support inbox). */
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe for marketing mail. */
  headers?: Record<string, string>;
  /**
   * Idempotency key — Resend dedups identical keys for 24h, so a retried drain
   * cannot send the same notification twice.
   */
  idempotencyKey?: string;
}

export type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Send one transactional email through Resend. Never throws — all failures are
 * returned as `{ ok: false, error }` so callers can decide whether to retry.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const cfg = getResendConfig();
  if (!cfg) return { ok: false, error: "email_not_configured" };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

  const sender = senderFor(input.from ?? "default");
  const payload = {
    from: `${sender.name} <${sender.address}>`,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, error: `resend_http_${res.status}: ${detail}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: json.id ?? "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send_failed";
    return { ok: false, error: `resend_exception: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── Branded layout ─────────────────────────────────────────────────────────────

export interface BrandedEmailParts {
  /** Hidden preview text shown by inboxes next to the subject. */
  preheader?: string;
  heading: string;
  /** Body paragraphs (plain text — escaped and wrapped as <p> in HTML). */
  paragraphs: string[];
  /** Optional primary button. `url` must be a trusted, app-built URL. */
  cta?: { label: string; url: string };
  /** Small muted line under the CTA (e.g. an unsubscribe note). */
  footnote?: string;
  /** When set, renders a clickable "Unsubscribe" link in the footer. */
  unsubscribeUrl?: string;
}

/** Escape a value for safe interpolation into HTML text/attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the shared branded email as both HTML and a plain-text fallback.
 * Table-based, inline-styled markup for maximum email-client compatibility;
 * dark ink on warm paper with the brand gold accent.
 */
export function renderBrandedEmail(parts: BrandedEmailParts): { html: string; text: string } {
  const gold = "#b8863b";
  const ink = "#1c1a17";
  const muted = "#6b655c";
  const paper = "#f6f3 ee".replace(" ", ""); // #f6f3ee

  const preheader = parts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
        parts.preheader,
      )}</div>`
    : "";

  const bodyHtml = parts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${ink};">${escapeHtml(
          p,
        )}</p>`,
    )
    .join("");

  const ctaHtml = parts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
         <tr><td style="border-radius:6px;background:${ink};">
           <a href="${escapeHtml(parts.cta.url)}"
              style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;
                     color:#ffffff;text-decoration:none;letter-spacing:.02em;">
             ${escapeHtml(parts.cta.label)}
           </a>
         </td></tr>
       </table>`
    : "";

  const footnoteHtml = parts.footnote
    ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:${muted};">${escapeHtml(
        parts.footnote,
      )}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:${paper};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper};padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #eae4da;border-radius:10px;overflow:hidden;">
      <tr><td style="padding:26px 32px 12px;border-bottom:2px solid ${gold};">
        <span style="font-size:22px;font-weight:700;letter-spacing:.14em;color:${ink};text-transform:uppercase;">Nongorr</span>
        <span style="font-size:22px;color:${gold};margin-left:6px;">নোঙর</span>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${ink};font-weight:700;">${escapeHtml(
          parts.heading,
        )}</h1>
        ${bodyHtml}
        ${ctaHtml}
        ${footnoteHtml}
      </td></tr>
      <tr><td style="padding:22px 32px 28px;border-top:1px solid #eee7dc;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${muted};">
          Nongorr &middot; নোঙর — crafted in Bangladesh.<br>
          You're receiving this because you shopped with us or subscribed to updates.${
            parts.unsubscribeUrl
              ? `<br><a href="${escapeHtml(
                  parts.unsubscribeUrl,
                )}" style="color:${muted};text-decoration:underline;">Unsubscribe</a>`
              : ""
          }
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // Plain-text fallback.
  const textLines = [parts.heading, "", ...parts.paragraphs];
  if (parts.cta) textLines.push("", `${parts.cta.label}: ${parts.cta.url}`);
  if (parts.footnote) textLines.push("", parts.footnote);
  textLines.push("", "— Nongorr · নোঙর, crafted in Bangladesh.");
  const text = textLines.join("\n");

  return { html, text };
}
