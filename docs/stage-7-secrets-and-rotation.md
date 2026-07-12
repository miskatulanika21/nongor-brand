# Stage 7 (P1) — Secrets Inventory & Credential-Rotation Runbook

**Status:** Reference doc (2026-07-12). The _procedures_ below are ready now; the
one-time **execution** of a full rotation is a go-live task (Stage 7 P7 cut-over),
because rotating before the final domain/provider setup would just be redone.

This is the single source of truth for **every secret the platform holds**: where
it lives, what an attacker gains if it leaks (blast radius), when to rotate it, and
exactly how. If you add a secret, add a row here.

---

## 1. Inventory

Legend — **Store**: Vercel = Vercel project env vars; Supabase = Supabase
dashboard; GitHub = repo Actions secrets. **Exposure**: `public` ships to the
browser (by design); `server` never leaves the server.

| Secret                                                                                                                                             | Store                                      | Exposure   | Blast radius if leaked                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                                                        | Vercel                                     | **server** | **Critical** — bypasses RLS, full read/write on every table via PostgREST. The keys to the kingdom.                                    |
| Supabase **DB password**                                                                                                                           | Supabase + GitHub (`SUPABASE_DB_PASSWORD`) | server     | **Critical** — direct Postgres superuser-ish access (migrations, CI lint).                                                             |
| `SUPABASE_ACCESS_TOKEN`                                                                                                                            | GitHub                                     | server     | High — Supabase Management API for this account (CI branching/lint).                                                                   |
| Google OAuth **client secret**                                                                                                                     | Supabase (Auth → Providers)                | server     | High — impersonate the app's Google sign-in; sign in as users.                                                                         |
| `STEADFAST_API_KEY` / `STEADFAST_SECRET_KEY`                                                                                                       | Vercel                                     | server     | Medium — book/cancel real shipments, incur courier cost, read customer addresses.                                                      |
| `PATHAO_CLIENT_ID` / `PATHAO_CLIENT_SECRET`                                                                                                        | Vercel                                     | server     | Medium — same as SteadFast for Pathao (OAuth2 client creds).                                                                           |
| `STEADFAST_WEBHOOK_SECRET` / `PATHAO_WEBHOOK_SECRET`                                                                                               | Vercel                                     | server     | Medium — forge inbound delivery-status webhooks (drive fake order transitions). Timing-safe compared; disabled (503) when unset.       |
| `UPSTASH_REDIS_REST_TOKEN` (+ `_URL`)                                                                                                              | Vercel                                     | server     | Low/Medium — read/write the distributed rate-limit counters (defeat throttling). Optional; in-memory store used when unset.            |
| `VITE_SUPABASE_ANON_KEY`                                                                                                                           | Vercel                                     | **public** | Low — designed to be public; every table is RLS deny-all / RPC-only, so the key alone grants nothing beyond the intended public reads. |
| `VITE_SUPABASE_URL` / `VITE_SITE_URL`                                                                                                              | Vercel                                     | public     | None — public identifiers.                                                                                                             |
| `VITE_ENABLE_GOOGLE_OAUTH` / `VITE_ENABLE_FACEBOOK_OAUTH` / `ENFORCE_ADMIN_MFA` / `CSP_ENFORCE_STRICT` / `NODE_ENV` / `ADDITIONAL_ALLOWED_ORIGINS` | Vercel                                     | config     | None — feature flags / config, not secrets.                                                                                            |

**Non-secret note:** `PATHAO_SANDBOX_*` are test-only credentials for the Pathao
sandbox; treat as low-value but still rotate if leaked. `SUPABASE_PROJECT_ID`
(GitHub) is an identifier, not a secret.

**Historical exposure (must rotate before go-live):** Stage-1 committed some
credentials to git history before the RPC-only lockdown. Treat
`SUPABASE_SERVICE_ROLE_KEY`, the DB password, and any courier keys present then as
**compromised until rotated** at the P7 cut-over. (This is the long-standing
"credential rotation deferred to go-live" item.)

---

## 2. Rotation runbook

### Golden rules

