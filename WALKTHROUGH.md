# WALKTHROUGH — actual data flows

Reflects what the code does today (after Stage 1.5 code completion). Updated each
stage. Where a flow depends on a pending migration, that is called out.

## Request → response security wrapper

`src/server.ts` `fetch()` → render via TanStack Start → `normalizeCatastrophicSsrResponse`
→ **`withSecurityHeaders(response, isProduction())`** which returns a NEW Response
with a cloned `Headers` (security headers added; CSP on HTML only; HSTS in prod).
Status/statusText/body (incl. streaming) and all `Set-Cookie` entries are
preserved. No try/catch swallow: a failure surfaces to the outer catch, which
returns a safe error page that is ALSO passed through `withSecurityHeaders`.

## Auth — privileged login

`performEmailLogin` (`auth.api.ts`): CSRF origin check →
**`checkIndependentRateLimit("login", { ip, account: email })`** (separate per-IP
and per-account buckets, both must pass; fail-open on limiter outage) →
`signInWithPassword` → resolve verified identity (`getUser`, strict) →
role-aware destination. Register / password-reset / password-update / MFA-verify /
staff-provision use the same independent-bucket helper. `getClientIp` documents
the trusted-proxy boundary (platform-authoritative source preferred; IP is a
rate-limit dimension only, never authz).

## Auth — staff invitation (Bug 2 path)

`provisionStaff` → `inviteUserByEmail(redirectTo=/auth/confirm?type=invite)` →
invitee clicks link → `auth.confirm.tsx` (allowlist now includes `invite`) →
`performEmailConfirm` `verifyOtp({ type: "invite" })` → routed to
`/auth/update-password` to set an initial password → role-aware redirect to admin.

## Staff mutations (Bugs 1 + 3, Item D) — needs `20260622120000` applied

`provisionStaff` / `updateStaffRole` / `setStaffActive` (`staff.api.ts`):
CSRF → `requireRole(...)` → **`requireStepUp(role)`** (AAL2, only when
`ENFORCE_ADMIN_MFA=true`) → **`admin.schema("api").rpc(...)`**. The `api.*` wrapper
delegates to the `private.*` function, which performs the staff_profiles mutation
AND the canonical `audit_logs` INSERT in the SAME transaction (no EXCEPTION
handler → they commit or roll back together). A supplementary best-effort
`writeAudit('staff.invited')` records the auth.users side-effect only.

## Last-owner protection (Item C) — needs `20260622130000` applied

Any UPDATE/DELETE on `staff_profiles` fires `private.guard_owner_safety()`, which
now takes `pg_advisory_xact_lock(...)` BEFORE counting other active owners, so
concurrent owner-removing transactions are serialized and the last owner cannot
be removed even under a race.

## Audit-log visibility (Bug 4) — needs `20260622120000` applied

`admin_read_audit_logs` RLS allows SELECT only when
`private.current_staff_role() = 'owner'`, matching `audit.view` being owner-only
in `permissions.ts`. Admins can no longer read `audit_logs` directly.

## Storefront catalog (Stage 2 Pass 1) — live

Route loaders call `catalog.api.ts` server fns → `catalog.server.ts` repository
(per-request ANON client, RLS-enforced, no mock fallback) → `catalog-map.ts`
maps rows to `Product`. Shop, index, PDP, search, cart, wishlist, sitemap read
from the `product_*` tables. Cart/wishlist hold ids only in `localStorage`.

## CI

`.github/workflows/ci.yml` runs on push to `main` and all PRs: Bun frozen
install → typecheck → lint → format:check → test → build (all mandatory). A
separate advisory job runs `supabase db lint --linked` only when project
credentials are configured; otherwise it skips with a visible notice.

## Still mock / localStorage (later stages)

Orders, checkout, payments, coupons, customer profiles/addresses/measurements,
courier, reviews moderation, CMS, newsletter, reports, site settings. See
`CURRENT_STATUS.md`.
