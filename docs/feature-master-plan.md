# Nongorr — Feature Master Plan ("World‑Class" Roadmap)

_Created 2026-07-23. A living, prioritized roadmap for turning the launch-ready
storefront into a best-in-class Bangladeshi fashion brand experience. This is a
**vision + sequencing** document, not a stage spec — each accepted item graduates
into its own stage plan under `docs/` before implementation._

---

## 0. Operating principles

These constrain every feature below. If a proposal violates one, it gets reworked.

1. **Mobile-first, always.** The overwhelming majority of BD commerce traffic is a
   mid-range Android phone on a flaky mobile connection. Every feature is designed
   for that device first; desktop is the enhancement.
2. **Free / low-cost first.** This is a bootstrapped startup. Default to the free
   tier of a managed service or an in-repo solution (Postgres, Supabase, Vercel,
   Resend) before anything with a monthly bill. Each item is tagged with its cost.
3. **Trust is the product.** BD online shoppers have been burned by fake products,
   no-shows, and COD scams. Features that build trust (real reviews, order
   tracking, OTP-confirmed COD, easy returns) outrank clever gimmicks.
4. **Performance is a feature.** Hold the LCP budget. New features must not
   regress the storefront's Core Web Vitals; heavy work goes server-side (Vercel
   `bom1`, next to Supabase `ap-south-1`) or lazy-loaded.
5. **Localization is not optional.** Bengali (নোঙর) + English, ৳ currency, local
   address hierarchy, and local payment habits (COD, bKash, Nagad) are first-class,
   not afterthoughts.
6. **Build on what exists.** Reuse the current primitives — CMS-backed pages,
   coupons engine, courier layer (Pathao/SteadFast), Focal Studio imaging,
   `BrandLoader`/`useConfirm`, the audit/RBAC spine, and now **Resend email**.

**Cost tags:** 🟢 free / in-stack · 🟡 free tier w/ limits · 🔴 paid.
**Priority tags:** `P0` revenue-critical · `P1` high-impact · `P2` differentiator.

---

## Phase 1 — Revenue & Trust foundations _(the money layer)_

The features that most directly convert a visitor into a paid, fulfilled order in
the BD context. Highest ROI; do these first.

### 1.1 Local payments — bKash / Nagad / cards `P0` 🔴(txn fee only)

The single biggest conversion lever. Today the flow is COD-centric. Integrate a
local gateway — **SSLCommerz** or **aamarPay** (both aggregate bKash, Nagad,
Rocket, and cards; no monthly fee, per-transaction cut) — behind the existing
checkout. Keep COD as an option, add "Pay now" for lower risk + instant cash flow.
_Builds on: `checkout.server.ts`, coupons/pricing RPCs._

### 1.2 COD confirmation via OTP `P0` 🟡

Fake/abandoned COD orders are the #1 margin killer for BD stores. Before a COD
order is accepted, send an OTP (SMS or WhatsApp) to confirm the phone is real and
the buyer intends to receive. Dramatically cuts return-to-origin losses.
_Note: SMS/WhatsApp is the one place a paid channel is justified — see 4.4._

### 1.3 Order tracking & notifications (the "outbox sender") `P0` 🟢

**Already unblocked — Resend is live.** Drain the existing `notification_events`
outbox and email customers on every shipment lifecycle event
(booked → picked up → in transit → delivered / failed / returned), plus a
self-serve **track-my-order** page fed by courier status. This was deferred
Stage-6 P1; the account, verified domain, and API key are now in place.
_Builds on: `notification_events`, courier webhooks, Resend `RESEND_API_KEY`._
_Design sketch in §A below._

### 1.4 Abandoned-cart & post-purchase email flows `P1` 🟢

Now that email works: a 3-touch abandoned-cart sequence, a welcome series, and a
"rate your purchase" nudge (feeds reviews, §3.1). Highest-ROI marketing that costs
nothing on Resend's free tier (3,000/mo).

### 1.5 Self-service returns / exchanges `P1` 🟢

A guided returns flow (reason, photo, pickup request) that reuses the courier
layer for reverse logistics. Trust + fewer support messages. Admin gets a returns
board mirroring the orders board.

