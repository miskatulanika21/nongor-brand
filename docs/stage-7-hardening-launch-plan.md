# Stage 7 — Master Plan: Hardening & Launch

**Status:** IN PROGRESS (plan 2026-07-12). **P0 decision gate RESOLVED
2026-07-12** (§2). Next: **P1 — security hardening & closure**.

**Predecessors:** Stages 1–6 closed. Stage 6 content scope shipped (banners /
policies CMS / size charts / reports+CSV); **Stage 6 P1 (notification-outbox
sender) + P2 (newsletter consent) are owner-deferred** until the owner connects
their own domain and picks a provider (email DNS: SPF/DKIM). That deferral
**intersects Stage 7**: the go-live domain cut-over (P7 below) is exactly the
event that unblocks Stage-6 P1/P2, so they resume as the planned Stage-6
addendum during the launch window — this plan schedules the hand-off but does
not re-own that work.

Each sub-pass follows the project convention: \*\*prod-proven migration (if any)

- atomic commit + CI-green\*\*, committed straight to `main`, pushed per part
  (multi-PC). Status docs (`CURRENT_STATUS.md`, `IMPLEMENTATION_PLAN.md`,
  `WALKTHROUGH.md`) update at stage/pass completion only (doc-cadence rule).

Stage 7 is the first stage whose deliverable is **operational confidence**, not
features. The bar is: a stranger could take this to production, and if it broke
at 3 a.m. they could see it, diagnose it, and restore it. Nothing here changes
the storefront's behavior for a happy-path user; everything here changes what
happens on the unhappy paths (attack, load, provider outage, data loss, deploy
gone wrong) and what we can prove about them.

---

## 1. Goal & current state

Stage 7 per `IMPLEMENTATION_PLAN.md`: **Security review, rate limiting extended
to all public mutations, concurrency tests (oversell / coupon race / duplicate
order), error monitoring, CI/CD deploy, backup/restore docs, perf (LCP < 2.5s
mobile) and a11y audits, CSP tightening, legal review.**

What exists today (verified against the code, 2026-07-12):

| Area               | Current state                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security headers   | `headers.server.ts` sets HSTS (prod), `X-Frame-Options: DENY`, `Referrer-Policy`, and a CSP — **but `script-src` and `style-src` both carry `'unsafe-inline'`**. That is the single biggest remaining XSS blast-radius gap. No nonce/hash strategy yet.                                    |
| Rate limiting      | `rate-limit.server.ts` has ~22 named buckets (auth, catalog, quote/place, payment, account, wishlist, contact, newsletter, courier). Coverage is good but **never audited pass-by-pass against the full server-fn inventory** — Stage 7 must prove every public/state-changing fn has one. |
| Concurrency tests  | `concurrency.test.sh` (two-connection advisory-lock race) runs in `migrations-local`. Oversell / coupon-exhaustion / duplicate-idempotency races are asserted **single-session** in the `*_db.test.sql` suites, not under true parallel connections. Gap = multi-session load proof.       |
| Error monitoring   | **Only `@vercel/analytics`** (Core Web Vitals + RUM) in `__root.tsx`. No exception tracking, no server-side error aggregation, no alerting. A 500 in a server fn is invisible unless someone reads Vercel logs by hand.                                                                    |
| CI                 | `.github/workflows/ci.yml` = 3 jobs (`quality`, `migrations-local`, `supabase-lint`) + the Supabase Preview GitHub-app check = **4 checks green**. **No deploy job, no post-deploy smoke, no promotion/rollback workflow** — deploys are Vercel-auto on push to `main`.                    |
| Backup / DR        | **No backup or restore runbook exists.** Supabase provides PITR (plan-dependent) but there is no documented restore drill, no migration-rollback policy, no data-export procedure. This is the highest-severity documentation gap for launch.                                              |
| Performance        | Vercel fn pinned `bom1` == Supabase `ap-south-1` (Mumbai); 3-layer nav-perf cache; AVIF/WebP image CDN. **No captured Lighthouse/CWV baseline, no LCP<2.5s-mobile proof, no bundle-size budget.**                                                                                          |
| Accessibility      | Never audited. shadcn/Radix primitives give a decent floor (focus management, ARIA on dialogs), but no keyboard-trap / contrast / screen-reader / form-label pass has been run.                                                                                                            |
| Auth go-live gates | `auth_leaked_password_protection` still **off** (dashboard toggle). Credential rotation still deferred (go-live task). Google OAuth working (secret rotation folds into go-live).                                                                                                          |
| RBAC / audit items | **F-14** (existing-customer → staff promotion) still open. **F-18** (deployment target) is effectively resolved — the app is on Vercel prod (`nongor-brand.vercel.app`); Stage 7 records the decision and closes it.                                                                       |
| Storefront polish  | Visual-audit list still open (`[[visual-audit-2026-07-02]]`): placeholder product photography, badge clutter, star-rounding (5★ vs 4.7), ৳ glyph render, "Unavailable" social buttons, PDP video placeholder.                                                                              |
| Legal              | Policy pages exist (now CMS-backed) but **no legal review** of return/refund/privacy/terms copy against Bangladesh e-commerce norms + the actual COD/courier flow.                                                                                                                         |
| Secrets            | Webhook secrets + courier keys + service-role key live in Vercel env. No documented rotation cadence, no secrets inventory.                                                                                                                                                                |

