# Stage 1.5 — Security Closure Report

Status legend used throughout: **(1) code complete** · **(2) migration applied
to live project** · **(3) deployed verification complete** · **(4) operator
action pending**.

This stage closes the four confirmed Stage 1 defects **and** the five additional
mandatory Stage 1.5 items (A–E). Code is complete and the full quality suite is
green; the two new migrations are committed but **not yet applied** to the live
project, and credential rotation / MFA rollout remain operator actions.

## Quality suite (this commit)

| Check              | Result                                              |
| ------------------ | --------------------------------------------------- |
| `tsc --noEmit`     | clean                                               |
| `eslint .`         | 0 errors (31 pre-existing `react-refresh` warnings) |
| `prettier --check` | clean                                               |
| `vitest run`       | 193 passed / 15 files (+12 new)                     |
| `vite build`       | success (client + server)                           |

---

## Part 1 — The four confirmed bugs

### Bug 1 — Staff RPCs target the wrong schema (CRITICAL) — code complete (1)

`staff.api.ts` called `admin.rpc("provision_staff" | "update_staff_role" |
"set_staff_active", …)`. Those live in the unexposed `private` schema, so the
calls resolved to `public.*` (non-existent) and 404 on a live project.

**Fix:** migration `20260622120000_stage_1_5_security_closure.sql` adds an `api`
schema with three `SECURITY DEFINER` wrappers (text role param cast internally)
that delegate to `private.*`; `EXECUTE` granted to `service_role` only.
`staff.api.ts` calls `admin.schema("api").rpc(...)`. (Full rationale below in the
original Bug-1 section is unchanged from the prior commit.)

### Bug 2 — Invitation type rejected (CRITICAL) — code complete (1)

`"invite"` added to `ALLOWED_CONFIRM_TYPES` (`validation.ts`), the route
allowlist (`auth.confirm.tsx`), and `authTokenConfirmSchema` (`auth.api.ts`);
handled like `recovery` so the invitee sets an initial password. Unit test
asserts acceptance.

### Bug 3 — MFA not enforced on staff mutations (HIGH) — code complete (1)

`requireStepUp()` (AAL2) runs in all three staff mutations, gated by
`ENFORCE_ADMIN_MFA` so it cannot lock out an un-enrolled owner.

### Bug 4 — Audit RLS broader than registry (MEDIUM) — code complete (1)

The `20260622120000` migration tightens `admin_read_audit_logs` to owner-only,
matching `OWNER_ONLY_PERMISSIONS["audit.view"]`.

---

## Part 2 — The five mandatory items (A–E)

### A — Security-header Response reconstruction — code complete (1), tested

- `headers.server.ts`: `applySecurityHeaders(response): void` (in-place mutation)
  replaced by `withSecurityHeaders(response, isProd): Response` — clones headers
  into a fresh `Headers`, sets the security headers, and returns a NEW `Response`
  preserving `status`, `statusText`, body (including streaming), all existing
  headers and multiple `Set-Cookie` entries.
- `server.ts`: both call sites now `return withSecurityHeaders(...)` and the
  `try { … } catch {}` that **swallowed** header-application failures is removed.
  A failure now falls through to the outer catch, which returns a safe error page
  WITH headers — never an unprotected response.
- Tests (`src/lib/__tests__/headers.test.ts`, 7): baseline headers on HTML; CSP
  only on HTML; HSTS only in prod; status + statusText preserved; redirect status
  - `Location` preserved; **two `Set-Cookie` headers preserved**; **streaming body
    preserved** (read back intact).
- Operator action (4): after deploy, confirm headers on the live origin, e.g.
  `curl -sI https://<domain>/ | grep -iE 'content-security-policy|strict-transport|x-frame-options|x-content-type-options|referrer-policy|permissions-policy'`.

### B — Independent per-IP and per-account rate limits — code complete (1), tested

- `rate-limit.server.ts`: new `checkIndependentRateLimit(action, { ip, account })`
  runs **two separate buckets** (`action:ip:<ip>` and `action:account:<id>`) and
  requires BOTH to pass. The account id is normalized (trim + lowercase). It
  inherits the documented fail-open policy (a limiter outage must not lock
  everyone out of auth — the accepted tradeoff for availability of login).
