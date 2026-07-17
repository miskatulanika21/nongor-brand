# Stage 7 / P7 — Content, legal & launch cut-over

**Status:** IN PROGRESS (2026-07-17). Code-side P7 work is **done**; what remains
is owner-gated (DNS, toggles, secrets) and the legal-copy sign-off.

**The domain exists:** `nongorr.com` was acquired 2026-07-16 (Namecheap — ACTIVE,
auto-renew ON, WHOIS privacy ON, expires 2027-02-19, PositiveSSL issued). It
**currently serves a different site**, so this is a re-point, not a first
publish: §2 sequences it so the storefront is verified on the domain before
anything that is hard to walk back (HSTS preload) is switched on.

Acquiring the domain also **opens the deferred Stage-6 P1/P2 gate** (§5).

---

## 1. What P7 has shipped

Everything below is merged, CI-green and verified against production.

### Absolute SEO URLs (`790ac71`)

Canonical, `og:url`, `og:image`, `twitter:image` and the JSON-LD `url`/`target`
were **relative**. A relative canonical self-resolves per host, so the same page
served from `nongor-brand.vercel.app` and `nongorr.com` would each declare
_itself_ canonical — exactly the duplicate-indexing split a cut-over must avoid.
Relative `og:image` is additionally invalid Open Graph; crawlers and social
unfurlers require an absolute URL.

`src/lib/site-config.ts` is now the single source of truth: `SITE_URL` (from
`VITE_SITE_URL`, defaulting to `https://nongorr.com`, trailing slashes stripped)
plus `absUrl()`, which passes already-absolute inputs through untouched so it's
safe to wrap remote Supabase Storage product images. 27 `_site*` routes +
`__root.tsx` were migrated. Covered by `src/lib/__tests__/site-config.test.ts`
(6 tests), including a regression test that `absUrl()` preserves the literal
`{search_term_string}` placeholder in the SearchAction JSON-LD — WHATWG `URL`
does not percent-encode braces in a query string (verified empirically, not
assumed).

### ৳ Taka glyph + lining numerals (`790ac71`)

Both font families are **Latin-only subsets** whose `unicode-range` excludes
U+09F3, so every ৳ on the site was falling back to a system font — one
mismatched character in the middle of every price. Fixed with a dedicated
`@font-face` (`public/fonts/taka.woff2`, an 840-byte Noto Serif Bengali subset
claiming **only** U+09F3, `size-adjust: 72%` to match cap height). It leads both
stacks but its `unicode-range` means it can never affect Latin text. Self-hosted,
so CSP is unchanged.

Separately, Cormorant Garamond defaults to **old-style figures**, which render
`1` as a short I-like glyph — prices and stat cards read wrong.
`font-variant-numeric: lining-nums` on the display stack fixes it (Cormorant's
woff2 does carry `lnum`; verified).

### Courier provider dropdown (`790ac71`)

The Select trigger showed **"ManualManual"**. Two `SelectItem`s shared
`value="manual"` — the route appended a hardcoded Manual item on top of the
seeded `manual` provider row from `20260707150000_stage5_courier_schema.sql`.
Radix concatenates the labels of same-value items. Now the list renders purely
from `providers`.

### Admin dashboard — real data, no mock scaffolding (`c5da6db`)

The dashboard was the **last screen shipping mock scaffolding**: a hardcoded
sample sales series behind a PREVIEW STATE toggle, a LOCAL PREVIEW notice and a
DEMO badge. All removed. The trend card now plots `api.report_sales_summary` via
`loadReports` — the same source the Reports page reads, so the two screens can
never disagree. Staff (no `reports.view`) don't see the card at all; the call
fails soft.

`fillDailySeries()` (`src/lib/reports-shared.ts`, 6 tests) zero-fills quiet days.
The RPC `GROUP BY`s the order date with no `generate_series`, so a day with zero
orders is **absent from the array entirely** — plotted raw, the x-axis silently
compresses and a "last 7 days" chart drew only 4 ticks. It now draws 7 and the
axis spans the true window.

### Admin dashboard — speed (`c5da6db`)

Two measured fixes; see §6 for the diagnosis.

- **Waterfall → one batch.** Four calls were split across two effects and ran
  sequentially. They're now a single `Promise.all`.
- **recharts is lazy.** It's by far the heaviest dependency on the route and was
  statically imported, so it downloaded and parsed before first paint — for a
  chart that was fake. It's now `lazy()` behind a `Suspense` boundary with a
  `<BrandLoader>`, letting the stat cards (the numbers the owner actually opens
  the dashboard for) paint without waiting on it.

### Admin sidebar logo (`c5da6db`)

Both the desktop aside and the mobile Sheet now use `<Logo variant="light"
roundMark />`, matching the footer treatment.

