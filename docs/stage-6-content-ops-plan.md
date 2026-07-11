# Stage 6 — Master Plan: Content & Operational Modules

**Status:** PLANNED (plan created 2026-07-11). Not started. Predecessors:
Stage 5 courier IMPLEMENTED + REMEDIATED (Parts 1–7, `173d434`→`462c42b`,
63 migrations, 543 Vitest, CI-green). Every Stage-5 review finding is resolved;
the single carry-over into Stage 6 is the **notification-outbox sender**
(`notification_events` rows are written, nothing consumes them).

Each sub-pass follows the project convention: **prod-proven migration (if
any) + atomic commit + CI-green**, committed straight to `main`, pushed per
part (multi-PC). Status docs (`CURRENT_STATUS.md`, `IMPLEMENTATION_PLAN.md`,
`WALKTHROUGH.md`) update at stage/pass completion only.

---

## 1. Goal & current state

Stage 6 per `IMPLEMENTATION_PLAN.md`: **Banners, CMS/policies, newsletter
consent/unsubscribe, reports + CSV, size settings (persisted),
notification-outbox sender.** (Contact inbox + owner audit viewer were
delivered early in the Stage-5 remediation; reviews moderation and
`site_settings` landed in Stage 2.)

What exists today (verified against the code, 2026-07-11):

| Area          | Current state                                                                                                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbox        | `public.notification_events` (RPC-only deny-all): `order_id, event_type (6 shipment_* values), channel, sent_at, metadata`; partial index on `sent_at IS NULL`. Written by `mark_shipment_booking_success` + `update_shipment_status`. **No consumer. No status/attempts/error/recipient columns.** |
| Channels      | No provider dependency in `package.json`. `orders.customer_phone` is **NOT NULL**; `orders.customer_email` is **nullable** → SMS reaches every order, email only some.                                                                                                                              |
| Newsletter    | `newsletter_subscribers` (RPC-only) + rate-limited idempotent `subscribe_newsletter`; `unsubscribed_at` column reserved; footer form live. **No unsubscribe flow, no admin view.**                                                                                                                  |
| Banners       | `admin.banners.tsx` = ComingSoon, `hidden: true` in `admin-routes.ts` under `content.manage`. `HeroSection.tsx` is hardcoded. Media library exists (`20260626150000`).                                                                                                                              |
| Policies CMS  | `admin.policies.tsx` is visible in nav (`policies.manage`) but its **Edit button does nothing** (last mock-that-looks-real in the admin). Storefront policy pages are 10+ static routes (delivery/return/custom-size/privacy/terms/cookie/authenticity/payment/faq/size-guide).                     |
| Reports       | `admin.reports.tsx` = ComingSoon, `hidden: true`, `reports.view`. Real data now exists: orders, order_items, payments, shipments (COD + reconciliation fields), coupon ledger. `recharts` already a dependency.                                                                                     |
| Size settings | `admin.size-settings.tsx` = ComingSoon, `hidden: true`, `sizes.manage`. Public size guide + PDP use static chart **images** via `SizeChartViewer`.                                                                                                                                                  |
| Scheduling    | `vercel.json` has no `crons`. Supabase has `pg_cron` + `pg_net` available. Vercel fn pinned `bom1`, Supabase `ap-south-1` — keep any dispatch loop region-local.                                                                                                                                    |

**Architecture posture (unchanged, match existing patterns):** tables RLS
deny-all RPC-only; RPCs `SECURITY DEFINER`, `search_path=''`,
service-role-only EXECUTE; server fns = `createServerFn` → CSRF →
identity/RBAC → rate-limit bucket → `.schema("api").rpc(...)`; isomorphic
`*-shared.ts` zod mirrors of DB CHECKs; snake_case error codes; staff
mutations audited to `audit_logs`; public reads cached via the Stage-2/3
public-read cache layer where hot.

---

## 2. P0 — Decision gate (user decisions; block only P1/P2)