- Switched off the combined `ip|email` key at every account-bearing auth op:
  `login`, `register`, `passwordReset` (account = email) and `passwordUpdate`,
  `mfaVerify` ×2, `staffProvision` (account = user/actor id). `oauthStart` stays
  IP-only (single dimension, no combined-key weakness).
- Trusted-proxy boundary documented on `getClientIp` (`security.server.ts`):
  prefer the platform-authoritative source (`cf-connecting-ip` on Cloudflare,
  `x-real-ip` / platform header otherwise); `x-forwarded-for` first hop is correct
  only behind a single trusted proxy and must not be trusted on a raw
  internet-facing port. The IP is a rate-limit dimension only, never authz, and
  the per-account bucket is the backstop when the IP is unreliable/spoofable.
- Tests (`src/lib/__tests__/rate-limit.test.ts`, 5): per-account bucket blocks
  under IP rotation; per-IP bucket blocks under account rotation; account
  normalization (case + whitespace share one bucket); both-under-limit allows;
  anonymous bucket still enforced when no identifiers are supplied.

### C — Concurrency-safe last-owner protection — code complete (1)

- Migration `20260622130000_owner_safety_advisory_lock.sql` `CREATE OR REPLACE`s
  `private.guard_owner_safety()` (migration 8 is **not** edited) to acquire a
  transaction-level advisory lock **before** the remaining-active-owner count, on
  every UPDATE (demotion/deactivation) and DELETE path:
  `PERFORM pg_advisory_xact_lock(hashtext('private.guard_owner_safety'));`
- This serializes concurrent owner-removing transactions so two demotions of
  different owners can no longer both pass a stale `count(*)`. The lock is
  xact-scoped (auto-released); the staff table is tiny so contention is
  negligible.
- Verification (4) — reproducible two-session SQL procedure (run against the
  project after the migration is applied; no live DB access in CI):

  ```sql
  -- Session A
  BEGIN;
  UPDATE public.staff_profiles SET role = 'admin'
    WHERE user_id = :ownerA;            -- acquires the advisory lock, holds it
  -- (do NOT commit yet)

  -- Session B (blocks on the advisory lock until A finishes)
  BEGIN;
  UPDATE public.staff_profiles SET role = 'admin'
    WHERE user_id = :ownerB;            -- waits for A

  -- Session A
  COMMIT;                               -- A succeeds (ownerB still active)

  -- Session B unblocks, re-reads an ACCURATE count (0 other active owners) and
  -- is correctly refused:
  -- ERROR: Cannot demote or deactivate the last active owner
  ```

### D — Critical audit reliability — code complete (1), proven transactional

Per the accepted correction: **no redundant outbox** is built because the
canonical audit row is already written inside the same PostgreSQL transaction as
each critical mutation. The six required confirmations:

1. **Same transaction.** Each RPC (migration 8) performs the mutation and the
   canonical audit INSERT in one PL/pgSQL function body (one transaction):

   ```sql
   -- private.update_staff_role()  (excerpt, migration 8)
   UPDATE public.staff_profiles
     SET role = p_new_role, updated_at = now()
     WHERE user_id = p_target_user_id
     RETURNING jsonb_build_object('user_id', user_id, 'role', role) INTO v_result;

   INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
   VALUES (p_actor_id, 'staff.role_changed', 'staff_profiles', p_target_user_id::text,
     jsonb_build_object('from', v_old_role::text, 'to', p_new_role::text));
   ```

   `provision_staff` (`INSERT staff_profiles` + `'staff.provisioned'`) and
   `set_staff_active` (`UPDATE staff_profiles` + `'staff.activated'|'deactivated'`)
   follow the identical mutation-then-audit shape.

2. **No swallow.** None of the three functions contains a `BEGIN … EXCEPTION …`
   block; the audit INSERT is not wrapped in any handler.