### Role audit — GREEN

Full authenticated walk of **owner / admin / staff** (credentials from
`TEST_CREDENTIALS.md`): all three log in; **20/20 admin routes return 200 with a
real `h1`**; RBAC enforced in both directions (admin blocked from `/admin/audit`;
staff blocked from 11 routes); zero broken images; no real console errors. Mock
scaffolding was confined to exactly one file — verified `MockBadge` /
`PreviewNotice` / `AdminStateToggle` appear nowhere else in the tree.

---

## 2. Domain cut-over runbook (`nongorr.com`)

> **Read §3 first.** `VITE_SITE_URL` is consumed two different ways and the
> difference is the single biggest trap in this procedure.

The domain currently serves another site, so order matters.

1. **Vercel — add the domain.** Project → Settings → Domains → add `nongorr.com`
   **and** `www.nongorr.com`; pick one as canonical (recommend apex, redirect
   `www` → apex) so the canonical tag and the served host agree.
2. **Namecheap — DNS.** Point per Vercel's instructions (apex `A` →
   `76.76.21.21`, or Namecheap's ALIAS/CNAME to Vercel; `www` CNAME →
   `cname.vercel-dns.com`). **Lower the TTL a day ahead** if you want a fast
   back-out. This is the step that takes the old site down — everything after is
   verification.
3. **Wait for Vercel-issued TLS.** Vercel provisions its own certificate; the
   Namecheap PositiveSSL is not used by Vercel and needs no action.
4. **`ADDITIONAL_ALLOWED_ORIGINS` — do this BEFORE step 5.** Set it to
   `https://nongor-brand.vercel.app` so in-flight sessions on the old host keep
   working through the switch (see §3).
5. **`VITE_SITE_URL=https://nongorr.com` → then REDEPLOY.** The redeploy is not
   optional; see §3.
6. **Supabase — Auth URL configuration.** Site URL → `https://nongorr.com`; add
   `https://nongorr.com/**` to Redirect URLs. **Keep the vercel.app entry until
   the cut-over is confirmed**, then remove it.
7. **Google OAuth console.** Add `https://nongorr.com` to Authorized JavaScript
   origins and the Supabase callback to Authorized redirect URIs.
8. **Verify on the real domain** (§4) — _before_ step 9.
9. **HSTS preload — LAST, and only once §4 passes.** Preload is
   **hard to reverse** (removal takes months to propagate through browser
   releases). Confirm the site is fully healthy on HTTPS at the apex first, then
   submit at `hstspreload.org`.
10. **Rotate credentials** per `docs/stage-7-secrets-and-rotation.md`, now that
    the domain and secrets are final.

**Back-out:** revert the Namecheap DNS records. With a low TTL this is minutes.
This is why HSTS preload is step 9 — after it, "just point the DNS back" stops
being a clean escape.

---

## 3. ⚠ The `VITE_SITE_URL` trap

`VITE_SITE_URL` is read **two different ways, with two different lifecycles**:

| Consumer                                                | Read via          | Lifecycle                 |
| ------------------------------------------------------- | ----------------- | ------------------------- |
| `src/lib/site-config.ts` — canonical/OG/JSON-LD/sitemap | `import.meta.env` | **Inlined at build time** |
| `src/lib/server/env.server.ts` → `checkCsrfOrigin()`    | `process.env`     | Read **per request**      |

Two consequences:

1. **Editing the env var in Vercel does not change the SEO tags.** They are
   baked into the bundle. You must **redeploy** for the canonical/OG URLs to
   move. An env edit alone silently does nothing to them.
2. **The CSRF allowlist moves immediately.** `getAllowedOrigins()` trusts the
   canonical `siteUrl` plus whatever `ADDITIONAL_ALLOWED_ORIGINS` lists, and
   `checkCsrfOrigin()` **fails closed**. The moment `VITE_SITE_URL` flips to
   `https://nongorr.com`, any mutation still originating from
   `nongor-brand.vercel.app` — an admin mid-session, a customer on an open
   checkout tab — is **rejected**, unless that origin is in
   `ADDITIONAL_ALLOWED_ORIGINS`. Hence step 4 before step 5.

Drop the extra origin once traffic has fully moved.

---

## 4. Verify on the real domain

Run all of these against `https://nongorr.com` before HSTS preload:

- [ ] `/api/health` returns healthy; `curl -sI https://nongorr.com` is `200` over HTTP/2.
- [ ] `www` → apex redirect works (or whichever direction you chose).
- [ ] **View source**: `<link rel=canonical>`, `og:url`, `og:image` all read
      `https://nongorr.com/...`. If they still say `vercel.app`, the redeploy in
      step 5 didn't happen — see §3.