**Architecture posture (unchanged):** tables RLS deny-all RPC-only; RPCs
`SECURITY DEFINER`, `search_path=''`, service-role-only EXECUTE; server fns =
`createServerFn` → CSRF → identity/RBAC → rate-limit bucket →
`.schema("api").rpc(...)`; snake_case error codes; staff mutations audited.
Stage 7 hardens the perimeter around this posture; it does not rearchitect it.

---

## 2. P0 — Decision gate (owner decisions)

**RESOLVED 2026-07-12.** Owner answers recorded below; the biggest consequence is
that **the owner-deferred Stage-6 P1/P2 (notification sender + newsletter
consent) is now REACTIVATED and in launch scope** — see the note after the list.

1. **Error-monitoring vendor (blocks P3): → SENTRY.** P3 wires Sentry client +
   server SDK behind an env flag, with source-map upload in the build and its
   host added to the P1 CSP `connect-src` allowlist. Free tier for launch.
2. **Backup / DR tier (informs P6): → FREE TIER (no PITR).** So P6's **primary**
   backup is a scheduled logical `pg_dump` (roles + `api`/`private`/`public`
   data + a Storage-bucket manifest) to off-Supabase object storage, retention
   documented, plus the mandatory **restore drill** with recorded RTO/RPO. PITR
   is not available on this plan; note the upgrade path but don't depend on it.
   _(Recommend revisiting Pro before real customer-order volume — daily logical
   backups mean an RPO measured in hours.)_
3. **Legal copy (blocks P7 legal sub-item): → LAUNCH-BLOCKING.** Owner supplies /
   approves final return/refund/privacy/terms copy; we wire it through the
   P4-CMS `site_pages` so future legal edits never need a deploy. **Action:
   owner to provide the copy** (the one owner-authored input this stage needs).
4. **Launch domain (gates P7; unblocks Stage-6 P1/P2): → HAVE ONE READY.** The
   custom domain + DNS exists, so P7 does the **full cut-over** (TLS, HSTS
   preload, OAuth redirect allowlist, cookie domain, canonical/sitemap) and
   **the SPF/DKIM prerequisite for email is satisfied** — the notification /
   newsletter rail is unblocked. Owner to confirm the exact domain string when
   we reach the cut-over.
5. **Go-live blocking bar (informs P8 exit): → ALL FOUR BLOCKING.** Real product
   photography, legal-copy review, the notification sender, **and** the
   visual-audit polish are all required before go-live (none are fast-follow).
   This raises the Stage-7 bar and pulls the deferred notification work in.

