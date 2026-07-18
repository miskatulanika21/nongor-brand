# Stage 7 / P7 — Content, legal & launch cut-over

**Status:** CUT-OVER DONE (2026-07-17). `nongorr.com` **serves this app**, on the
apex, correctly canonicalised — and is deliberately still `noindex`. What remains
is the webhook secrets, the indexing flip, and the legal-copy sign-off.

## Where the cut-over actually landed

Verified live 2026-07-17, after the move:

|                          | State                                                 |
| ------------------------ | ----------------------------------------------------- |
| Apex `nongorr.com`       | **Production** — serves this app, HTTP 200            |
| `www.nongorr.com`        | **308 → apex** (apex is canonical)                    |
| `<link rel="canonical">` | `https://nongorr.com/` ✅ matches the served host     |
| `<meta name="robots">`   | `noindex,nofollow` — **intentional**, see §2 step 9   |
| `/api/webhook/*`         | **200** — both secrets now set (re-probed 2026-07-18) |
| HSTS preload             | **not submitted** — nothing locked in                 |

**The DNS was already on Vercel.** The apex `A` record pointed at `216.198.79.1`
and `www` at `…vercel-dns-017.com` before the move, so **no Namecheap DNS change
was needed and none should be made**. The cut-over was purely moving the domain
between Vercel _projects_. Earlier revisions of this doc told you to re-point DNS
at Namecheap — that was written before the domain was inspected, and following it
now would break a working configuration.

**What actually blocked it** was not DNS: the domain was claimed by a _different
Vercel account_ (the old static site). Vercel tracks domains at **both** the
account and the project level, so removing it from the old _project_ is not
enough — it must be released from the old **account's** domain list, or ownership
proved with the `_vercel` TXT records Vercel offers. Either clears it in minutes.

The domain also **opens the deferred Stage-6 P1/P2 gate** (§5) — and the Resend
email DNS (`resend._domainkey`, SPF via `amazonses`, `_dmarc`) is already present
on `nongorr.com`, so the outbox sender is unblocked whenever you want it.

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

**Steps 1–7 are DONE (2026-07-17)** and kept here as the record of what was
actually required — the reasoning matters more than the clicks, and steps 8–9 are
still open. What follows is what happened, not a plan.

1. ~~**Release the domain from the old Vercel account.**~~ ✅ The domain was
   claimed by a different Vercel account serving the old static site. Vercel
   tracks domains at **both** account and project level: removing it from the old
   _project_ leaves it claimed, and the new project shows _"This domain is linked
   to another Vercel account."_ Clear it either by removing it from the old
   **account's** Domains page, or by adding the `_vercel` TXT records Vercel
   offers. Between release and verification the domain serves **404** — expected,
   and the reason to do this before announcing anything.
2. ~~**Add the domain to `nongor-brand`.**~~ ✅ Apex `nongorr.com` = **Production**;
   `www.nongorr.com` = **308 → apex**. The direction matters: the served host must
   match the canonical tag, and `VITE_SITE_URL` is the apex.
3. ~~**DNS.**~~ ✅ **No change was needed and none should be made.** The apex `A`
   already pointed at Vercel (`216.198.79.1`) and `www` at
   `…vercel-dns-017.com`. Because DNS never moved, there was no propagation wait
   and no downtime window. _(A previous revision of this doc told you to re-point
   at `76.76.21.21`. That was written before the DNS was inspected — do not do it.
   Do not touch the `A`/`CNAME`, nor the Resend `resend._domainkey` / `send` /
   `_dmarc` TXT records.)_
4. ~~**TLS.**~~ ✅ Vercel provisions its own certificate. The Namecheap
   PositiveSSL is unused and needs no action.
5. ~~**`ADDITIONAL_ALLOWED_ORIGINS` before `VITE_SITE_URL`.**~~ ✅ Set to
   `https://nongor-brand.vercel.app` so in-flight sessions survive the switch
   (see §3).