- [ ] `/robots.txt` and `/sitemap.xml` emit the new host.
- [ ] **Email/password login**, **Google OAuth login**, and **logout** all work.
- [ ] A **state-changing action** succeeds (add to cart → place an order) — this
      is the CSRF-origin proof.
- [ ] **Admin**: log in, load the dashboard, confirm the revenue trend renders.
- [ ] Prices render ৳ in the brand font (not a fallback glyph) and `1` renders
      as a lining figure.
- [ ] Post-deploy smoke workflow green against the new host.

---

## 5. Hand-off: the Stage-6 P1/P2 gate is now OPEN

Stage 6 P1 (notification-outbox sender) and P2 (newsletter consent) were
**owner-deferred** pending a real domain — they need SPF/DKIM on a domain the
owner controls. `nongorr.com` now exists, so the gate is open.

**Stage 7 does not build them.** They resume per
`docs/stage-6-content-ops-plan.md` §P1/§P2 once the owner picks an email
provider. The DNS work (SPF, DKIM, DMARC) is provider-specific and should be
done in the same Namecheap session as the cut-over if the provider is known.

---

## 6. Admin lag — the diagnosis

The owner reported the Vercel-hosted admin dashboard felt laggy. Measured rather
than guessed; three causes, in order of impact:

1. **Cold starts — the dominant cause, and not a code problem.** Production
   `/api/health` TTFB: **1.78 s cold vs 0.28 s warm**. On a site with near-zero
   traffic, almost every visit _is_ a cold start. This shrinks by itself once
   real traffic arrives; it is not worth engineering around pre-launch.
2. **Client-side data waterfall — fixed.** The admin loads nothing server-side.
   `loadAdminArea` (~361 ms) gates the route, then data calls fired in sequence
   (`listAdminProducts` 291 ms, `adminOrderStatsFn` 306 ms, `listOrdersFn`
   361 ms). Now one `Promise.all`.
3. **recharts parsed before first paint — fixed.** ~5.1 MB in `node_modules`,
   statically imported, blocking the stat cards for a chart that was fake.
   Now `lazy()`.

Region alignment was already correct and needs no change: Vercel function pinned
to `bom1`, Supabase in AWS `ap-south-1` (Mumbai). Keeping those two co-located is
what took SSR TTFB from ~1.5 s to ~0.2 s and must not regress.

Storefront LCP remains ~4.5 s against a <2.5 s budget — tracked in
`docs/stage-7-perf-a11y.md`, not re-opened here.

---

## 7. Go-live checklist

The single page the operator ticks through on launch day. Unchecked items are
**owner-gated** — they need a console, a password or a DNS record, not code.

### Domain & DNS

- [ ] `nongorr.com` + `www` added in Vercel, canonical host chosen
- [ ] Namecheap DNS pointed at Vercel; old site retired
- [ ] Vercel TLS issued; HTTP → HTTPS enforced
- [ ] §4 verification passed **in full**
- [ ] HSTS preload submitted (**only after** §4 — hard to reverse)
- [ ] SPF / DKIM / DMARC (with the Stage-6 P1 provider, if chosen)

### Courier — keys & webhook (§8)

- [ ] SteadFast keys **regenerated** (the merchant-dashboard pair was exposed in
      a screenshot 2026-07-17) → `STEADFAST_API_KEY` / `STEADFAST_SECRET_KEY`
- [ ] `STEADFAST_WEBHOOK_SECRET` set in Vercel (a value **we** invent, not one
      SteadFast issues) **+ redeploy**