**Consequence — Stage-6 P1/P2 reactivated (new launch-blocking scope).** With the
domain ready (#4) and the sender named launch-blocking (#5), the notification
outbox sender + newsletter consent are no longer deferred. They execute per
`docs/stage-6-content-ops-plan.md` §P1/§P2 **as part of Stage 7's launch scope**,
scheduled as **pass P3.5** (after P3 observability gives us the drain/dead-letter
visibility, before/parallel to P5 so the smoke test can cover a real send). One
**remaining owner sub-decision** surfaces when P3.5 starts (Stage-6 P0 #1/#2):
the **SMS provider** (BD aggregator — Alpha SMS / BulkSMSBD / SSL Wireless, since
`customer_phone` is the only universal contact) and confirming **Resend** for
email (now viable — the domain's DNS can carry SPF/DKIM). Ask at pass start, not
now.

---

## 3. Sub-passes

Passes are ordered so that **each makes the next safer to run**: security and
tests first (so later changes can't silently regress), observability next (so we
can see the perf/deploy work land), then perf/a11y, then release engineering and
DR, then content + the launch cut-over.

### P1 — Security hardening & closure

The perimeter pass. Everything that makes an attacker's life harder or closes a
known audit finding.

- **CSP tightening (headline item).** Remove `'unsafe-inline'` from `script-src`.
  TanStack Start SSR + the Vercel Analytics beacon are the inline-script sources;
  move to a **per-request nonce** threaded through the document head (and
  `style-src` where feasible; keep `'unsafe-inline'` on styles only if a
  nonce-on-styles migration proves too invasive, and document why). Add
  `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (belt to the
  `X-Frame-Options` suspenders), and a tight `connect-src` allowlist (Supabase
  project URL + Vercel + the analytics host — no wildcards). Verify with a real
  browser: no CSP violations in console on storefront, checkout, admin.
- **Rate-limit coverage audit.** Enumerate **every** `createServerFn` in the app;
  assert each state-changing or unauthenticated-readable one is behind a bucket
  with a sane limit. Produce a coverage table (fn → bucket → limit) checked in as
  a test (`rate-limit-coverage.test.ts`) that fails if a new server fn ships
  without a bucket. Add any missing buckets (candidates to check: media upload
  intent, gallery save, settings save, all Stage-6 CMS writes, report reads).
- **F-14 — customer→staff promotion.** Today `provision_staff` assumes a fresh
  invite. Design + implement promoting an existing `auth.users` customer to
  staff without orphaning their customer data or double-provisioning: an
  `api.promote_customer_to_staff(user_id, role, actor)` RPC (owner-only, MFA
  step-up, audited `staff.promoted`, idempotent, preserves `customer_profiles`),
  plus the admin-customers UI action. DB test + live-drive.
- **Auth go-live toggles.** Enable `auth_leaked_password_protection` (dashboard);
  add a documented step. Draft the **credential-rotation runbook** (service-role
  key, DB password, courier API keys, webhook secrets, OAuth secret) — the
  _procedure_ now, the _execution_ at P7 cut-over.
- **Secrets inventory.** One doc listing every secret, where it lives (Vercel env
  / Supabase Vault / DB setting), its rotation trigger, and its blast radius.
- **Full security-review pass.** Run the `/security-review` skill over the whole
  surface (not just a diff) — auth flows, RBAC guards, RPC grant posture,
  webhook secret compares, SSRF surface in `pg_net` dispatch (when P1/P2
  notifications land), and IDOR on capability tokens (guest order, unsubscribe).
  Triage findings; fix real ones; document accepted risks.
- **Advisors final sweep.** `mcp.get_advisors` security + performance; confirm
  only the known-intentional INFO/WARN items remain (RPC-only deny-all tables,
  intentional public `SECURITY DEFINER` reads), each with a one-line written
  justification so a future auditor doesn't re-flag them.

**Exit:** CSP has no `'unsafe-inline'` in `script-src` and passes clean in-browser;
every server fn is rate-limited (enforced by test); F-14 shipped; leaked-password
on; security-review findings resolved or accepted-in-writing; advisors clean.

### P2 — Concurrency & correctness test suite

Prove the money-path invariants hold under **true parallel connections**, not
just single-session SQL. This is the pass that lets us sleep during a flash sale.

- Extend the `concurrency.test.sh` harness (already two-connection) into a small
  suite (`concurrency/` dir) covering the three named races from the stage
  brief, each with N concurrent real connections racing one scarce resource:
  - **Oversell:** last-unit stock, M parallel `place_order` calls → exactly one
    succeeds, the rest get `out_of_stock`; final stock never negative;
    reservations reconcile.
  - **Coupon race:** a coupon with `usage_limit=1` (and a separate
    `per_user_limit` case), M parallel redemptions → exactly the cap consumed,
    `usage_count` exact, no over-grant (the `SELECT … FOR UPDATE` on the coupon
    row is the thing under test).
  - **Duplicate order / idempotency:** same `idempotency_key` fired M times in
    parallel → one order created, all callers get the _same_ order back, no
    `idempotency_conflict` for identical payloads, and a _different_ payload on
    the same key → `idempotency_conflict`.
- **Reservation expiry under load:** overlapping `expire_reservations` sweeps +
  concurrent places → no double-release, no lost hold, lazy-availability stays
  correct (the sweep is best-effort by design; prove the lazy count is the real
  guarantee).
- Wire the suite into CI's `migrations-local` job (it already has a live local
  stack). Keep it fast (seconds) and deterministic (no sleeps — use advisory
  barriers / `pg_sleep`-free synchronization).
- **Load smoke (optional, documented not gated):** a k6/autocannon script hitting
  `quote_order` + catalog read at a modest concurrency to capture a throughput
  baseline and confirm the connection pool + `bom1↔ap-south-1` latency hold up.

**Exit:** the three races proven under parallel connections in CI; reservation
sweep proven race-safe; a documented throughput baseline exists.

### P3 — Observability & error monitoring

Make failures visible. Today a server-fn 500 is invisible.

- **Exception tracking** (vendor per P0 #1). Client SDK in `__root.tsx` (behind
  env flag, respects the CSP — add its `connect-src`/`report-uri` host to P1's
  allowlist) + server SDK wrapping the server-fn boundary so unhandled throws,
  RPC error codes, and webhook failures are captured with release + user-context
  (no PII beyond a hashed id). Source-map upload in the build.
- **Structured server logging.** A tiny logger with request-id correlation
  (reuse Vercel's `x-vercel-id`), consistent shape (`{level, event, code,
duration_ms}`), so courier/webhook/notification drains and RPC errors are
  greppable. No PII, no secrets — a redaction guard.
- **Health & readiness endpoint.** `GET /api/health` (or `/healthz`): checks DB
  reachability (a cheap `select 1` via the anon read path) + returns build sha +
  region. Used by uptime monitoring and post-deploy smoke (P5).
- **Uptime + alerting.** External uptime monitor on `/healthz` and the homepage;
  alert routing (email/Slack per owner) for: site down, error-rate spike,
  notification dead-letter growth (once P1/P2 sender lands), webhook failure
  spike. Documented thresholds.
- **Admin operational surface (light).** Surface the outbox dead-letter count +
  webhook-failure count on the admin dashboard (reuses Stage-6 report plumbing)
  so operators see trouble without a dashboard login elsewhere.

**Exit:** an unhandled server error shows up in the tracker within seconds with a
stack + release; `/healthz` is green; an uptime alert fires on a forced outage in
a drill.

### P3.5 — Notification sender + newsletter consent (reactivated from Stage 6)

Pulled into launch scope by the P0 decisions (domain ready + sender named
launch-blocking). **Built per `docs/stage-6-content-ops-plan.md` §P1/§P2** — that
plan is the authoritative spec; this pass just schedules and executes it here.
Placed after P3 so the drain has exception-tracking + dead-letter visibility from
day one, and before/parallel to P5 so the post-deploy smoke can cover a real
send. Summary of what §P1/§P2 build:

- **Owner sub-decision at pass start** (Stage-6 P0 #1/#2): SMS provider (BD
  aggregator) + confirm Resend for email (domain DNS now carries SPF/DKIM) +
  which events notify beyond the 6 shipment events already written.
- Extend `notification_events` (status / attempts / backoff / `dedupe_key` /
  recipient snapshot); `claim_notification_batch` (FOR UPDATE SKIP LOCKED) +
  `mark_notification_result` (exponential backoff + dead-letter); Settings kill
  switch; backfill existing rows to `skipped`.
- `NotificationChannelAdapter` seam (mirror of `CourierAdapter`) + first adapter;
  pure template registry (Bangla-friendly), unit-tested; secret-gated drain
  endpoint driven by `pg_cron` + `pg_net` every minute (both sides Mumbai) +
  opportunistic post-enqueue drains; admin visibility tab (status / attempts /
  last_error / manual retry) — the dead-letter count from P3 already surfaces it.
- **P2 newsletter consent:** `unsubscribe_token` + one-click
  `/newsletter/unsubscribe` + `List-Unsubscribe` header on every send; admin
  subscriber list + CSV (reuses the Stage-6 `toCsv` helper).
- **Live-drive a real end-to-end send before closing** (the recurring lesson).

**Exit:** one real SMS/email sent end-to-end through the outbox; retries + dead-
letter + kill switch proven; unsubscribe round-trips; `stage6_db.test.sql`
§claim/mark green. This closes the Stage-6 addendum.

### P4 — Performance & accessibility audit

Hit the stated bar (LCP < 2.5s mobile) and reach a defensible a11y floor.

- **Capture a baseline** with `mcp__chrome-devtools__lighthouse_audit` /
  `performance_start_trace` against prod-like (throttled mobile): LCP, CLS, INP,
  TBT, total transfer, JS bundle. Record the numbers in the doc — you can't
  improve what you didn't measure.
- **Fix to budget:** LCP < 2.5s mobile, CLS < 0.1, INP < 200ms. Likely levers
  (confirm against the trace, don't guess): hero image `priority`/preload +
  correct `sizes`, font-display + preconnect (fonts.googleapis is already in
  CSP), route-level code-splitting for the admin bundle so storefront visitors
  never download it, defer non-critical JS, verify the nav-perf cache is hitting.
  Set a **bundle-size budget** check in CI (fail on regression).
- **Accessibility pass (WCAG 2.1 AA target):** automated (axe via Playwright on
  the key routes — home, shop, PDP, cart, checkout, account, one admin screen) +
  manual keyboard-only walkthrough of the **checkout flow** (the one that must
  not be un-completable) and the admin order actions. Fix: color contrast
  (the maroon/gold palette needs checking against text), form labels + error
  association, focus-visible, dialog focus-trap/restore (Radix gives most of
  this — verify), skip-link, `lang`/`dir`, and the ৳-glyph/star-rounding items
  from the visual audit that are also correctness bugs.
- **Reduced-motion + slow-network** sanity (the branded loaders/animations
  should respect `prefers-reduced-motion`).

**Exit:** captured before/after CWV showing LCP < 2.5s mobile; axe clean on key
routes; checkout + admin actions fully keyboard-operable; bundle budget enforced
in CI.

### P5 — CI/CD & release engineering

Turn "git push deploys" into a gated, reversible pipeline.

- **Preview → prod promotion.** Keep Vercel preview-on-PR. Add a **post-deploy
  smoke** (Playwright headless against the deployed preview URL): homepage 200 +
  CSP present, a catalog card renders, `quote_order` returns a total, `/healthz`
  green, admin login page loads. Gate promotion on smoke green.
- **Deploy gates.** Require the 4 existing checks + the new smoke before a
  production promotion. Document the promotion step (Vercel "Promote to
  Production" or a `vercel --prod` from a protected workflow with the
  `SUPABASE_*` secrets already in CI).
- **Migration/deploy ordering.** Codify the rule that already bit us once
  (2026-06-30 drift): a migration applied to prod MUST be committed in the same
  session; add a CI guard that fails if `mcp.list_migrations` parity can't be
  asserted (or at minimum a documented pre-push checklist + the existing Supabase
  Preview replay check, which already catches it).
- **Rollback runbook.** Documented + drilled: app rollback = Vercel instant
  rollback to the previous deployment (seconds); DB rollback = forward-only
  migration policy (never `down`; ship a compensating migration) with the PITR
  path from P6 as the break-glass. Make the two explicitly separate procedures.
- **Release notes / changelog** convention so each prod promotion is traceable to
  a commit range and a set of migrations.

**Exit:** a PR merge runs preview + smoke; production promotion is a gated,
one-click step; a rollback drill (app + a compensating migration) is documented
and has been executed once.

### P6 — Backup / restore / disaster-recovery runbook

The highest-severity **doc** gap. No new app code; this is procedure + drills.

- **Backup posture** (per P0 #2): document the Supabase plan's backup mechanism
  (daily logical and/or PITR window). If PITR isn't available on the current
  plan, add a scheduled logical backup — a `pg_cron` + `pg_net`/edge-function or
  a GitHub Action running `pg_dump` (roles + data, `api`/`private`/`public`,
  Storage bucket manifest) to an off-Supabase object store, retention documented.
- **Restore drill (the actual deliverable):** restore the latest backup into a
  throwaway Supabase branch/project, run `supabase migration list` parity, run
  the `*_db.test.sql` invariants against the restored copy, and confirm a sample
  order + customer round-trips. Record the RTO (how long it took) and RPO (data-
  loss window). A backup you've never restored is not a backup.
- **Storage backup.** `product-media` + `payment-evidence` bucket contents —
  document how they're backed up / re-uploadable (media is re-derivable from
  source; payment evidence is not — it needs a real copy).
- **Data-export / GDPR-ish deletion** procedure (customer requests their data /
  deletion) — a documented RPC-driven path, since everything is already RPC-only.
- **DR decision tree:** "prod DB corrupt" / "bad migration shipped" / "Storage
  bucket wiped" / "region outage" → the exact steps + who to call.

**Exit:** a written runbook AND a completed restore drill with recorded RTO/RPO;
Storage backup addressed; the DR decision tree covers the four named scenarios.

### P7 — Content, legal & launch cut-over

The launch-readiness pass. Also the event that unblocks Stage-6 P1/P2.

- **Visual-audit fix list** (`[[visual-audit-2026-07-02]]`): real product
  photography (per P0 #5, the one likely blocker), badge-clutter cap on cards,
  star-rounding correctness, ৳ glyph, remove/qualify "Unavailable" social
  buttons, PDP video placeholder. Correctness-flavored ones (star rounding, ৳)
  may already be caught in P4.
- **Legal review** (per P0 #3): finalize return/refund/privacy/terms/cookie copy
  through the P4-CMS `site_pages` (so future edits need no deploy); confirm they
  match the real COD + courier + custom-order flow.
- **Domain cut-over** (per P0 #4): custom domain + TLS, HSTS preload submission,
  OAuth redirect allowlist update, cookie domain, canonical URLs / sitemap /
  robots, and the analytics/monitoring host allowlist in CSP.
- **Final credential rotation** (execute the P1 runbook now that the domain +
  secrets are final): service-role key, DB password, courier keys, webhook
  secrets, OAuth secret.
- **Hand-off to Stage-6 P1/P2:** the domain now exists, so SPF/DKIM can be set
  and the notification sender + newsletter consent resume per
  `docs/stage-6-content-ops-plan.md` §P1/§P2. Stage 7 does not build them; it
  records that the gate is now open and links the plan.
- **Go-live checklist** (single page): every toggle, secret, DNS record, env var,
  and monitor confirmed — the thing the operator ticks through on launch day.

**Exit:** launch-blocking visual items resolved; legal copy approved + live via
CMS; domain live with TLS/HSTS/OAuth correct; secrets rotated; Stage-6 P1/P2 gate
formally opened; go-live checklist complete.

### P8 — Stage closure

- Full regression: all CI checks green, all `*_db.test.sql` + the new concurrency
  suite green, Playwright storefront + admin + smoke green.
- Final advisors + security-review + a11y + CWV numbers recorded in
  `CURRENT_STATUS.md`.
- Status docs updated once, at closure (`CURRENT_STATUS.md`,
  `IMPLEMENTATION_PLAN.md`, `WALKTHROUGH.md`).
- Stage 7 marked CLOSED; remaining owner-only items (if any) listed explicitly as
  operator actions, not dev gaps.

---

## 4. Sequencing & effort

| Pass | Depends on         | Size | Notes                                                                           |
| ---- | ------------------ | ---- | ------------------------------------------------------------------------------- |
| P0   | owner              | —    | **RESOLVED 2026-07-12** (Sentry / Free-tier / domain-ready / all-four-blocking) |
| P1   | —                  | L    | CSP nonce work + F-14 are the big items; independent                            |
| P2   | —                  | M    | Extends existing concurrency harness; independent                               |
| P3   | P0 #1 (Sentry)     | M    | Vendor SDK + logging + healthz + alerting                                       |
| P3.5 | P3, owner sub-dec. | L    | Notification sender + newsletter (Stage-6 §P1/§P2); now in scope                |
| P4   | P3 (nice-to-have)  | M    | Baseline → fix to budget; a11y; bundle budget in CI                             |
| P5   | P3 (healthz), P3.5 | M    | Smoke needs `/healthz`; covers a real send; promotion + rollback                |
| P6   | P0 #2 (Free tier)  | M    | `pg_dump` pipeline + one real restore drill (no PITR on plan)                   |
| P7   | P0 #3/#4, P1, P3.5 | M    | Content + legal + domain cut-over (domain ready)                                |
| P8   | all                | S    | Closure + docs                                                                  |

**Recommended order:** **P0 ✓ → P1 → P2 → P3 → P3.5 → P4 → P5 → P6 → P7 → P8.**
P1/P2 first (harden + prove before anything else moves), then P3 (see everything
after), then P3.5 (the notification sender, now launch-blocking, rides on P3's
visibility), then P4/P6 in parallel across PCs if desired, then P5 (smoke can now
cover a real send), then P7 last because the domain cut-over should ride on top of
a fully-hardened, observable, restorable system. P6 (DR) can start anytime — it's
mostly documentation + a drill and gates nothing.

**Parallel-PC candidates** (multi-PC workflow): P2, P4, and P6 are cleanly
independent of P1/P3/P3.5 and of each other.

---

## 5. Explicitly out of scope (post-launch)

Marketing campaign sends / newsletter blasts (Stage-6 addendum only manages
consent), WhatsApp adapter (seam ready from Stage 6), rich-text CMS editor,
per-customer notification preferences, server-side cart, multi-currency /
i18n framework, a full pen-test engagement (this stage does a self-review, not a
third-party audit — recommend one post-launch), and any new customer-facing
features (that's a future stage). _(Note: the notification sender + newsletter
consent, previously out of scope here, were pulled INTO scope by the P0 decisions
— now pass P3.5.)_

## 6. Risks & guards

- **CSP nonce regression breaks the app** — the `'unsafe-inline'` removal is the
  riskiest change; land it behind an env flag with a `Content-Security-Policy-
Report-Only` shadow first, watch violation reports for a day, then enforce.
- **A hardening change silently breaks a flow** — every pass ends with a
  live-drive (the recurring Stage-5/6 lesson: SQL + unit tests miss call-layer
  bugs); the P5 post-deploy smoke is the backstop.
- **Perf "fixes" that don't move the metric** — measure first (captured
  baseline), change against the trace, re-measure; never optimize on a hunch.
- **A backup that can't restore** — P6's deliverable is the _drill_, not the
  backup config; RTO/RPO must be recorded from a real restore.
- **Domain cut-over breaks OAuth / cookies / HSTS** — P7 has an explicit
  checklist; do it in a low-traffic window with the rollback (Vercel instant
  revert + DNS TTL kept low pre-cut) ready.
- **Rotating the service-role key mid-flight breaks running functions** — rotate
  in Vercel env + redeploy atomically; the runbook sequences it.
- **Scope creep into features** — Stage 7 ships zero new customer features by
  design; anything shaped like one is deferred.
