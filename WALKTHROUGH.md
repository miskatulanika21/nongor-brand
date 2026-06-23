# WALKTHROUGH — actual data flows

Reflects what the code does today (after Stage 2 Pass 2 final closure). Updated each
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

## Staff mutations (Bugs 1 + 3, Item D + follow-up) — migration applied, `api` exposed

`provisionStaff` / `updateStaffRole` / `setStaffActive` (`staff.api.ts`):
CSRF → **baseline `requireRole("admin")` FIRST** (before the service-role client
is built or `staff_profiles` is queried — no existence oracle for unauthorized
callers) → target lookup → owner elevation via the already-resolved actor role →
**`requireStepUp(role)`** (AAL2, only when `ENFORCE_ADMIN_MFA=true`) →
**`admin.schema("api").rpc(...)`**. The `api.*` wrapper delegates to the
`private.*` function, which performs the staff_profiles mutation AND the canonical
`audit_logs` INSERT in the SAME transaction (no EXCEPTION handler → commit or roll
back together). A supplementary best-effort `writeAudit('staff.invited')` records
the auth.users side-effect only. `authz.denied` audits carry the verified actor id
(null only when unauthenticated).

## MFA enrollment (follow-up hardening)

`startMfaEnrollment` (`performStartMfaEnrollment`): CSRF → strict staff identity →
independent per-IP/per-account rate limit (`mfaEnroll`) → `listFactors`. If a
VERIFIED factor exists, an AAL2 session is required to add another (an aal1
session cannot attach a factor). Stale UNVERIFIED factors are `unenroll`-ed so
they cannot pile up. Initiation/denial/failure are audited with NO secret/QR in
metadata.

## Startup env validation (follow-up hardening)

`server.ts` fetch → `ensureEnvValidated()` (in `env.server.ts`): validates once,
recording success ONLY after `validateEnvAtStartup()` completes — a failed
validation does not latch, so later requests are not silently bypassed.

## Last-owner protection (Item C) — applied

Any UPDATE/DELETE on `staff_profiles` fires `private.guard_owner_safety()`, which
now takes `pg_advisory_xact_lock(...)` BEFORE counting other active owners, so
concurrent owner-removing transactions are serialized and the last owner cannot
be removed even under a race.

## Audit-log visibility (Bug 4) — applied

`admin_read_audit_logs` RLS allows SELECT only when
`private.current_staff_role() = 'owner'`, matching `audit.view` being owner-only
in `permissions.ts`. Admins can no longer read `audit_logs` directly.

## Storefront catalog (Stage 2 Pass 1) — live

Route loaders call `catalog.api.ts` server fns → `catalog.server.ts` repository
(per-request ANON client, RLS-enforced, no mock fallback) → `catalog-map.ts`
maps rows to `Product`. Shop, index, PDP, search, cart, wishlist, sitemap read
from the `product_*` tables. Cart/wishlist hold ids only in `localStorage`.

## Admin catalog writes (Stage 2 Pass 2) — live

All admin catalog mutations share one guard: `guardAdminWrite(permission, op)`
(`admin-guard.server.ts`) → no-store headers → CSRF → `requirePermission(..,
{strict})` → MFA step-up (when `ENFORCE_ADMIN_MFA`) → per-IP/account rate limit
(`catalogWrite`) → audited denial. Reads (`products.view`) also set no-store.

- **Products** (`admin.products.tsx` → `catalog-admin.api.ts` →
  `catalog-admin.server.ts`): list/edit load all statuses via the service-role
  repository. Save routes through `api.save_product` (mutation + canonical
  `product.created/updated` audit in one txn); `code` is an independent immutable
  id (never the slug); the editor's stock is read-only (owned by Inventory);
  status comes from the selector. Removal is **Archive** (`api.set_product_status`)
  — permanent delete/bulk-delete are not in the UI.
- **Categories** (`admin.categories.tsx`): `api.save_category` /
  `set_category_active` / `delete_category` (all with canonical audit); reorder is
  one atomic statement via `api.reorder_categories`. Product counts come from the DB.
- **Inventory** (`admin.inventory.tsx`): stock is canonical. `products.stock` can
  change ONLY via `api.set_inventory` (a DB trigger blocks any other stock write),
  which locks the product row (`FOR UPDATE`), requires an active staff actor,
  enforces sized/non-sized, rejects zero-delta, and writes a movement + canonical
  `inventory.adjusted` audit in one txn. The movement ledger is append-only
  (UPDATE/DELETE blocked) and deleting a product with history is blocked (FK
  RESTRICT). Bulk uses `api.bulk_set_inventory` (bounded 1..100, idempotent op_key,
  structured partial-success). Variants are managed via `api.add_product_variant`
  / `remove_product_variant`. DB-level guarantees verified by reproducible
  rolled-back SQL proofs (see the Stage-2 hardening report).

## CI

`.github/workflows/ci.yml` runs on push to `main` and all PRs: Bun (pinned
1.3.14) frozen install → typecheck → lint → format:check → test → build (all
mandatory). A `migrations-local` job applies every migration to a fresh LOCAL
Supabase DB (Docker, no creds) — the authoritative migrate-from-empty check. A
separate advisory job runs `supabase db lint --linked` only when
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_ID` + `SUPABASE_DB_PASSWORD` are
configured; otherwise it skips with a visible notice (it lints the DEPLOYED DB
and does not validate pending migrations). **Currently those secrets are NOT set,
so the linked-lint step SKIPS on every run** — job "success" with that step
skipped is not a passing lint.

## Still mock / localStorage (later stages)

Orders, checkout, payments, coupons, customer profiles/addresses/measurements,
courier, reviews moderation, CMS, newsletter, reports, site settings. See
`CURRENT_STATUS.md`.