3. **Failure rolls back the mutation.** Because the function has no EXCEPTION
   handler and runs in the caller's transaction, a failed audit INSERT raises and
   aborts the whole function — the staff mutation cannot commit without its audit
   row. Reproducible proof:

   ```sql
   -- 1. Record the committed role.
   SELECT role FROM public.staff_profiles WHERE user_id = :target;          -- e.g. 'staff'

   -- 2. Force every audit INSERT to fail.
   CREATE OR REPLACE FUNCTION private._force_audit_fail() RETURNS trigger
     LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced audit failure'; END; $f$;
   CREATE TRIGGER zz_force_audit_fail BEFORE INSERT ON public.audit_logs
     FOR EACH ROW EXECUTE FUNCTION private._force_audit_fail();

   -- 3. Call the RPC — must ERROR 'forced audit failure'.
   SELECT private.update_staff_role(:actor, :target, 'admin');

   -- 4. Remove the probe.
   DROP TRIGGER zz_force_audit_fail ON public.audit_logs;
   DROP FUNCTION private._force_audit_fail();

   -- 5. Re-read the role — STILL 'staff': the UPDATE rolled back with the
   --    failed audit INSERT, proving atomicity.
   SELECT role FROM public.staff_profiles WHERE user_id = :target;          -- 'staff'
   ```

4. **No mutation outside the RPCs.** In the runtime app (`src/`),
   `staff_profiles` is only ever `SELECT`ed; every insert/update/delete goes
   through the three RPCs (verified by grep). The only direct write anywhere is
   `scripts/e2e-auth-test.ts` (an operator E2E test script, not a runtime path);
   the DB-level `guard_owner_safety` trigger still protects it, though it bypasses
   audit — acceptable for test-only tooling and flagged here. (`scripts/` also
   still call unqualified `admin.rpc("provision_staff")`; updating operator
   scripts to `.schema("api")` is a noted follow-up, outside this stage's runtime
   scope.)
5. **Supplementary vs canonical.** The best-effort `writeAudit()` path is now
   documented (`audit.server.ts`) as supplementary/non-critical only; the
   `'staff.invited'` call in `provisionStaff` is annotated as supplementary (the
   canonical record is the transactional `'staff.provisioned'`).
6. **Evidence:** confirmations 1–3 above (SQL excerpts + rollback procedure).

### E — CI pipeline — code complete (1)

`.github/workflows/ci.yml`:

- Triggers: push to `main` and all pull requests.
- `concurrency: cancel-in-progress` on `workflow + ref`.
- `permissions: contents: read` (least privilege).
- Bun via `oven-sh/setup-bun@v2`; `bun install --frozen-lockfile`.
- **Mandatory** core steps (separate, no silent failures): `typecheck`, `lint`,
  `format:check`, `test`, `build`.
- Advisory `supabase-lint` job: runs only on `push` (never fork PRs → no secret
  exposure); detects `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_ID` and, when
  absent, **skips with a visible `::notice::`** rather than a misleading passing
  no-op; when present, links the project and runs `supabase db lint --linked`.

---

## Migrations

11 local migration files. **9 applied** to the live project (8 Stage 1 + the
catalog migration). **2 pending apply:**

- `20260622120000_stage_1_5_security_closure.sql` (Bug 1 `api` wrappers + Bug 4
  audit RLS)
- `20260622130000_owner_safety_advisory_lock.sql` (Item C; documents Item D)

After both are applied, the synchronized count is **11**, subject to the
documented pre-existing filename drift on the harden migration (`…165800` local
vs `…165913` remote, identical body). Always confirm with `supabase migration
list`.

## Operator-only actions remaining (4)

1. Apply both pending migrations; expose the `api` schema in PostgREST (keep
   `private` hidden); confirm 11 synchronized via `supabase migration list`.
2. `curl -I` the deployed origin to confirm security headers (Item A).
3. Run the Item C concurrency SQL procedure and the Item D rollback procedure
   against the live project.
4. Rotate & revoke all Stage 1-committed credentials; complete the MFA rollout,
   then set `ENFORCE_ADMIN_MFA=true`.

## Rollback

- Code: `git revert` this commit (header rebuild → prior mutation; independent
  limits → combined key; doc/comment changes revert harmlessly).
- DB: the advisory-lock migration can be reverted by `CREATE OR REPLACE`-ing
  `private.guard_owner_safety` back to its migration-8 body (no advisory lock);
  the `api`/audit-RLS migration rolls back via `DROP SCHEMA api CASCADE;` and
  recreating `admin_read_audit_logs` with the prior `IN ('owner','admin')`
  predicate. Stage 1 objects and `private.*` functions are untouched.
- CI: delete `.github/workflows/ci.yml`.
