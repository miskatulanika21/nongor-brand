/**
 * Notification outbox sender — Stage 6 P1.
 *
 * Drains public.notification_events (the Stage-5 courier outbox) and emails the
 * customer on each shipment lifecycle event via Resend. Two entry points:
 *   - drainNotificationOutbox()      → claims a batch, sends, settles each row.
 *   - drainNotificationsBestEffort() → fire-and-forget wrapper for webhook
 *                                      handlers (prompt send; never throws).
 * A cron route (/api/cron/notifications) calls drainNotificationOutbox() as a
 * daily catch-up / retry for anything the inline drain missed.
 *
 * Concurrency: api.claim_notification_batch atomically claims rows (FOR UPDATE
 * SKIP LOCKED), so inline and cron drains can run at once without double-sending.
 * Rows are settled with the service-role client (bypasses RLS, deny-all table).
 *
 * The .server.ts suffix keeps this off the client bundle.
 */
import process from "node:process";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  sendEmail,
  renderBrandedEmail,
  isEmailConfigured,
  supportAddress,
  type EmailAccent,
} from "./email.server";
import { safeServerLog } from "./security.server";
import { formatBDT } from "@/lib/brand";
import {
  paymentMethodLabel,
  type PlaceOrderResult,
  type CheckoutCustomer,
  type PaymentMethod,
} from "@/lib/checkout-shared";

interface ClaimedNotification {
  id: number;
  order_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  attempts: number;
  order_no: string;
  customer_name: string | null;
  customer_email: string | null;
}

interface EventCopy {
  subject: (orderNo: string) => string;
  eyebrow: string;
  badge: string;
  accent: EmailAccent;
  heading: string;
  intro: (firstName: string, orderNo: string) => string;
  closing?: string;
}

// Per-event copy. Event types come from the notification_events CHECK constraint.
const EVENT_COPY: Record<string, EventCopy> = {
  shipment_booked: {
    subject: (no) => `Your order ${no} is on its way`,
    eyebrow: "Order update",
    badge: "Dispatched",
    accent: "gold",
    heading: "Your order is on its way",
    intro: (name, no) =>
      `Hi ${name}, good news — order ${no} has been handed to our delivery partner and is being prepared for dispatch.`,
    closing: "We'll let you know as it moves. Thank you for shopping with Nongorr.",
  },
  shipment_picked_up: {
    subject: (no) => `Order ${no} has been picked up`,
    eyebrow: "Order update",
    badge: "Picked up",
    accent: "gold",
    heading: "Picked up by the courier",
    intro: (name, no) =>
      `Hi ${name}, order ${no} has been collected by the courier and is on its way to you.`,
  },
  shipment_in_transit: {
    subject: (no) => `Order ${no} is in transit`,
    eyebrow: "Order update",
    badge: "In transit",
    accent: "gold",
    heading: "On the move",
    intro: (name, no) =>
      `Hi ${name}, order ${no} is now in transit. It won't be long before it reaches you.`,
  },
  shipment_delivered: {
    subject: (no) => `Order ${no} has been delivered`,
    eyebrow: "Delivered",
    badge: "Delivered",
    accent: "success",
    heading: "Delivered — enjoy!",
    intro: (name, no) => `Hi ${name}, order ${no} has been delivered. We hope you love it.`,
    closing:
      "If anything isn't right, just reply to this email — we're happy to help. Thank you for choosing Nongorr.",
  },
  shipment_failed: {
    subject: (no) => `Delivery update for order ${no}`,
    eyebrow: "Action may be needed",
    badge: "Delivery attempt failed",
    accent: "warn",
    heading: "We couldn't complete delivery",
    intro: (name, no) =>
      `Hi ${name}, our courier attempted to deliver order ${no} but couldn't complete it. They'll usually try again, or our team will reach out to arrange redelivery.`,
    closing: "Need to update your address or timing? Reply to this email and we'll sort it out.",
  },
  shipment_returned: {
    subject: (no) => `Order ${no} is being returned`,
    eyebrow: "Order update",
    badge: "Returning to us",
    accent: "warn",
    heading: "Your order is being returned",
    intro: (name, no) =>
      `Hi ${name}, order ${no} is on its way back to us. If this is unexpected, please get in touch — we'd love to make it right.`,
  },
};

