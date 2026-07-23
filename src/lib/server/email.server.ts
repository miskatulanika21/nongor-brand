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

// ── Premium branded layout ─────────────────────────────────────────────────────
//
// One design system, distinct per email type. Every email carries the Nongorr
// anchor logo + wordmark and shares a warm-paper / maroon / gold identity, but each
// purpose differentiates via `eyebrow`, `badge`, `accent`, and structured blocks
// (`panel`, `items`, `total`) so order/shipment/newsletter/auth mail each feel
// bespoke, not templated. Table-based, fully inline-styled for email-client
// compatibility (Gmail, Apple Mail, Outlook).

/** Publicly-served brand mark (stable URL; email clients need an absolute image). */
const LOGO_URL = process.env.EMAIL_LOGO_URL?.trim() || "https://nongorr.com/apple-touch-icon.png";
const SITE_URL_FOR_EMAIL = (process.env.VITE_SITE_URL || "https://nongorr.com").replace(/\/$/, "");
const BRAND_TAGLINE = "Anchored in tradition, styled for you";

// Brand palette (email-safe hex; oklch is not supported by mail clients).
const C = {
  paper: "#faf7f1", // warm page background
  card: "#ffffff",
  ink: "#241f1d", // headings
  body: "#4a433d", // body copy
  muted: "#8a8078", // captions / footer
  hairline: "#ece2d3",
  maroon: "#7a1f2f", // brand primary (the anchor)
  gold: "#b8863b", // brand accent
} as const;

export type EmailAccent = "gold" | "maroon" | "success" | "warn";

function accentOf(a: EmailAccent | undefined): { strong: string; tint: string } {
  switch (a) {
    case "success":
      return { strong: "#2e7d5b", tint: "#e7f2ec" };
    case "warn":
      return { strong: "#b06a1f", tint: "#fbeede" };
    case "gold":
      return { strong: C.gold, tint: "#f7efdf" };
    case "maroon":
    default:
      return { strong: C.maroon, tint: "#f6e8ea" };
  }
}

export interface EmailPanelRow {
  label: string;
  value: string;
}
export interface EmailLineItem {
  name: string;
  meta?: string;
  qty?: number;
  price?: string;
}