1. **Notification channels + provider (blocks P1).**
   - **Recommended: SMS-first** via a Bangladesh aggregator (Alpha SMS /
     BulkSMSBD / SSL Wireless — pick by price + delivery reports + masking
     approval), because `customer_phone` is the only universal contact.
     **Email second** (Resend — needs sender domain + DNS) for the orders
     that have one and for newsletter infrastructure. **WhatsApp deferred**
     (Meta business verification + template approval = weeks; the adapter
     seam keeps the door open).
   - Regardless of choice, P1 builds a `NotificationChannelAdapter` seam
     (mirror of `CourierAdapter`) so the decision only picks the _first_
     adapter, not the architecture.
2. **Which events notify (blocks P1 scope).** Minimum = the 6 shipment
   events already written. Recommended additions (new writer inserts in
   existing RPCs, one migration): `order_placed`, `payment_verified`,
   `order_cancelled`. Decide now to avoid re-touching order RPCs twice.
3. **Policy CMS body format (P4).** Recommended: **Markdown** stored in DB,
   rendered with the existing prose styling; drafts + revision history.
   Rich-text editor is out of scope.
4. **Size settings shape (P5).** Option A (recommended): structured
   `size_charts` (chart → rows → measurement columns) rendered as tables,
   images kept as optional illustration. Option B (cheaper): keep charts
   image-based, admin just manages images/labels via media library.
5. **Dispatch trigger (P1, technical — default chosen unless overridden):**
   `pg_cron` + `pg_net` POST to a secret-gated app endpoint every minute
   (both sides in Mumbai) **plus** an opportunistic best-effort drain fired
   after any server fn that enqueues. Vercel Cron only as fallback (plan-tier
   limits apply on Hobby).

---

## 3. Sub-passes

### P1 — Notification outbox sender (the carry-over; biggest pass)

**Migration `stage6_notifications`:**

- Extend `notification_events`: `status text NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending','sending','sent','failed','dead','skipped'))`,
  `attempts int NOT NULL DEFAULT 0`, `next_attempt_at timestamptz NOT NULL
DEFAULT now()`, `last_error text`, `recipient_phone text`,
  `recipient_email text`, `dedupe_key text UNIQUE` (e.g.
  `order_id:event_type:consignment` — a courier webhook replay must not
  re-text the customer). Backfill existing rows to `skipped`
  (historical, pre-sender). Widen `event_type` CHECK if decision #2 adds
  order events; add those inserts to `confirm_order` / `verify_payment` /
  `cancel_order` RPCs in the same migration.
- `api.claim_notification_batch(p_limit int)` — service-role;
  `UPDATE … SET status='sending', attempts=attempts+1 WHERE id IN (SELECT …
WHERE status IN ('pending','failed') AND next_attempt_at <= now() ORDER BY
id FOR UPDATE SKIP LOCKED LIMIT p_limit) RETURNING …` with recipient +
  order snapshot joined. Safe under concurrent drains by construction.
- `api.mark_notification_result(p_id, p_ok, p_channel, p_error)` — sets
  `sent/failed`, exponential backoff (`next_attempt_at = now() + (2^attempts)
  - interval '1 minute'`, cap ~1h), `dead`after 8 attempts. A`sending` row
    older than 10 min is reclaimable (crash recovery).
- Kill switch: `notifications_enabled boolean` on `site_settings` (admin
  Settings toggle) — drain no-ops when off.

**App layer:**

- `src/lib/server/notifications/` — `NotificationChannelAdapter` interface
  (`send(event, recipient, template) → {ok, providerId?, error}`); first
  adapter per decision #1; template registry = pure functions
  `(event, orderSnapshot) → {smsText, emailSubject/Html}` with Bangla-friendly
  copy, unit-tested.
- `notifications.api.ts` drain endpoint: secret-gated (timing-safe compare,
  same pattern as courier webhooks), claims batch (≤20), sends via adapter,
  marks results. Idempotent + concurrency-safe, so cron + opportunistic
  drains can overlap freely.
- `pg_cron` + `pg_net` migration scheduling the every-minute POST (secret in
  Vault or via header from a DB setting — mirror how courier webhook secrets
  are handled).