- [ ] SteadFast → **Update Webhook Info** → `https://nongorr.com/api/webhook/steadfast`,
      header `X-Webhook-Secret` = that secret (**after** the DNS cut-over, so
      it's wired once — was `No Webhook Set` as of 2026-07-17)
- [ ] Verify the secret landed: `curl -X POST` the endpoint with **no** header →
      `200` means set, `503` means still unset (proves it without knowing it)
- [ ] Book one real shipment end-to-end and confirm a status update arrives
- [ ] Same for Pathao if used: `PATHAO_CLIENT_ID` / `PATHAO_CLIENT_SECRET` /
      `PATHAO_WEBHOOK_SECRET` → `https://nongorr.com/api/webhook/pathao`

### Environment

- [ ] `ADDITIONAL_ALLOWED_ORIGINS=https://nongor-brand.vercel.app` (before the flip)
- [ ] `VITE_SITE_URL=https://nongorr.com` **+ redeploy** (§3)
- [ ] `ADDITIONAL_ALLOWED_ORIGINS` cleared once traffic has moved

### Security

- [ ] Disable the **Vercel Toolbar** in production — CSP Report-Only was
      **verified clean 2026-07-16** (browser walk + raw-HTML nonce audit): the
      app is 100% strict-CSP compatible and the _only_ violation is the
      Toolbar's `vercel.live/feedback.js`, which is team-only and never loads
      for customers
- [ ] Set `CSP_ENFORCE_STRICT=true` (confirmed **not** currently set) + redeploy
- [ ] Supabase → enable **leaked-password protection** + Manual linking
      (`docs/stage-7-secrets-and-rotation.md` §3)
- [ ] Rotate: service-role key, DB password, courier keys, webhook secrets,
      OAuth secret (§2 step 10)

### CI/CD & recovery

- [ ] `VERCEL_AUTOMATION_BYPASS_SECRET` added (activates the post-deploy smoke gate)
- [ ] Gated promotion enabled (`docs/stage-7-cicd-and-rollback.md` §2)
- [ ] Rollback drill run once (§4d there)
- [ ] Backup secrets added: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `BACKUP_ENCRYPTION_PASSPHRASE` (`docs/stage-7-backup-and-dr.md` §7)

### Content & legal

- [ ] Legal copy (return / refund / privacy / terms / cookie) reviewed and
      approved, live via the `site_pages` CMS (edits need no deploy)
- [ ] Copy matches the **real** COD + courier + custom-order flow
- [ ] Real product photography in place (visual-audit blocker)
- [ ] Sentry receiving events from the new host

### Verified already ✅

- [x] Absolute canonical / OG / JSON-LD URLs (`790ac71`, confirmed live)
- [x] ৳ renders in-font; lining numerals
- [x] Courier provider dropdown correct (Manual / Pathao / SteadFast)
- [x] Admin dashboard on real data, zero mock scaffolding
- [x] Owner / admin / staff role audit green, RBAC enforced (§1)
- [x] `audit_logs` prod↔repo drift reconciled + present in prod migration history
- [x] Restore drill green, RTO ≈ 1 s (`docs/stage-7-backup-and-dr.md`)

---

## 8. Courier webhook — the silent gap

**As of 2026-07-17 the SteadFast merchant dashboard reads `Webhook URL: No
Webhook Set`.** The endpoint has existed since Stage 5 and nothing has ever
called it.

This is the failure mode worth understanding, because **nothing about it looks
broken**. Booking a shipment works; the consignment is created; the admin shows
it as booked. What never happens is the _update_ — SteadFast has nowhere to
report "picked up", "delivered", "returned", so shipments freeze at their booked
status forever and the operator has to reconcile delivery by hand. There is no
error to notice. It just quietly does nothing.

### What the endpoint already does

`POST /api/webhook/steadfast` (`src/routes/api.webhook.steadfast.ts`; Pathao is
the mirror image):

- Verifies an `X-Webhook-Secret` header with a **timing-safe** compare.
- **Fails closed** — if `STEADFAST_WEBHOOK_SECRET` is unset it returns **503**
  and processes nothing.
- **Idempotent** — the event id is a SHA-256 of the raw body (no clock), so a
  byte-identical provider retry dedups instead of double-applying.
- Rate-limited per IP; body capped at 64 KB (checked on the read text, not the
  spoofable `content-length`).
- Returns a **generic 200 to everything** — a wrong secret, a malformed body and
  a success are indistinguishable from outside, so it never leaks internal
  state.

### Wiring it (order matters)

The secret is **ours to invent** — SteadFast does not issue it; it echoes back
whatever header we register. Generate it outside any shared session
(`openssl rand -base64 32`).

1. Vercel → add `STEADFAST_WEBHOOK_SECRET` (Production) → **redeploy**. Env
   changes don't reach the running app without one.
2. SteadFast → **Update Webhook Info** → URL
   `https://nongorr.com/api/webhook/steadfast`, header `X-Webhook-Secret` = that
   value.
3. Do step 2 **after** the DNS cut-over. Pointing it at the vercel.app host works
   but leaves the courier integration depending on a URL we're retiring.

### Verifying without handling the secret

The fail-closed behavior doubles as a probe. POST with **no** header:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://nongorr.com/api/webhook/steadfast
# 503 → STEADFAST_WEBHOOK_SECRET is not set (or the redeploy didn't happen)
# 200 → the secret IS set (the request failed the compare, as it should)
```

That distinguishes "configured" from "not configured" **without anyone needing
to know or reveal the value**. Then book one real shipment and confirm a status
update actually lands.

> **Note (2026-07-17):** the SteadFast Api-Key/Secret-Key pair was exposed in a
> screenshot. **Regenerate them** in the merchant dashboard and treat the old
> pair as burned — it can book/cancel real shipments and read customer addresses
> and phone numbers. See `docs/stage-7-secrets-and-rotation.md` for the standing
> rotation procedure.
