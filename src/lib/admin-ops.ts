import { BRAND, formatBDT, paymentConfigured } from "@/lib/brand";
import type { Order } from "@/lib/orders";

// ---------------------------------------------------------------------------
// Phone / WhatsApp helpers
// ---------------------------------------------------------------------------

/** Normalize a BD phone number to the wa.me international format (8801XXXXXXXXX). */
export function toWaNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("0")) return "88" + digits;
  if (digits.startsWith("1")) return "880" + digits;
  return digits;
}

export type WaTemplateKey = "confirmed" | "paymentReminder" | "shipped" | "delivered";

export const WA_TEMPLATES: { key: WaTemplateKey; label: string }[] = [
  { key: "confirmed", label: "Order confirmed" },
  { key: "paymentReminder", label: "Payment reminder" },
  { key: "shipped", label: "Shipped + tracking" },
  { key: "delivered", label: "Delivered / review" },
];

export function buildWaMessage(key: WaTemplateKey, o: Order): string {
  const name = o.customer.split(" ")[0];
  switch (key) {
    case "confirmed":
      return `Hi ${name}! 🛍️ Your Nongorr order ${o.id} is confirmed. Total: ${formatBDT(
        o.total,
      )}. We'll update you when it ships. Thank you for shopping with us 💕`;
    case "paymentReminder": {
      // Never insert a placeholder bKash number into a customer message.
      const payInstruction = paymentConfigured
        ? `Please send bKash to ${BRAND.bkashNumber} and share the TrxID.`
        : `Please reply here and we'll share the current payment details to complete your order.`;
      return `Hi ${name}! 💕 We haven't confirmed payment for your Nongorr order ${o.id} (${formatBDT(
        o.total,
      )}) yet. ${payInstruction} Thank you!`;
    }
    case "shipped":
      return `Hi ${name}! 📦 Your Nongorr order ${o.id} has shipped via ${
        o.courier ?? "courier"
      }${o.trackingId ? ` (Tracking: ${o.trackingId})` : ""}. Expected in 1–3 days. 🚚💕`;
    case "delivered":
      return `Hi ${name}! 🎉 We hope you love your Nongorr order ${o.id}. We'd be so grateful for a quick review 🌸. Thank you for shopping with Nongorr 💕`;
  }
}

/** Build a wa.me link for a customer with a pre-filled message. */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Printable invoice
// ---------------------------------------------------------------------------

