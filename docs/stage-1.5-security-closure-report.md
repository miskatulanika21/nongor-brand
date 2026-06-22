# Stage 1.5 — Security Closure Report

Status: **Code complete, type-checked, linted, formatted, unit-tested (181
passing, +1 new), production build green.** The accompanying database migration
is **written and committed but NOT yet applied to the live Supabase project** —
see "Deploy steps required" below. Credential rotation remains an owner action.

This stage fixes the four confirmed Stage 1 defects called out in the Phase 2
(V3) prompt. Two V3 "weaknesses" are intentionally deferred (tracked below).

---

## Bug 1 — Staff RPCs target the wrong schema (CRITICAL) — FIXED (code)

`staff.api.ts` called `admin.rpc("provision_staff" | "update_staff_role" |
"set_staff_active", …)`. Those functions live in the `private` schema, which is
deliberately not exposed via PostgREST, so the calls resolved to `public.*`
(non-existent) and would fail with "function not found" on any live project.

**Fix:**

- New migration `supabase/migrations/20260622120000_stage_1_5_security_closure.sql`
  creates an `api` schema with three thin `SECURITY DEFINER` wrappers
  (`api.provision_staff`, `api.update_staff_role`, `api.set_staff_active`) that
  delegate to the existing `private.*` functions. `search_path = ''`, `EXECUTE`
  revoked from `PUBLIC`/`anon`/`authenticated` and granted to `service_role`
  only; `USAGE` on the schema granted to `service_role` only.
- Wrappers take the role as `text` and cast to `private.staff_role` internally so
  PostgREST never introspects an enum in a non-exposed schema.
- `staff.api.ts` now calls `admin.schema("api").rpc(...)` for all three.

**Why no in-function role recheck:** these are reached only through the
service-role admin client, which carries no `auth.uid()`, so
`private.current_staff_role()` is null in this context and a role recheck is
impossible here. The boundary is enforced by (1) `requireRole()` +
`requireStepUp()` in `staff.api.ts`, (2) `EXECUTE` granted to `service_role`
only, and (3) the `private.guard_owner_safety` trigger at the row level. The
`private` schema stays hidden.

## Bug 2 — Staff invitation type rejected by confirm route (CRITICAL) — FIXED

Invitations were sent with `redirectTo=…/auth/confirm?type=invite`, but
`ALLOWED_CONFIRM_TYPES` did not include `"invite"`, so the link always rendered
"Invalid confirmation link." (Option A from the prompt.)

**Fix:**

- `"invite"` added to `ALLOWED_CONFIRM_TYPES` (`validation.ts`), the route
  allowlist (`auth.confirm.tsx`), and the `authTokenConfirmSchema` enum
  (`auth.api.ts`).
- In `performEmailConfirm`, `invite` is handled alongside `recovery`: after
  `verifyOtp({ type: "invite" })` the invitee is routed to
  `/auth/update-password` to set an initial password, then the existing
  role-aware post-update redirect lands them in the admin area.
- New unit test asserts `authConfirmSchema` accepts `type: "invite"`.

## Bug 3 — MFA not enforced on privileged operations (HIGH) — FIXED (gated)

`requireAssuranceLevel()` existed but was never called from `staff.api.ts`.

**Fix:** a `requireStepUp(role)` helper now runs in `provisionStaff`,
`updateStaffRole`, and `setStaffActive` before the mutation. It is gated by
`isAdminMfaEnforced()` (`ENFORCE_ADMIN_MFA=true`) — mirroring the existing
`loadAdminArea` route guard — so:

- With enforcement **off** (default): no behavior change; the owner cannot be
  locked out before enrolling a TOTP factor.
- With enforcement **on**: an owner/admin on a first-factor (aal1) session is
  refused these operations until they complete the MFA challenge.

Enabling enforcement is a deliberate go-live step (see rollout order in the V3
prompt §"Enforce AAL2"). Do not flip `ENFORCE_ADMIN_MFA=true` until every owner
has enrolled and verified recovery.

## Bug 4 — Audit-log RLS broader than the permission registry (MEDIUM) — FIXED (code)

RLS `admin_read_audit_logs` allowed `owner` **and** `admin`, but
`permissions.ts` lists `audit.view` in `OWNER_ONLY_PERMISSIONS`. The same
migration drops and recreates the policy as **owner-only**
(`private.current_staff_role() = 'owner'`), making the database match the single
source of truth.

---

## Deploy steps required (owner / operator)

The code is merged, but the live environment still needs:

1. **Apply the migration** `20260622120000_stage_1_5_security_closure.sql` to the
   target project (`supabase db push` / CLI / MCP). Verify with
   `supabase migration list`.
2. **Expose the `api` schema** in PostgREST — Dashboard → Project Settings → API
   → Exposed schemas (add `api`; keep `private` excluded), or the `[api] schemas`
   array for CLI deploys. Without this, `.schema("api").rpc(...)` returns 404.
3. **Rotate & revoke** all credentials committed in Stage 1 (`.env`): Supabase
   service-role/anon keys, Steadfast, Pathao prod + sandbox. Confirm in each
   provider dashboard.
4. **MFA rollout** before setting `ENFORCE_ADMIN_MFA=true`: owner enrolls TOTP →
   verifies recovery → confirms an aal2 session reaches admin → then enable.

## Verification (this commit)

| Check              | Result                                              |
| ------------------ | --------------------------------------------------- |
| `tsc --noEmit`     | clean                                               |
| `eslint .`         | 0 errors (31 pre-existing `react-refresh` warnings) |
| `prettier --check` | clean                                               |
| `vitest run`       | 181 passed / 13 files (+1 new)                      |
| `vite build`       | success (client + server)                           |

DB-level behavior (RLS owner-only, `api` wrappers reachable, full invite E2E)
must be verified against the live project after the deploy steps above.

## Intentionally deferred (V3 weaknesses — not in this stage)

- Independent per-IP / per-account rate-limit keys (currently combined key).
- `applySecurityHeaders` rebuild-vs-mutate pattern.
- `guard_owner_safety` concurrency serialization (`SELECT … FOR UPDATE` /
  advisory lock).
- Transactional / outbox audit writes for critical operations.
- CI pipeline.

## Rollback

- Code: `git revert` this commit (RPC calls return to unqualified `.rpc(...)`,
  invite type removed, step-up gate removed).
- DB: `DROP SCHEMA api CASCADE;` and re-create `admin_read_audit_logs` with the
  prior `IN ('owner','admin')` predicate. The `private.*` functions and Stage 1
  objects are untouched.