---

## Phase 2 — Discovery & Personalization _(the browse layer)_

Help shoppers find and fall for product. This is where an apparel brand differentiates.

### 2.1 Fast, typo-tolerant search `P1` 🟢→🟡

Start with **Postgres full-text search** (in-stack, free) with trigram fuzzy
matching for typos and Banglish queries. If catalog/traffic outgrows it, graduate
to **Meilisearch** (self-host free, or cloud free tier) for instant-as-you-type.

### 2.2 Recommendations — "you may also like" / "recently viewed" `P1` 🟢

Co-purchase and co-view recommendations computed in Postgres (no ML infra needed
at this scale). Recently-viewed via localStorage + server hydration. Lifts AOV.

### 2.3 Size & fit finder `P1` 🟢

Reduce the #1 apparel return reason. Interactive size recommender using the
existing size-chart data + a couple of body-measurement inputs, with per-product
fit notes ("runs small"). Pairs with returns (1.5) to cut reverse-logistics cost.

### 2.4 Faceted filtering + lookbooks / collections `P1` 🟢

Rich filters (size, color, price, fabric, occasion) on the category pages, plus
CMS-driven **lookbooks** ("Eid edit", "Winter drop") — editorial merchandising
that shops the look. Builds on category landing pages already shipped.

### 2.5 AI stylist / outfit builder `P2` 🟡 (Claude API)