export function printInvoice(o: Order) {
  const discount = Math.max(0, o.subtotal + o.shipping - o.total);
  const rows = o.items
    .map(
      (it) => `
        <tr>
          <td>${escapeHtml(it.name)}${it.size ? ` <span class="muted">(${escapeHtml(it.size)})</span>` : ""}</td>
          <td class="center">${it.qty}</td>
          <td class="right">${formatBDT(it.price)}</td>
          <td class="right">${formatBDT(it.price * it.qty)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${escapeHtml(o.id)} · ${BRAND.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #2b1d1d; margin: 0; padding: 40px; background: #fff; }
  .wrap { max-width: 720px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #7a1f2b; padding-bottom: 18px; }
  .brand { font-size: 30px; font-weight: 800; color: #7a1f2b; letter-spacing: .5px; }
  .brand small { display:block; font-size: 12px; font-weight: 500; color:#a8806a; letter-spacing: 1px; }
  .meta { text-align: right; font-size: 13px; color:#6b5b5b; }
  .meta b { color:#2b1d1d; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color:#a8806a; margin: 26px 0 8px; }
  .info { font-size: 14px; line-height: 1.55; }
  table { width:100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
  th { text-align:left; background:#faf4f0; color:#7a1f2b; padding: 10px; font-size: 12px; text-transform: uppercase; letter-spacing:.5px; }
  td { padding: 10px; border-bottom: 1px solid #eee; }
  .center { text-align:center; } .right { text-align:right; } .muted { color:#a8806a; font-size: 12px; }
  .totals { margin-left: auto; width: 280px; margin-top: 14px; font-size: 14px; }
  .totals div { display:flex; justify-content: space-between; padding: 6px 0; }
  .totals .grand { border-top: 2px solid #7a1f2b; margin-top: 6px; padding-top: 10px; font-size: 17px; font-weight: 800; color:#7a1f2b; }
  .pay { margin-top: 26px; background:#faf4f0; border-radius: 10px; padding: 14px 16px; font-size: 13px; }
  .foot { margin-top: 34px; text-align:center; color:#a8806a; font-size: 13px; border-top:1px solid #eee; padding-top: 18px; }
  @media print { body { padding: 0; } .wrap { max-width: none; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div class="brand">${BRAND.name}<small>${escapeHtml(BRAND.tagline.toUpperCase())}</small></div>
      <div class="meta">
        <div><b>Invoice</b></div>
        <div>${escapeHtml(o.id)}</div>
        <div>${escapeHtml(o.date)}</div>
        <div>${escapeHtml(BRAND.phone)}</div>
      </div>
    </div>

    <h2>Billed to</h2>
    <div class="info">
      <b>${escapeHtml(o.customer)}</b><br/>
      ${escapeHtml(o.phone)}<br/>
      ${escapeHtml(o.address)}, ${escapeHtml(o.district)}
    </div>

    <h2>Items</h2>
    <table>
      <thead><tr><th>Item</th><th class="center">Qty</th><th class="right">Price</th><th class="right">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${formatBDT(o.subtotal)}</span></div>
      <div><span>Delivery</span><span>${o.shipping === 0 ? "Free" : formatBDT(o.shipping)}</span></div>
      ${discount > 0 ? `<div><span>Discount</span><span>− ${formatBDT(discount)}</span></div>` : ""}
      <div class="grand"><span>Total</span><span>${formatBDT(o.total)}</span></div>
    </div>

    <div class="pay">
      <b>Payment:</b> ${escapeHtml(o.paymentMethod)} · <b>TrxID:</b> ${escapeHtml(o.trxId || "—")}<br/>
      <b>Sender:</b> ${escapeHtml(o.senderNumber || "—")} · <b>Status:</b> ${escapeHtml(o.paymentStatus)}
    </div>

    <div class="foot">Thank you for shopping with ${BRAND.name} 💕<br/>${escapeHtml(BRAND.email)} · ${escapeHtml(BRAND.address)}</div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

/** Mock parcel label printout for courier handoff. */
export function printParcelLabel(o: Order) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Label ${escapeHtml(o.id)}</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin:0; padding:24px; }
  .label { border: 2px dashed #333; border-radius: 12px; padding: 22px; max-width: 420px; margin: 0 auto; }
  .brand { font-size: 22px; font-weight: 800; color:#7a1f2b; }
  .row { margin-top: 12px; font-size: 14px; }
  .row b { display:block; font-size: 11px; text-transform: uppercase; letter-spacing:.5px; color:#888; }
  .big { font-size: 18px; font-weight: 700; }
  .bar { margin-top: 16px; text-align:center; font-family: monospace; letter-spacing: 6px; font-size: 26px; }
  @media print { .label { border-color:#000; } }
</style></head>
<body>
  <div class="label">
    <div class="brand">${BRAND.name} · Parcel Label</div>
    <div class="row"><b>Ship to</b><span class="big">${escapeHtml(o.customer)}</span></div>
    <div class="row">${escapeHtml(o.phone)}</div>
    <div class="row">${escapeHtml(o.address)}, ${escapeHtml(o.district)}</div>
    <div class="row"><b>Courier</b>${escapeHtml(o.courier ?? "Manual")}</div>
    <div class="row"><b>Order</b>${escapeHtml(o.id)} · ${formatBDT(o.total)} (${escapeHtml(o.paymentStatus)})</div>
    <div class="bar">*${escapeHtml(o.trackingId || o.id)}*</div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;
  const win = window.open("", "_blank", "width=480,height=640");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

function escapeHtml(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// ---------------------------------------------------------------------------
// Date filtering
// ---------------------------------------------------------------------------

export type DateRange = "today" | "week" | "month" | "all";

export const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

/** Mock "now" anchored to the seed data so demo filters return results. */
const NOW = new Date("2026-06-14T12:00:00");

export function inRange(dateStr: string, range: DateRange): boolean {
  if (range === "all") return true;
  const d = new Date(dateStr + "T00:00:00");
  const diff = (NOW.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (range === "today") return diff < 1;
  if (range === "week") return diff < 7;
  if (range === "month") return diff < 31;
  return true;
}