6. ~~**`VITE_SITE_URL=https://nongorr.com` → REDEPLOY.**~~ ✅ **The redeploy is
   the step that is silently skipped.** Attaching a domain does _not_ change these
   values — they are inlined at build time. Before the redeploy, `nongorr.com` was
   live and serving `<link rel="canonical" href="https://nongor-brand.vercel.app/">`
   plus `noindex`: a site that looks perfectly healthy while pointing every
   canonical at the wrong host. Verified after: canonical and `og:url` are now
   `https://nongorr.com/`.
7. **Supabase + Google OAuth.** Supabase → Auth → URL Configuration: Site URL
   `https://nongorr.com`, add `https://nongorr.com/**` to Redirect URLs; **keep
   the vercel.app entry** until §4 passes, then remove. Google OAuth console: add
   `https://nongorr.com` to Authorized JavaScript origins and the Supabase
   callback to Authorized redirect URIs.
8. **Webhook secrets → redeploy → register.** ⬜ OPEN. See §8. Both endpoints
   return **503** until their secrets are set, and Pathao's registration probes
   the URL — so a 503 makes registration fail. Set, redeploy, verify **200**,
   then register.
9. **`VITE_ALLOW_INDEXING=true`.** ⬜ OPEN — currently `noindex,nofollow`, which
   is deliberate. This is the step Google notices, and it is gated on the
   legal-copy sign-off. Everything else on this list reverses in minutes; a bad
   indexing event does not. Leaving the site `noindex` lets you register webhooks
   and run a real booking test on the production domain before anyone can find it.
10. **HSTS preload — LAST.** ⬜ OPEN. **Hard to reverse** (removal takes months to
    propagate through browser releases). Nothing is locked in yet: HSTS is served
    but _without_ the `preload` directive. Only submit at `hstspreload.org` once
    §4 passes.

**Back-out:** re-add the domain to the old Vercel project. Because DNS was never
touched, this is a Vercel-side change measured in minutes — not a propagation
wait. That remains true right up until HSTS preload (step 10), which is where a
clean escape stops existing. 10. **Rotate credentials** per `docs/stage-7-secrets-and-rotation.md`, now that
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

- [x] Domain released from the **old Vercel account** (account-level Domains, not
      just the project) — this, not DNS, was the actual blocker
- [x] `nongorr.com` = **Production**, `www` = **308 → apex** in `nongor-brand`
- [x] **DNS: no change made, none needed** — already pointed at Vercel. Do not
      "fix" the `A`/`CNAME`, and do not touch the Resend TXT records
- [x] Vercel TLS issued; HTTP → HTTPS enforced
- [x] `VITE_SITE_URL=https://nongorr.com` **+ redeploy** → canonical/`og:url`
      verified as `https://nongorr.com/` on the live apex
- [ ] §4 verification passed **in full**
- [ ] `VITE_ALLOW_INDEXING=true` — ⬜ still `noindex,nofollow` **on purpose**;
      gated on the legal-copy sign-off. The one step Google notices
- [ ] HSTS preload submitted (**only after** §4 — hard to reverse).
      ⚠ **Correction (2026-07-18):** an earlier revision of this line claimed the
      site is served _without_ `preload`. It is not. The live apex returns
      `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
      (`headers.server.ts`). Submission to hstspreload.org is still a separate,
      deliberate step — so nothing is locked in _yet_ — but the directive is
      already being advertised, and browsers/scrapers can act on it. Treat the
      remaining margin as smaller than the old note implied.
- [x] SPF / DKIM / DMARC — Resend records already present on `nongorr.com`
      (`resend._domainkey`, `send` → amazonses, `_dmarc`); unblocks Stage-6 P1

### Courier — keys & webhook (§8)

- [x] SteadFast keys **regenerated** → verified live: `/get_balance` returns
      `200 {"current_balance":0}` on `portal.packzy.com`. (The previous pair was
      exposed in a screenshot _and_ already dead — 401.)
- [x] `STEADFAST_BASE_URL=https://portal.packzy.com/api/v1` (or leave unset — the
      default is now correct). **Never** set it to a `portal.steadfast.com.bd`
      host: that domain does not exist.