A differentiator: an AI assistant that builds outfits from the catalog ("style me
a Friday-dawat look under ৳5,000"), answers fit/fabric questions, and links
straight to PDPs. Uses the Claude API server-side with the live catalog as context.

### 2.6 Visual search — "shop the look from a photo" `P2` 🔴/🟡

Upload/inspiration-photo → visually similar products. Higher effort; sequence after
2.1–2.4 prove out. Can start with color/category embedding in Postgres (pgvector,
in-stack 🟢) before any paid vision API.

---

## Phase 3 — Retention & Community _(the loyalty layer)_

Turn first orders into repeat customers and advocates.

### 3.1 Reviews with photos + verified-buyer `P1` 🟢

Photo/UGC reviews gated to verified purchasers, with a Q&A section. The single
biggest trust signal for BD apparel. Feeds the post-purchase email (1.4).

### 3.2 Referral program `P1` 🟢

BD commerce is intensely social (Facebook groups, WhatsApp). A "give ৳X, get ৳X"
referral built on the existing coupons engine turns customers into a growth channel
at near-zero cost.

### 3.3 Loyalty points & tiers `P2` 🟢

Points on purchase/review/referral, redeemable at checkout. Extends the coupons/
ledger model already in place. Introduce after referral proves retention intent.

### 3.4 Wishlist + back-in-stock alerts `P1` 🟢

Wishlist exists — add "notify me when back in stock" and price-drop alerts via
Resend. Captures demand you're currently losing on out-of-stock SKUs.

---

## Phase 4 — Social & Content Commerce _(the brand layer)_

Meet BD customers where they already shop and build the brand story.

### 4.1 WhatsApp & Facebook/Instagram commerce `P0`/`P1` 🟡

BD shoppers live in Messenger/WhatsApp. Catalog sync to Facebook/Instagram Shops,
"order on WhatsApp" deep links, and a WhatsApp support entry point. Meet demand
where it is instead of forcing a website-only funnel.

### 4.2 WhatsApp order notifications `P1` 🔴 (per-msg)

Complements email (1.3): shipment updates + COD confirmation over WhatsApp Business
API, the channel BD customers actually read. The justified paid channel.

### 4.3 UGC gallery & editorial `P2` 🟢

Instagram-style customer gallery ("#WornByNongorr"), founder/editorial content via
the CMS, blog for SEO. Deepens brand, feeds discovery and SEO.

### 4.4 Influencer / affiliate program `P2` 🟢

Trackable affiliate links + payout ledger on top of coupons/referral. BD micro-
influencer marketing is cheap and effective.

---

## Phase 5 — Operations & Intelligence _(the scale layer)_

The behind-the-scenes systems that let a small team run a growing brand.

### 5.1 Inventory management + pre-orders / low-stock `P1` 🟢

Real stock tracking, low-stock alerts to admin, backorder/pre-order support, and
"only 2 left" scarcity cues on the PDP.

### 5.2 Multi-courier optimization + COD risk scoring `P2` 🟢

Auto-select the cheapest/fastest courier per destination zone (Pathao vs SteadFast,
both integrated), and score COD orders for fraud risk using address/history signals
to gate OTP (1.2) or require prepayment.

### 5.3 Analytics, funnels & A/B testing `P1` 🟡

**PostHog** (generous free tier) or GA4 for funnels, retention, and event
analytics, plus lightweight A/B testing on PDP/checkout. Decisions from data, not
vibes. Privacy-consented (consent scaffolding already exists).

### 5.4 Admin insights dashboard v2 `P2` 🟢

Extend the existing real-data dashboard with cohort retention, product performance,
returns analytics, and courier SLA tracking.

---

## Phase 6 — Platform excellence _(the polish layer)_

Cross-cutting quality that makes the whole thing feel world-class.

- **PWA** `P1` 🟢 — installable, offline catalog browsing, add-to-home-screen, web
  push for order updates and drops. Huge on BD Android.
- **Full Bengali localization** `P1` 🟢 — bn/en toggle across the storefront, not
  just SEO strings.
- **Accessibility AA** `P2` 🟢 — the axe suite runs in CI already; drive to a clean
  AA pass.
- **Performance budget enforcement** `P1` 🟢 — CI gate on LCP/bundle so features
  can't silently regress speed.
- **Deliverability & sender reputation** `P1` 🟢 — DMARC currently `p=none`; move to
  `quarantine`/`reject` once volume is warm, monitor bounces/complaints in Resend.

---

## Recommended sequencing (first 3 "sprints")

Given the lean budget and that the store is launch-ready, the highest-leverage
order to actually build:

| Sprint                        | Theme                 | Items                                                                                                               |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **1 — Get paid & keep trust** | Money layer           | 1.3 Order tracking + email outbox (unblocked) → 1.4 abandoned-cart/post-purchase → 1.1 local payments (bKash/Nagad) |
| **2 — Reduce leakage**        | Trust + ops           | 1.2 COD OTP → 1.5 self-serve returns → 5.1 inventory/low-stock                                                      |
| **3 — Grow demand**           | Discovery + community | 3.1 photo reviews → 3.2 referral → 2.1 search + 2.2 recommendations                                                 |

Everything else layers on once these compound.

---

## Appendix A — Near-term design: Order-tracking email outbox (item 1.3)

Concrete because it's next and fully unblocked:

- **Trigger:** best-effort drain at the courier-webhook enqueue points (prompt
  send within seconds), **plus** a `/api/cron/notifications` catch-up endpoint
  (Vercel Cron; daily on the Hobby plan is fine as a safety net — inline is the
  primary path). Guarded by `CRON_SECRET`.
- **Claim/concurrency:** a `claim_notification_batch(p_limit)` SECURITY-DEFINER
  RPC using `FOR UPDATE SKIP LOCKED` + `claimed_at`/`attempts`/`last_error`
  columns on `notification_events`, so inline and cron drains never double-send.
- **Sender:** `email.server.ts` (fetch-based Resend client, no SDK dependency —
  mirrors the courier layer) + `notifications.server.ts` (per-event branded
  templates, mark sent/failed via the service-role admin client).
- **From:** `Nongorr <noreply@nongorr.com>` (`RESEND_FROM_EMAIL`, already set in
  `.env` + Vercel prod).
- **Scope note:** current `event_type` enum covers shipment lifecycle only. Adding
  an `order_placed` confirmation email is a small extension (new event type +
  enqueue at checkout) — recommended as a fast-follow.

## Appendix B — Open owner tasks referenced above

- Local payment gateway account (SSLCommerz/aamarPay) — owner signup.
- SMS/WhatsApp provider for OTP + notifications — owner decision (paid channel).
- Mail forwarding `contact@nongorr.com` → main inbox (free Namecheap forwarding) —
  awaiting owner's chosen address(es).
- Prod-account password reset for the 6 exposed test logins (kept for testing) —
  owner action in Supabase.