**Admin visibility:** a "Notifications" tab on the courier or audit surface
(reuse list UI): recent events, status, attempts, last_error, manual "retry
now" (RBAC: `courier.manage` or `settings.manage`) — no new nav item needed.

**Tests:** Vitest for templates/adapters (provider HTTP mocked) + backoff
math; `stage6_db.test.sql` §claim/mark (SKIP LOCKED semantics, dedupe
conflict, dead-lettering); live-drive one real send end-to-end before
closure (Stage-5 lesson: live-drive catches call-layer bugs SQL/unit tests
miss).

### P2 — Newsletter consent & unsubscribe (small; rides P1's email rail)

- Migration: `unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid()
UNIQUE` on `newsletter_subscribers`; `api.unsubscribe_newsletter(p_token)`
  (idempotent, sets `unsubscribed_at`); `api.list_newsletter_subscribers`
  (staff read, paginated).
- `/newsletter/unsubscribe?token=…` route — one-click, no login, friendly
  confirmation; rate-limited server fn. Any future email the platform sends
  a subscriber includes the link + `List-Unsubscribe` header.
- Admin: subscribers table (search, consent state, CSV export via P6's CSV
  helper — or a local one if P2 lands first) under `settings.manage` (or a
  new `marketing.view` if RBAC granularity is wanted; recommended: reuse).
- Re-subscribe after unsubscribe = new `consented_at`, clears
  `unsubscribed_at` (already-idempotent RPC extended).

### P3 — Banners (homepage hero/promos go CMS)

- Migration `stage6_banners`: `banners` (id uuid, `title`, `subtitle`,
  `image_path` (media-library asset path), `link_to`, `sort int`,
  `is_active bool`, `starts_at/ends_at timestamptz null`, bounds CHECKs,
  timestamps, `updated_by`). RPC-only deny-all. `api.get_active_banners()`
  (public: active AND now within window, ordered) + staff CRUD RPCs
  (`content.manage`, audited).
- Public read wired into the **existing public-read cache** layer
  (nav-perf architecture) — banners are on the hottest page; short TTL +
  invalidate on admin write.
- `admin.banners.tsx` rebuilt: list with drag-sort, activate toggle,
  schedule window, media-library picker (reuse existing picker component
  from products), live preview. Un-hide in `admin-routes.ts`.
- `HeroSection` consumes published banners (Vercel image CDN like product
  images); **falls back to the current hardcoded hero when zero rows** — no
  empty homepage, no forced content-entry before launch.

### P4 — Policies / CMS pages

- Migration `stage6_pages`: `site_pages` (id, `slug text UNIQUE` seeded from
  the existing policy routes, `title`, `body_md text` CHECK ≤ ~100k,
  `published_at`, `updated_by`, timestamps) + `site_page_revisions`
  (page_id, body_md, saved_by, saved_at — insert-on-publish, keep last ~20).
  `api.get_page(p_slug)` public (published only) + staff CRUD/publish/
  revision-list/restore RPCs (`policies.manage`, audited).
- Seed each page's current hardcoded copy as revision 1 so day-one content
  is exactly today's content.
- Storefront: policy routes render `body_md` through a small trusted-content
  markdown renderer (staff-only authors; still escape raw HTML) with the
  existing prose styling; **static JSX fallback if the row is missing** —
  zero-risk rollout, page by page.
- `admin.policies.tsx`: real editor (textarea + preview tab), save draft /
  publish, revision history with restore. The dead Edit button dies.
- FAQ/about/size-guide stay static unless trivially convertible; scope =
  the 5 policies currently listed on the admin screen (+ cookie/
  authenticity/payment-policy if cheap).

### P5 — Size settings (persisted)