- [x] `STEADFAST_WEBHOOK_SECRET` set in Vercel **+ redeploy**. ⚠ It is a value
      **you generate** (`openssl rand -hex 32`) — SteadFast does not issue it,
      it only echoes back what you register. **Paste the command's _output_, not
      the command.** A guessable secret here lets anyone forge delivery events and
      mark orders delivered/returned at will.
      ⚠ **Use hex, NOT `-base64`.** SteadFast's "Auth Token(Bearer)" field
      client-side-rejects `+` `/` `=` with _"The auth token format is invalid."_
      A base64 secret can never be entered; hex is alphanumeric and passes. Our
      endpoint compares the Bearer token verbatim, so any string works our side.
- [x] SteadFast → **Update Webhook Info** (<https://steadfast.com.bd/user/webhook/add>)
      → Callback Url `https://nongorr.com/api/webhook/steadfast`,
      **Auth Token(Bearer)** = that secret. Register the **apex, never `www`** —
      `www` 308s to apex and a redirect can drop the `Authorization` header the
      auth depends on. (Registered 2026-07-17 → _"Successfully updated!"_)
- [x] Verify the secret landed: `curl -X POST` the endpoint with **no** header →
      `200` means set, `503` means still unset (proves it without knowing it).
      **Verified 2026-07-18: `200`** → `STEADFAST_WEBHOOK_SECRET` is set in prod.
- [ ] Book one real shipment end-to-end and confirm a status update arrives.
      ⚠ **SteadFast has no sandbox** — the first booking is a real, billable
      consignment. Pathao can be rehearsed for free; SteadFast cannot.
- [ ] **`PATHAO_SANDBOX_ENABLED` is `false` (or unset) in Vercel.** ⚠ If it is
      `true` in production, every real order books against Pathao's sandbox and
      **nothing ever ships** — the app looks healthy and returns consignment ids
      the whole time. It is legitimately `true` in local `.env` for testing, so
      this is easy to carry over by accident. Verify it explicitly; do not assume.
- [x] Pathao production credentials **verified live** (2026-07-17): `issue-token`
      → 200, `/stores` → 200, `/price-plan` → 200. ⚠ **`PATHAO_USERNAME` /
      `PATHAO_PASSWORD` are your merchant-panel _login email and password_, NOT
      API values.** Pathao needs an API pair (`CLIENT_ID`/`CLIENT_SECRET` from the
      Developer API page) **and** an account login, because `issue-token` only
      supports the `password` grant. Filling all four from the Developer API page
      is the natural mistake and it fails as **HTTP 500 with an empty body** —
      which tells you nothing. If you see that 500, check this first.
- [x] `PATHAO_STORE_ID` = **`410847`** ("Nongorr") — confirmed against the live
      `/stores` list. Store ids are per-environment and the code does **not** fall
      back between them: `PATHAO_SANDBOX_STORE_ID` is separate, because reusing
      one in the other environment books against a store that isn't yours
      (verified: prod store `410847` does not exist in sandbox).
- [x] Pathao webhook: set `PATHAO_WEBHOOK_SECRET` **and redeploy first**, then
      "Add Webhook" → `https://nongorr.com/api/webhook/pathao`, **Secret** = that
      value. Registration probes the URL and fails while the env is unset.
      **Secret verified set 2026-07-18** (unauthenticated POST → `200`, not
      `503`); registration was completed 2026-07-17 with a 202 handshake.

### Environment

- [x] `ADDITIONAL_ALLOWED_ORIGINS=https://nongor-brand.vercel.app` (before the flip)
- [x] `VITE_SITE_URL=https://nongorr.com` **+ redeploy** (§3) — verified live
- [ ] `ADDITIONAL_ALLOWED_ORIGINS` cleared once traffic has moved

### Security

- [ ] Disable the **Vercel Toolbar** in production — CSP Report-Only was
      **verified clean 2026-07-16** (browser walk + raw-HTML nonce audit): the
      app is 100% strict-CSP compatible and the _only_ violation is the
      Toolbar's `vercel.live/feedback.js`, which is team-only and never loads
      for customers.
      ⚠ **Scope caveat on that 2026-07-16 sign-off:** it could not have covered
      `/`, `/shop`, `/product/*`, `/about` or `/size-guide`. Those pages emitted
      **no Report-Only header at all** (see the fix below), so they reported no
      violations because nothing was watching — not because they were clean.
      The hashed policy now covers them; they were re-walked 2026-07-18.
- [ ] Set `CSP_ENFORCE_STRICT=true` (confirmed **not** currently set) + redeploy

      ⚠ **Before 2026-07-18 this flag was a partial no-op — do not trust older
      notes that treat it as a whole-site switch.** Public pages are served from
      a shared edge cache and are rendered NONCE-FREE on purpose (a nonce
      replayed from cache secures nothing). The strict policy was gated on a
      nonce being present, so those pages silently fell through to the
      permissive `script-src 'unsafe-inline'` policy. Flipping the flag hardened
      `/cart`, `/contact`, `/account`, `/admin` and `/checkout` while leaving the
      **entire storefront** unhardened, with no error and no Report-Only header
      to reveal it.

      Fixed by adding a second hardened policy: cached pages now get a
      `'sha256-…'` per inline script (`src/lib/server/csp-hash.server.ts`),
      derived from the response body so policy and body cache as one unit.
      Uncacheable pages keep nonce + `'strict-dynamic'`. If hashes cannot be
      computed the response **fails open** to the permissive policy — a hash
      policy built from a bad render would be cached and served to everyone.

      ⚠ **Verify with a real navigation, never with `curl` or `fetch`.** Neither
      runs the HTML parser, so both will confirm a policy that a browser then
      rejects: the parser rewrites U+0000 → U+FFFD inside script text (TanStack
      uses NUL to delimit serialised route keys), and CSP hashes the
      post-parse text. Getting this wrong blocks hydration site-wide.

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

> **Corrected 2026-07-17.** This section previously said to register the secret
> as an `X-Webhook-Secret` header. **Neither provider sends that header** — the
> instruction below would have failed every event even after wiring. The
> integration was verified against both providers' live docs and rewritten; the
> real header names are given below. See §8.1 for the full list of what was
> wrong.

### What the endpoint already does

`POST /api/webhook/steadfast` (`src/routes/api.webhook.steadfast.ts`; Pathao is
**not** a mirror image — see §8.1):

- Verifies the token in `Authorization: Bearer <token>` with a **timing-safe**
  compare. (Pathao instead sends `X-PATHAO-Signature`.)
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
(`openssl rand -hex 32`). ⚠ **Hex, not `-base64`:** SteadFast's Auth Token field
rejects `+` `/` `=` ("The auth token format is invalid."), so a base64 value can
never be registered. Hex is alphanumeric and accepted.

1. Vercel → add `STEADFAST_WEBHOOK_SECRET` (Production) → **redeploy**. Env
   changes don't reach the running app without one.
2. SteadFast → **Update Webhook Info**
   (<https://steadfast.com.bd/user/webhook/add>) → **Callback Url**
   `https://nongorr.com/api/webhook/steadfast`, **Auth Token(Bearer)** = that
   value. SteadFast returns it to us as `Authorization: Bearer <value>`.
3. Do step 2 **after** the DNS cut-over. Pointing it at the vercel.app host works
   but leaves the courier integration depending on a URL we're retiring.

For **Pathao**, the same order applies with one extra constraint: set
`PATHAO_WEBHOOK_SECRET` and redeploy **before** clicking "Add Webhook". Pathao
probes the URL during registration and refuses it unless the probe is answered
(and while the env is unset the endpoint returns 503, which fails the probe). Enter
the secret as **Secret**; Pathao returns it as `X-PATHAO-Signature`. Tick the
events you want — all 24 are handled.

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
> rotation procedure. A live read-only `/get_balance` probe on 2026-07-17
> returned `401 invalid API credentials` — the keys currently in env are already
> dead, so this is now a blocker, not just hygiene. (That endpoint counts
> failures: the response carried `attempts_left: 9`. Don't probe it in a loop.)

---

## 8.1 Courier integration — what was actually broken (2026-07-17)

Stage 5 shipped the courier layer against **guessed** provider contracts. None of
it could ever have worked in production. Verified against both providers' live
docs and, where possible, live probes:

| #   | Bug                                             | Evidence                                                                                                                                                                                                                                                                                                     | Fix                                                                                                                                                   |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SteadFast base URL `portal.steadfast.com.bd`    | **NXDOMAIN** — `curl` exit 6, node `ENOTFOUND`. Real host is `portal.packzy.com` (401 JSON, i.e. reachable).                                                                                                                                                                                                 | `DEFAULT_BASE_URL` → packzy                                                                                                                           |
| 2   | Both webhooks checked `X-Webhook-Secret`        | Neither provider sends it. SteadFast's panel field is literally "Auth Token(Bearer)"; its docs list `Authorization: Bearer {your_api_key}`. Pathao's docs list `X-PATHAO-Signature`.                                                                                                                         | Per-provider auth                                                                                                                                     |
| 3   | Pathao webhook could not be registered          | Their spec requires the URL answer the `{event:"webhook_integration"}` probe with **202** + header `X-Pathao-Merchant-Webhook-Integration-Secret: f3992ecc-…`. We returned 200 and no header.                                                                                                                | Handshake, checked **before** the signature (the probe is unsigned)                                                                                   |
| 4   | Pathao status read from `order_status`/`status` | Payload has neither. Status is `event` (`"order.delivered"`). Both reads were always `undefined`.                                                                                                                                                                                                            | Read `event`                                                                                                                                          |
| 5   | Pathao vocabulary invented                      | We expected `picked_up`, `out_for_delivery`. Real slugs are dotted-kebab and 24 of them. Several are unguessable: "Payment Invoice" = `order.paid`, "Exchange" = `order.exchanged`, "Return" = `order.returned`. Also our normalizer never stripped the dot, so a real slug could never have matched anyway. | All 24 mapped                                                                                                                                         |
| 6   | Pathao token grant `client_credentials`         | Docs: _"Must use grant type **password**"_. Production had no username/password at all, so token issuance — and therefore every Pathao call — failed.                                                                                                                                                        | `password` grant; `PATHAO_USERNAME`/`PATHAO_PASSWORD` now required                                                                                    |
| 7   | Pathao status poll hit `/orders/{cid}`          | Documented path is `/orders/{cid}/info`.                                                                                                                                                                                                                                                                     | Corrected                                                                                                                                             |
| 8   | SteadFast statuses invented                     | We mapped `in_transit` and `delivered_to_warehouse`; neither exists. Real set is 11 (polling) / 5 (webhook). SteadFast has **no transit signal at all**.                                                                                                                                                     | Real vocabulary                                                                                                                                       |
| 9   | SteadFast `tracking_update` dropped             | A second `notification_type` carrying `tracking_message` and **no** status.                                                                                                                                                                                                                                  | Recorded via new `api.record_shipment_event` (migration `20260717120221`, applied to prod) — append-only, so it can't clobber a real `courier_status` |
| 10  | `checkStatus` threw on any non-JSON reply       | Found by driving the live API, not by reading docs: polling a consignment that isn't ours returns the bare text `Unauthorized Access` (HTTP 401), and the unguarded `resp.json()` raised a SyntaxError into the caller. A gateway error or an HTML page does the same. Both adapters were affected.          | Defensive parse; a failed poll yields `unknown` — a documented, non-transitioning status. Pinned by `courier/__tests__/adapter-resilience.test.ts`    |
| 11  | One `PATHAO_STORE_ID` for both environments     | Store ids are issued per environment: production store `410847` ("Nongorr") does not exist in sandbox. A single var means one environment is always wrong — booking against a store that isn't ours.                                                                                                         | Separate `PATHAO_SANDBOX_STORE_ID`, with **no fallback** between them                                                                                 |

**Why none of this surfaced:** both endpoints return 503 while their secrets are
unset, and booking failures are reported per-attempt rather than alerted. The
integration failed silently and completely.

**The lesson worth keeping:** the Stage 5 tests passed the entire time. They
asserted our _invented_ vocabulary, so they pinned the bug in place instead of
catching it. Tests covering an external contract must be written from that
contract's published source — `src/lib/__tests__/courier-shared.test.ts` now
cites the doc for each expectation, and asserts that the old guesses map to
`null`.
