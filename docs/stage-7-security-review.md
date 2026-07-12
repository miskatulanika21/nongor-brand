# Stage 7 (P1e) — Security Review & Accepted-Risk Register

**Date:** 2026-07-12. Scope: a full-surface pass over the auth/RBAC boundary, the
RPC grant posture, the new Stage-7 P1 attack surface, and the Supabase advisors.
This is a **self-review** (not a third-party pen test — one is recommended
post-launch, see `docs/stage-7-hardening-launch-plan.md` §5).

**Verdict:** no launch-blocking security defects found. The one real open item is
the leaked-password toggle (owner action, §3). Everything else is either resolved
or an accepted, documented posture below.

---

## 1. Advisors sweep (2026-07-12)

**Security** — only the known-intentional items:

| Advisor                                                          | Items                                                                                                            | Disposition                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rls_enabled_no_policy` (INFO)                                   | every `public.*` app table                                                                                       | **Accepted.** These are RLS-enabled **deny-all, RPC-only** tables — direct anon/authenticated grants are revoked and all access flows through `SECURITY DEFINER` `api.*` RPCs. "No policy" is the _correct_ posture (deny by default); a policy would only loosen it. |
| `anon/authenticated_security_definer_function_executable` (WARN) | `catalog_facets`, `get_active_banners`, `get_public_settings`, `get_site_page`, `get_size_charts`, `quote_order` | **Accepted.** These are the six deliberately-public reads (storefront catalog, published content, guest checkout quote). Each is `STABLE`, `search_path=''`, reads only publicly-visible rows, and is intentionally granted to `anon`. No writes, no PII.             |
| `auth_leaked_password_protection` (WARN)                         | Auth                                                                                                             | **Open — owner action.** Enable in the dashboard (§3 of `stage-7-secrets-and-rotation.md`). The only genuine to-do.                                                                                                                                                   |

**Performance** — all INFO, none actionable pre-launch: `unindexed_foreign_keys`
on staff-attribution columns (`*_created_by` / `*_updated_by` / `actor_id` → rarely
filtered by that FK), and `unused_index` (no production traffic yet). Revisit if a
specific query shows up hot after launch.

**No new advisories** were introduced by the Stage-7 P1 work (`delete_account`,
`promote_to_staff` are both service-role-only and do **not** appear in the
executable-by-anon/authenticated lists).

---

## 2. Review of the Stage-7 P1 attack surface

Each new/changed surface, its threat model, the controls, and residual risk.

### `api.delete_account` (self-serve deletion)

- **Threats:** deleting someone else's account; destroying business records;
  orphaning FK rows; a hijacked session nuking an account.
- **Controls:** service-role-only EXECUTE (verified by grant test + advisors). The
  server fn requires CSRF + a verified session + **password re-auth** (throwaway-
  client probe, never the live session) for password accounts; OAuth-only accounts
  are gated by the session + explicit confirm. Staff accounts are refused (server +
  the RPC's own guard). Orders are **anonymized to guest ownership** (records
  preserved, `user_id`→NULL with a fresh tracking hash, XOR intact) rather than
  deleted; personal data cascades. Atomic (one transaction). Audited.
- **Residual risk:** low. A valid live session + (for password users) the current
  password is required — equivalent to the password-change gate (F-11).

### `api.promote_to_staff` (F-14)

- **Threats:** privilege escalation — a non-owner minting staff/owner; promoting an
  arbitrary account; last-owner invariant bypass.
- **Controls:** service-role-only. The server fn enforces `requireRole` (admin to
  create staff, **owner** to create admin/owner) + **MFA step-up** + rate limit.
  The email→id resolution is server-side SQL (no `listUsers` blind spot). The
  `guard_owner_safety` trigger remains the row-level backstop. Audited
  (`staff.promoted` + canonical `staff.provisioned`).
- **Residual risk:** low. Same authorization envelope as the existing invite path;
  promotion cannot exceed the caller's role.

### Identity linking (`account-security.server.ts`)

- **Threats:** linking an attacker's OAuth identity to a victim; unlinking the
  victim's last sign-in method (lockout); CSRF; spray abuse.
- **Controls:** all ops run on the **caller's own session** client (act on self
  only) + CSRF + rate limit (`accountWrite`/`accountRead`/`oauthStart`). Unlink
  refuses to remove the last identity when no password exists. Only
  provider-configured OAuth is offered. Manual linking is gated by a Supabase
  dashboard toggle (fails closed with a friendly message).
- **Residual risk:** low, and linking is inert until the owner enables Manual
  Linking. Recommend a real-browser confirmation of the link round-trip once on.

### CSP nonce / strict Report-Only (P1a)

- **Threats:** XSS via inline script (the `unsafe-inline` gap); a broken flip
  taking the site down.
- **Controls:** enforced policy unchanged (no regression); strict policy rides
  **Report-Only** with a per-request nonce + `strict-dynamic`; violations collected
  at `/api/csp-report` (rate-limited, size-capped, no PII). Live-verified: header
  nonce == all script nonces == `csp-nonce` meta, zero un-nonced scripts.
- **Residual risk:** the `unsafe-inline` gap remains **until** `CSP_ENFORCE_STRICT=true`
  is set after the Report-Only watch period (tracked owner action).

### Rate-limit coverage (P1b)

- Every `createServerFn` is classified and the classification is **test-enforced**
  (`rate-limit-coverage.test.ts`), so a new unthrottled mutation cannot ship
  silently. The audit itself found + fixed three unthrottled account-security ops.

---

## 3. Cross-cutting checks (spot-reviewed, no defects)

- **Capability tokens** (guest order token, newsletter unsubscribe): compared
  server-side, high-entropy, not oracular — no IDOR.
- **Webhook secrets** (courier): timing-safe compare; disabled (503) when unset;
  body size capped on the read body, not the spoofable `content-length`.
- **CSRF:** every state-changing server fn checks origin (confirmed via the
  coverage audit + guard helpers).
- **PII in logs:** `safeServerLog` used throughout; the CSP collector logs only a
  trimmed directive + blocked-uri, never document context.
- **`VITE_` exposure:** no secret is `VITE_`-prefixed;
  `VITE_SUPABASE_SERVICE_ROLE_KEY` does not exist (would ship to the browser).

---

## 4. Accepted-risk register (summary)

| #   | Risk                                                 | Why accepted / mitigation                                                               |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | RPC-only tables have no RLS policy                   | Deny-all is the intended posture; access is via service-role RPCs only.                 |
| 2   | 6 public `SECURITY DEFINER` reads callable by anon   | Deliberate public reads; visible-rows-only, no writes, no PII.                          |
| 3   | `unsafe-inline` still in the enforced CSP            | Removed via the Report-Only→enforce flip (`CSP_ENFORCE_STRICT`) after the watch period. |
| 4   | Leaked-password protection off                       | **Open owner action** — enable in dashboard before broader auth use.                    |
| 5   | Historical credential exposure (Stage 1 git history) | Rotate at the P7 go-live cut-over (`stage-7-secrets-and-rotation.md`).                  |
| 6   | No third-party pen test                              | Self-review done; external test recommended post-launch.                                |

Items 4 and 5 are go-live actions; the rest are steady-state accepted posture.