export interface BrandedEmailParts {
  /** Hidden preview text shown by inboxes next to the subject. */
  preheader?: string;
  /** Small uppercase label above the heading (e.g. "ORDER CONFIRMED"). */
  eyebrow?: string;
  heading: string;
  /** Body paragraphs (plain text — escaped and wrapped as <p> in HTML). */
  paragraphs: string[];
  /** Accent theme — colors the eyebrow, badge and detail highlights. */
  accent?: EmailAccent;
  /** Optional status pill rendered in the accent color. */
  badge?: string;
  /** Key/value details box (order summary, tracking, etc.). */
  panel?: EmailPanelRow[];
  /** Order line items rendered as a mini invoice. */
  items?: EmailLineItem[];
  /** Emphasized total row under the items. */
  total?: { label: string; value: string };
  /** Primary button. `url` must be a trusted, app-built URL. */
  cta?: { label: string; url: string };
  /** Optional secondary (ghost) button. */
  secondaryCta?: { label: string; url: string };
  /** Small muted line under the CTA. */
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

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

/**
 * Render the premium branded email as both HTML and a plain-text fallback.
 */
export function renderBrandedEmail(parts: BrandedEmailParts): { html: string; text: string } {
  const ac = accentOf(parts.accent);

  const preheader = parts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(
        parts.preheader,
      )}</div>`
    : "";

  const eyebrowHtml = parts.eyebrow
    ? `<div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${ac.strong};margin:0 0 10px;">${escapeHtml(
        parts.eyebrow,
      )}</div>`
    : "";

  const badgeHtml = parts.badge
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td style="background:${ac.tint};border-radius:999px;padding:6px 14px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ac.strong};">${escapeHtml(
        parts.badge,
      )}</td></tr></table>`
    : "";

  const bodyHtml = parts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.65;color:${C.body};">${escapeHtml(
          p,
        )}</p>`,
    )
    .join("");

  const panelHtml =
    parts.panel && parts.panel.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;background:${C.paper};border:1px solid ${C.hairline};border-radius:10px;">
         <tr><td style="padding:16px 18px;">${parts.panel
           .map(
             (r, i) =>
               `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"${i ? ' style="margin-top:10px;"' : ""}><tr>
                  <td style="font-family:${SANS};font-size:13px;color:${C.muted};">${escapeHtml(r.label)}</td>
                  <td align="right" style="font-family:${SANS};font-size:14px;font-weight:600;color:${C.ink};">${escapeHtml(r.value)}</td>
                </tr></table>`,
           )
           .join("")}</td></tr>
       </table>`
      : "";

  const itemsHtml =
    parts.items && parts.items.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
         ${parts.items
           .map(
             (it) =>
               `<tr>
                  <td style="padding:12px 0;border-top:1px solid ${C.hairline};font-family:${SANS};">
                    <span style="font-size:15px;color:${C.ink};font-weight:600;">${escapeHtml(it.name)}</span>${
                      it.qty
                        ? `<span style="font-size:13px;color:${C.muted};"> &times; ${it.qty}</span>`
                        : ""
                    }${it.meta ? `<br><span style="font-size:13px;color:${C.muted};">${escapeHtml(it.meta)}</span>` : ""}
                  </td>
                  ${
                    it.price
                      ? `<td align="right" valign="top" style="padding:12px 0;border-top:1px solid ${C.hairline};font-family:${SANS};font-size:15px;color:${C.ink};white-space:nowrap;">${escapeHtml(it.price)}</td>`
                      : ""
                  }
                </tr>`,
           )
           .join("")}
         ${
           parts.total
             ? `<tr><td style="padding:14px 0 2px;border-top:2px solid ${C.ink};font-family:${SANS};font-size:15px;font-weight:700;color:${C.ink};">${escapeHtml(parts.total.label)}</td>
                <td align="right" style="padding:14px 0 2px;border-top:2px solid ${C.ink};font-family:${SANS};font-size:16px;font-weight:700;color:${C.maroon};white-space:nowrap;">${escapeHtml(parts.total.value)}</td></tr>`
             : ""
         }
       </table>`
      : "";

  const button = (label: string, url: string, primary: boolean) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 8px 6px 0;display:inline-block;vertical-align:middle;">
       <tr><td style="border-radius:8px;background:${primary ? C.maroon : "#ffffff"};${
         primary ? "" : `border:1px solid ${C.hairline};`
       }">
         <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:.02em;text-decoration:none;color:${primary ? "#ffffff" : C.ink};">${escapeHtml(label)}</a>
       </td></tr>
     </table>`;

  const ctaHtml =
    parts.cta || parts.secondaryCta
      ? `<div style="margin:22px 0 4px;">${parts.cta ? button(parts.cta.label, parts.cta.url, true) : ""}${
          parts.secondaryCta ? button(parts.secondaryCta.label, parts.secondaryCta.url, false) : ""
        }</div>`
      : "";

  const footnoteHtml = parts.footnote
    ? `<p style="margin:18px 0 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${C.muted};">${escapeHtml(
        parts.footnote,
      )}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<style>@media (max-width:600px){.px{padding-left:24px!important;padding-right:24px!important;}}</style>
</head>
<body style="margin:0;padding:0;background:${C.paper};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};padding:34px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.hairline};border-radius:16px;overflow:hidden;">
      <tr><td style="height:4px;line-height:4px;font-size:0;background:linear-gradient(90deg,${C.gold},${C.maroon});">&nbsp;</td></tr>
      <tr><td align="center" class="px" style="padding:32px 40px 20px;">
        <img src="${LOGO_URL}" width="58" height="58" alt="Nongorr" style="display:block;border:0;margin:0 auto 12px;">
        <div style="font-family:${SERIF};font-size:22px;font-weight:700;letter-spacing:.30em;text-transform:uppercase;color:${C.ink};padding-left:.30em;">Nongorr</div>
        <div style="font-family:${SERIF};font-size:16px;color:${C.gold};margin-top:2px;">নোঙর</div>
      </td></tr>
      <tr><td class="px" style="padding:0 40px;"><div style="height:1px;background:${C.hairline};font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td class="px" style="padding:30px 40px 8px;">
        ${eyebrowHtml}${badgeHtml}
        <h1 style="margin:0 0 18px;font-family:${SERIF};font-size:25px;line-height:1.28;color:${C.ink};font-weight:600;">${escapeHtml(
          parts.heading,
        )}</h1>
        ${bodyHtml}${panelHtml}${itemsHtml}${ctaHtml}${footnoteHtml}
      </td></tr>
      <tr><td class="px" style="padding:28px 40px 34px;">
        <div style="height:1px;background:${C.hairline};font-size:0;line-height:0;margin-bottom:20px;">&nbsp;</div>
        <div align="center" style="font-family:${SERIF};font-style:italic;font-size:15px;color:${C.gold};margin-bottom:14px;">${escapeHtml(
          BRAND_TAGLINE,
        )}</div>
        <p style="margin:0;text-align:center;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.muted};">
          <strong style="color:${C.body};">Nongorr &middot; নোঙর</strong> — crafted in Bangladesh.<br>
          Questions? Just reply, or write to <a href="mailto:${escapeHtml(supportAddress())}" style="color:${C.gold};text-decoration:none;">${escapeHtml(supportAddress())}</a>.<br>
          <a href="${SITE_URL_FOR_EMAIL}" style="color:${C.muted};text-decoration:none;">nongorr.com</a>${
            parts.unsubscribeUrl
              ? ` &nbsp;&middot;&nbsp; <a href="${escapeHtml(parts.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a>`
              : ""
          }
        </p>
      </td></tr>
    </table>
    <div style="font-family:${SANS};font-size:11px;color:#b3a99c;margin-top:16px;">&copy; ${new Date().getFullYear()} Nongorr. All rights reserved.</div>
  </td></tr>
</table>
</body></html>`;

  // Plain-text fallback.
  const t: string[] = [];
  if (parts.eyebrow) t.push(parts.eyebrow.toUpperCase());
  t.push(parts.heading, "");
  t.push(...parts.paragraphs);
  if (parts.panel?.length) {
    t.push("");
    for (const r of parts.panel) t.push(`${r.label}: ${r.value}`);
  }
  if (parts.items?.length) {
    t.push("");
    for (const it of parts.items)
      t.push(`- ${it.name}${it.qty ? ` x${it.qty}` : ""}${it.price ? `  ${it.price}` : ""}`);
  }
  if (parts.total) t.push(`${parts.total.label}: ${parts.total.value}`);
  if (parts.cta) t.push("", `${parts.cta.label}: ${parts.cta.url}`);
  if (parts.secondaryCta) t.push(`${parts.secondaryCta.label}: ${parts.secondaryCta.url}`);
  if (parts.footnote) t.push("", parts.footnote);
  t.push("", `— Nongorr · নোঙর — ${BRAND_TAGLINE}`, `Questions? ${supportAddress()}`);
  if (parts.unsubscribeUrl) t.push(`Unsubscribe: ${parts.unsubscribeUrl}`);

  return { html, text: t.join("\n") };
}