function siteUrl(): string {
  return (process.env.VITE_SITE_URL || "https://nongorr.com").replace(/\/$/, "");
}

function firstNameOf(name: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

function providerLabel(p: string): string {
  if (p.toLowerCase() === "steadfast") return "SteadFast";
  if (p.toLowerCase() === "pathao") return "Pathao";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function renderNotificationEmail(
  n: ClaimedNotification,
): { subject: string; html: string; text: string } | null {
  const copy = EVENT_COPY[n.event_type];
  if (!copy) return null;

  const name = firstNameOf(n.customer_name);
  const tracking = typeof n.metadata?.tracking_code === "string" ? n.metadata.tracking_code : null;
  const provider = typeof n.metadata?.provider === "string" ? n.metadata.provider : null;

  const paragraphs = [copy.intro(name, n.order_no)];
  if (copy.closing) paragraphs.push(copy.closing);

  const panel = [{ label: "Order", value: `#${n.order_no}` }];
  if (tracking) panel.push({ label: "Tracking code", value: tracking });
  if (provider) panel.push({ label: "Courier", value: providerLabel(provider) });

  const { html, text } = renderBrandedEmail({
    preheader: copy.subject(n.order_no),
    eyebrow: copy.eyebrow,
    badge: copy.badge,
    accent: copy.accent,
    heading: copy.heading,
    paragraphs,
    panel,
    cta: { label: "Track your order", url: `${siteUrl()}/track` },
  });

  return { subject: copy.subject(n.order_no), html, text };
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Claim and send one batch of pending notifications. Returns per-run counters.
 * A no-op (all zeroes) when email isn't configured, so it's always safe to call.
 */
export async function drainNotificationOutbox(opts?: { limit?: number }): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  if (!isEmailConfigured()) return result;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("claim_notification_batch", { p_limit: opts?.limit ?? 20 });
  if (error) {
    safeServerLog("error", "notification claim failed", {
      code: error.code,
      message: error.message,
    });
    return result;
  }

  const rows = (data ?? []) as ClaimedNotification[];
  result.claimed = rows.length;
  const nowIso = () => new Date().toISOString();

  for (const row of rows) {
    const rendered = row.customer_email ? renderNotificationEmail(row) : null;

    // Nothing sendable — a guest order without an email, or an event type we have
    // no template for. Settle it so it isn't re-claimed forever.
    if (!row.customer_email || !rendered) {
      await admin
        .from("notification_events")
        .update({
          sent_at: nowIso(),
          channel: row.customer_email ? "skipped" : "none",
          last_error: row.customer_email ? "unknown_event_type" : "no_customer_email",
        })
        .eq("id", row.id);
      result.skipped++;
      continue;
    }

    const send = await sendEmail({
      to: row.customer_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: "orders",
      replyTo: supportAddress(),
      idempotencyKey: `notif-${row.id}`,
    });

    if (send.ok) {
      await admin
        .from("notification_events")
        .update({ sent_at: nowIso(), channel: "email", last_error: null })
        .eq("id", row.id);
      result.sent++;
    } else {
      // Release the claim so the cron catch-up retries (until attempts >= 5).
      await admin
        .from("notification_events")
        .update({ claimed_at: null, last_error: send.error.slice(0, 500) })
        .eq("id", row.id);
      safeServerLog("warn", "notification send failed", {
        id: row.id,
        error: send.error.slice(0, 120),
      });
      result.failed++;
    }
  }

  return result;
}

/**
 * Best-effort drain for webhook handlers: sends promptly after an event is
 * enqueued, without ever throwing or delaying the webhook's own error handling.
 */
export async function drainNotificationsBestEffort(): Promise<void> {
  try {
    await drainNotificationOutbox({ limit: 10 });
  } catch (e) {
    safeServerLog("warn", "best-effort notification drain errored", {
      message: e instanceof Error ? e.message : "unknown",
    });
  }
}

/**
 * Order lifecycle email #1 — ORDER RECEIVED. Sent right after an order is placed,
 * best-effort from checkout (skipped on an idempotent replay so a retried checkout
 * can't double-send). It tells the customer we have their order and will confirm it
 * shortly. The matching email #2 (`sendOrderConfirmed`) fires when an admin moves
 * the order to `confirmed`. Never throws — a mail hiccup must never cost a sale.
 */
export async function sendOrderReceived(input: {
  order: PlaceOrderResult;
  customer: CheckoutCustomer;
  method: PaymentMethod;
}): Promise<void> {
  if (!isEmailConfigured()) return;
  const { order, customer, method } = input;
  const to = customer.email?.trim();
  if (!to) return; // guest without an email — nothing to send

  const name = firstNameOf(customer.name);
  const isCod = method === "cod";

  const panel = [
    { label: "Order", value: `#${order.order_no}` },
    { label: "Payment", value: paymentMethodLabel(method) },
    { label: "Subtotal", value: formatBDT(order.subtotal) },
  ];
  if (order.discount > 0) {
    panel.push({
      label: order.coupon ? `Discount (${order.coupon})` : "Discount",
      value: `−${formatBDT(order.discount)}`,
    });
  }
  panel.push({
    label: "Delivery",
    value: order.shipping_fee > 0 ? formatBDT(order.shipping_fee) : "Free",
  });

  const paragraphs = [
    `Hi ${name}, thank you for shopping with Nongorr — we've received your order and our team will confirm it shortly. Here's your summary:`,
    isCod
      ? `Please keep ${formatBDT(order.total)} ready for cash on delivery.`
      : `We'll send a confirmation as soon as it's approved.`,
  ];

  const { html, text } = renderBrandedEmail({
    preheader: `We've received your order ${order.order_no}`,
    eyebrow: "Order received",
    badge: "Awaiting confirmation",
    accent: "gold",
    heading: "We've received your order",
    paragraphs,
    panel,
    total: { label: "Total", value: formatBDT(order.total) },
    cta: {
      label: "Track your order",
      url: `${siteUrl()}/track?o=${encodeURIComponent(order.order_no)}`,
    },
    footnote:
      "You'll get another email the moment we confirm your order — then tracking updates as it ships.",
  });

  const res = await sendEmail({
    to,
    subject: `We've received your order ${order.order_no}`,
    html,
    text,
    from: "orders",
    replyTo: supportAddress(),
    idempotencyKey: `order-received-${order.order_id}`,
  });
  if (!res.ok) {
    safeServerLog("warn", "order received email failed", { error: res.error.slice(0, 120) });
  }
}

/**
 * Order lifecycle email #2 — ORDER CONFIRMED. Sent when an admin moves an order to
 * `confirmed` (via transition / verify-payment / confirm-COD). Fetches the recipient
 * from the order row (the transition result carries no email). Best-effort; the
 * idempotency key dedups if the admin re-confirms. Never throws.
 */
export async function sendOrderConfirmed(orderId: string): Promise<void> {
  if (!isEmailConfigured()) return;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("orders")
    .select("order_no, customer_name, customer_email, total")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return;

  const to = (data.customer_email ?? "").trim();
  if (!to) return;
  const name = firstNameOf(data.customer_name);

  const { html, text } = renderBrandedEmail({
    preheader: `Your order ${data.order_no} is confirmed`,
    eyebrow: "Order confirmed",
    badge: "Confirmed",
    accent: "success",
    heading: "Your order is confirmed!",
    paragraphs: [
      `Great news ${name} — we've confirmed order #${data.order_no} and it's now being prepared for you.`,
      "We'll email you tracking updates as it ships. Thank you for choosing Nongorr.",
    ],
    panel: [
      { label: "Order", value: `#${data.order_no}` },
      { label: "Total", value: formatBDT(data.total) },
    ],
    cta: {
      label: "Track your order",
      url: `${siteUrl()}/track?o=${encodeURIComponent(data.order_no)}`,
    },
    footnote: "You'll get a separate email each time your order's delivery status changes.",
  });

  const res = await sendEmail({
    to,
    subject: `Your order ${data.order_no} is confirmed`,
    html,
    text,
    from: "orders",
    replyTo: supportAddress(),
    idempotencyKey: `order-confirmed-${orderId}`,
  });
  if (!res.ok) {
    safeServerLog("warn", "order confirmed email failed", { error: res.error.slice(0, 120) });
  }
}
