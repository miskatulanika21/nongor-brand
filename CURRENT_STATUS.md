# CURRENT_STATUS — Nongorr Studio

Authoritative record of verified project state. Code and live-environment
behavior are the source of truth; this file is updated after every stage.

_Last updated: 2026-06-22 (Stage 1.5 code complete; migration pending apply)._

## Reproducible command output (this commit)

| Command            | Result                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| `tsc --noEmit`     | clean                                                                       |
| `eslint .`         | 0 errors, 31 warnings (pre-existing `react-refresh/only-export-components`) |
| `prettier --check` | clean                                                                       |
| `vitest run`       | 181 passed / 13 files                                                       |
| `vite build`       | success                                                                     |

## Stage status

| Stage       | Scope                                                                    | Status                                                                             |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1           | Auth, RBAC, CSRF, headers, rate limit, MFA scaffold, audit, owner-safety | Implemented                                                                        |
| 1.5         | Security closure (4 confirmed bugs)                                      | **Code complete; DB migration not yet applied; credential rotation pending owner** |
| 2 (Pass 1)  | DB-backed **public catalog read** path                                   | Implemented + applied to live project                                              |
| 2 (Pass 2+) | Admin catalog/inventory/media/settings **writes**                        | Not started                                                                        |
| 3           | Server-authoritative checkout, orders, payments                          | Not started                                                                        |
| 4           | Customer accounts / addresses / measurements                             | Not started (localStorage)                                                         |
| 5           | Courier adapters, shipments, webhooks, outbox                            | Not started                                                                        |
| 6           | Reviews, banners, CMS, contact, newsletter, reports, settings            | Not started (mock)                                                                 |
| 7           | Hardening, perf/a11y, CI/CD, backups                                     | Not started                                                                        |

## Stage 1.5 — confirmed bugs

| Bug                                   | Severity | Code                                 | Live verification                             |
| ------------------------------------- | -------- | ------------------------------------ | --------------------------------------------- |
| 1 — staff RPC schema (`api` wrappers) | CRITICAL | Fixed                                | Pending migration apply + expose `api` schema |
| 2 — invite confirm type               | CRITICAL | Fixed                                | Pending real-email E2E                        |
| 3 — AAL2 step-up on staff mutations   | HIGH     | Fixed (gated by `ENFORCE_ADMIN_MFA`) | Pending MFA rollout                           |
| 4 — audit RLS owner-only              | MEDIUM   | Fixed                                | Pending migration apply                       |

See `docs/stage-1.5-security-closure-report.md` for detail and deploy steps.

## Real vs mock (data flow)

**Real / persistent (DB-backed):**

- Auth, staff RBAC roles (`staff_profiles`), audit logs (`audit_logs`).
- Public catalog read: products, categories, media, size-stock, reviews
  (`product_*` tables) — storefront, PDP, search, sitemap.

**Still mock / localStorage-only (Phase 2 scope):**

- Admin catalog writes (admin UI still reads the `PRODUCTS` array; shows
  "preview/mock" badges).
- Orders, cart, wishlist, checkout state, coupons; payment screenshots/TrxID.
- Customer profiles, saved addresses, saved measurements (`account-ui.tsx`).
- Courier (Steadfast/Pathao), reviews moderation, banners, CMS, contact,
  newsletter, reports, site settings; business contact placeholders.

## Migrations

10 migration files in `supabase/migrations/`. Files `…143927` through
`…090000` (Stage 1, 8 files) and `20260622000000_catalog_schema.sql` are
applied to the live project. `20260622120000_stage_1_5_security_closure.sql` is
**committed but not yet applied**. Pre-existing naming drift on the harden
migration (`…165800` local vs `…165913` remote, identical body) is flagged, not
rewritten. Always confirm with `supabase migration list` — repo files do not
prove remote application.

## Outstanding (owner / operator) actions

1. Apply the Stage 1.5 migration and expose the `api` schema in PostgREST.
2. Rotate & revoke all Stage 1-committed credentials in each provider dashboard.
3. Complete the MFA rollout, then set `ENFORCE_ADMIN_MFA=true`.