(Shape per decision #4; Option A described.)

- Migration `stage6_size_charts`: `size_charts` (id, `name`, `product_type`,
  `unit CHECK (unit IN ('in','cm'))`, `is_active`) + `size_chart_rows`
  (chart_id, `size_label`, `measurements jsonb`, `sort`) — jsonb keeps
  columns flexible per garment type. Public read RPC + staff CRUD
  (`sizes.manage`, audited).
- `admin.size-settings.tsx` rebuilt: chart list → editable grid (add row/
  column, reorder), preview identical to the storefront rendering. Un-hide.
- Storefront: size-guide page + PDP size section render the structured
  table when a chart exists (image via `SizeChartViewer` kept as optional
  illustration); static fallback otherwise. Optional `size_chart_id` on
  categories or products to target charts (nullable FK; null = generic).

### P6 — Reports + CSV

- **Read-only pass: no new tables.** Aggregate RPCs (service-role, staff
  `reports.view`, all taking `p_from/p_to`):
  `api.report_sales_summary` (revenue/orders/AOV by day, by status),
  `api.report_top_products` (units + revenue via order_items),
  `api.report_coupon_usage` (ledger joins), `api.report_courier_performance`
  (per-provider delivered/failed/returned, avg time-to-deliver),
  `api.report_cod_reconciliation` (collected vs settled vs outstanding —
  the fields Stage 5 added exist for exactly this). Revenue counts only
  paid/derived-real statuses; definitions documented in the report UI.
- `admin.reports.tsx` rebuilt: date-range presets (7/30/90d, custom), stat
  tiles + recharts charts + tables. Un-hide.
- **CSV export**: shared server-side `toCsv` helper (proper quoting,
  UTF-8 BOM for Excel, ≤50k-row cap) streaming from a server fn; export
  buttons per report + orders CSV. Also backfills P2's subscriber export.
- Add `reportsRead` rate bucket (aggregates are heavier queries).

### P7 — Stage closure

- Un-hidden screens sanity pass: `admin-routes.test.ts` updated (hidden
  flags removed), nav shows Banners/Reports/Size Settings for the right
  roles only.
- Live-drive verification on prod-like: one real notification send, banner
  publish → homepage, policy edit → storefront, size chart → PDP, each
  report against known seed data, newsletter unsubscribe round-trip.
- Visual pass on the three new admin screens (visual-audit list is still
  open for the rest of admin).
- Status docs updated once, at closure (doc cadence rule).

---

## 4. Sequencing & effort

| Pass | Depends on      | Size | Notes                                        |
| ---- | --------------- | ---- | -------------------------------------------- |
| P0   | user            | —    | Only #1/#2 block anything; answer async      |
| P1   | P0 #1/#2        | L    | Schema + sender + adapter + cron + admin tab |
| P2   | P1 (email rail) | S    | Can land before P1 if email adapter deferred |
| P3   | —               | M    | Independent; good parallel-PC candidate      |
| P4   | —               | M    | Independent                                  |
| P5   | P0 #4           | M    | Independent                                  |
| P6   | —               | M    | Independent; CSV helper reused by P2         |
| P7   | all             | S    | Closure + docs                               |

Recommended order: **P0 → P3 → P4 → P6 → P1 → P2 → P5 → P7** if channel
decisions lag (content passes need no external accounts), or **P0 → P1 → P2
→ P3 → P4 → P6 → P5 → P7** if the SMS/email provider is settled up front.

---

## 5. Explicitly out of scope (Stage 7 or later)

Marketing campaign sends (newsletter _blasts_ — Stage 6 only manages
consent), WhatsApp adapter (seam ready), rich-text editor, per-customer
notification preferences UI, server-side cart, backups/CI-CD/perf-a11y
hardening (Stage 7), credential rotation (go-live task).

## 6. Risks & guards

- **Double-sends** — dedupe_key UNIQUE + SKIP LOCKED claim + idempotent
  mark; webhook replays already dedupe upstream but the outbox must not
  trust that.
- **Provider flakiness** — backoff + dead-letter + admin retry; kill
  switch in Settings; sender failures never touch order state.
- **Content vandalism blast radius** — all CMS writes audited with
  before/after in metadata; revisions restorable; RBAC per existing
  permission map.
- **Empty-content launch states** — every storefront consumer (hero,
  policies, size charts) keeps a static fallback; publishing is opt-in per
  item.
- **PII** — recipient phone/email snapshot lives in an RPC-only table;
  drain endpoint is secret-gated + timing-safe; no PII in logs.