1. **Rotate at the source first, then update the store, then redeploy — atomically.**
   For a Vercel env var, updating it does **not** affect running deployments; the
   new value only takes effect on the next deploy. So: set the new value in Vercel
   → trigger a redeploy → verify → only then invalidate the old value at the source
   (if the provider allows both to be valid briefly). Where the provider replaces
   the key immediately (Supabase service-role reset), expect a brief window and do
   it in low traffic.
2. **Never** put a secret in `VITE_`-prefixed vars (those ship to the browser).
   `VITE_SUPABASE_SERVICE_ROLE_KEY` must never exist — only the un-prefixed
   `SUPABASE_SERVICE_ROLE_KEY` (server) is correct.
3. After any rotation, confirm the app still works end-to-end (sign-in, a public
   read, a checkout quote) and check Vercel runtime logs for auth errors.

### Per-secret procedures

**Supabase service-role key / anon key**

- Supabase Dashboard → Project Settings → API → **Reset** the `service_role`
  (or `anon`) key. Copy the new value.
- Vercel → Project → Settings → Environment Variables → update
  `SUPABASE_SERVICE_ROLE_KEY` (and `VITE_SUPABASE_ANON_KEY` if that was reset).
- Redeploy (production). Verify a signed-in admin action + a public catalog read.
- The old key is invalid immediately on reset — do this in a low-traffic window.

**Supabase DB password**

- Dashboard → Project Settings → Database → **Reset database password**.
- Update the GitHub Actions secret `SUPABASE_DB_PASSWORD` (Settings → Secrets and
  variables → Actions). No Vercel change (the app uses PostgREST, not a direct DB
  connection). Re-run CI to confirm the migrations/lint jobs pass.

**Google OAuth client secret**

- Google Cloud Console → the OAuth client → rotate the client secret.
- Supabase Dashboard → Authentication → Providers → Google → paste the new secret.
- Test a full Google sign-in round-trip. (Client _ID_ is public; only the secret
  rotates.)

**Courier API keys (SteadFast / Pathao)**

- Rotate in the courier's merchant portal.
- Vercel → update `STEADFAST_API_KEY` / `STEADFAST_SECRET_KEY` /
  `PATHAO_CLIENT_ID` / `PATHAO_CLIENT_SECRET` → redeploy.
- Verify with a manual booking on a test order (or the courier's connectivity check).

**Webhook secrets (SteadFast / Pathao)**

- Choose a new random secret (`openssl rand -hex 32`).
- Update it BOTH in Vercel (`STEADFAST_WEBHOOK_SECRET` / `PATHAO_WEBHOOK_SECRET`)
  AND in the courier's webhook configuration, then redeploy. While unset the
  endpoint returns 503 (processing disabled) — safe, but bookings won't get status
  updates until both sides match.

**Upstash Redis token**

- Upstash console → rotate the REST token → update `UPSTASH_REDIS_REST_TOKEN` in
  Vercel → redeploy. Rate limiting falls back to the in-memory store if the token
  is wrong, so this fails safe (per-instance limits still apply).

**Supabase access token (CI)**

- Supabase account → Access Tokens → revoke + create → update the GitHub secret
  `SUPABASE_ACCESS_TOKEN` → re-run CI.

---

## 3. Owner action — enable leaked-password protection

Separate from rotation, and a **go-live must-do** (tracked since Stage 1.5, still
open per advisors):

- Supabase Dashboard → **Authentication → Policies (Password)** → enable
  **"Leaked password protection"** (checks new/changed passwords against
  HaveIBeenPwned). No code change; it hardens registration + password change +
  reset immediately.

This is the only remaining `WARN` security advisor that is a real to-do (the
others — RPC-only `rls_enabled_no_policy` INFO and the intentional public
`SECURITY DEFINER` read WARNs — are accepted posture, see §4 of `CURRENT_STATUS.md`).

---

## 4. Rotation cadence

- **At go-live (P7):** rotate everything in the "historical exposure" note above.
- **Routine:** service-role key + DB password every ~6–12 months, or immediately on
  any suspected exposure (a leaked deploy log, a departed contractor, a repo leak).
- **On incident:** rotate the affected secret first, then investigate — a rotated
  key limits the blast radius while you look.
