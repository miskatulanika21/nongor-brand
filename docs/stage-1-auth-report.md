# Stage 1 — Authentication, Role Routing & RBAC: Delivery Report

Status: **Implemented, type-checked, linted, unit-tested (126 passing), production
build green, HTTP-level guard/redirect/header verification passed.** Live
privileged (staff/admin/owner) browser E2E is the one remaining go-live step —
deferred by decision because it must run against a dedicated non-production
Supabase project, not the real one.

---

## 1. Authentication issues found (and fixed)

| #   | Issue                                                                                         | Fix                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `getLoginIdentity()` caught any staff-lookup error and returned **customer** (fail-open).     | New `getAuthenticatedIdentity()` distinguishes "no row" (customer) from "query error" (`lookup_failed` → **fail closed**). |
| 2   | Inactive staff were silently downgraded to **customer**.                                      | Inactive profile now → `inactive_staff` denial: session invalidated, safe message, no customer access.                     |
| 3   | Staff/admin/owner could sit on `/account` with only an extra "Admin Dashboard" button.        | Customer guard now **redirects active staff to `/admin`**; the button anti-pattern is removed.                             |
| 4   | Login UI advertised "Phone number or email" + client phone validation; server only did email. | Field is now **"Email address"**, `type=email`, shared `loginSchema`; fake phone login removed.                            |
| 5   | Registration showed "Email (optional)" but server required it.                                | Label is **"Email address"** (required); client uses the shared `registerSchema`.                                          |
| 6   | OAuth callback defaulted **every** user to `/account` and bypassed role resolution.           | Callback now runs the **same** identity + destination resolver; inactive/fail-closed handled.                              |
| 7   | Two divergent redirect-safety validators (`isSafeRedirect` vs `isValidLoginDestination`).     | One canonical `src/lib/safe-redirect.ts`; both call sites delegate to it.                                                  |
| 8   | "Remember me" checkbox was decorative.                                                        | Removed (with documented reason — SSR single-cookie lifetime); layout kept clean.                                          |
| 9   | No per-role admin nav or per-page permission enforcement.                                     | Central permission registry + per-path server checks.                                                                      |
| 10  | `provision_staff` recorded the **target** as the audit actor.                                 | New signature takes `p_actor_id`; correct attribution; system actions flagged.                                             |

## 2. Security issues found (and fixed)

- **Fail-open identity** → fail-closed (above).
- **CSRF** compared host only → now compares the **full origin** (scheme + host + port) against an allowlist (`VITE_SITE_URL` + optional `ADDITIONAL_ALLOWED_ORIGINS`).
- **No rate limiting** → added on login, register, reset, password update, OAuth start, MFA verify, staff provisioning (pluggable in-memory / Upstash store).
- **No security headers** → CSP (scoped to self + Supabase + Google Fonts), HSTS (prod), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`.
- **Weak password policy** (min 6) → customer tier min 8 + weak denylist; **privileged tier** min 12 + mixed classes + denylist.
- **No MFA** → TOTP MFA foundation with owner/admin enforcement gate (flag-gated to avoid lockout).
- **No owner-safety** → last active owner cannot be demoted/deactivated/deleted (DB trigger + server checks).
- **Unsafe E2E script** reset permanent accounts to `Password123!` against the live project → replaced with an opt-in, dedicated-project, disposable-identity script.
- **Populated `.env`** in the tree → flagged for rotation (see §22); `.gitignore` hardened.

## 3. Files changed

- `src/lib/auth.api.ts` — rewired to central identity/destination/rate-limit/audit; added `startOAuth`, `loadCustomerArea`, `loadAdminArea`; `isSafeRedirect` re-exported.
- `src/lib/validation.ts` — customer + privileged password tiers, weak-password denylist.
- `src/lib/server/login-destination.server.ts` — permission-aware resolver; privileged-only-/admin rule; customer route-family allowlist.
- `src/lib/server/rbac.server.ts` — rebuilt on identity layer; `requireRole`, `requirePermission`, `hasPermission`.
- `src/lib/server/security.server.ts` — full-origin CSRF, `getClientIp`, `getAllowedOrigins`.
- `src/lib/server/env.server.ts` — `isProviderConfigured`, `isAdminMfaEnforced`, `validateEnvAtStartup`.
- `src/lib/server/supabase.server.ts` — (unchanged cookie security; verified HttpOnly/SameSite/Secure-in-prod).
- `src/routes/_site.login.tsx` — email-only login, required email register, OAuth buttons, notices, Remember-Me removed.
- `src/routes/_site.account.tsx` — `requireCustomer` guard; admin-dashboard button removed; notices.
- `src/routes/admin.tsx` — `loadAdminArea` guard; role-filtered nav; identity display.
- `src/routes/admin.staff.tsx` — real server-enforced provisioning/role/active + registry-driven matrix.
- `src/routes/admin.index.tsx` — permission-denied notice toast.
- `src/routes/auth.callback.tsx` / `auth.confirm.tsx` — central identity + destination resolution.
- `scripts/provision-admin.ts` — new RPC signature + privileged password policy.
- `src/server.ts` — security headers + boot env validation.
- `.env.example`, `.gitignore` — new config + hardened ignores.
- Tests: `validation.test.ts`, `login-destination.test.ts` updated.

## 4. New files

- `src/lib/safe-redirect.ts` — canonical redirect validator.
- `src/lib/permissions.ts` — permission registry + role grants.
- `src/lib/admin-routes.ts` — admin route→permission map + nav filtering.
- `src/lib/auth-config.ts` — public OAuth feature flags.
- `src/lib/auth-notices.ts` — generic guard-notice messages + hook.
- `src/lib/mfa.api.ts` — MFA enroll/verify/challenge/unenroll server functions.
- `src/lib/staff.api.ts` — staff list/provision/role/active server functions.
- `src/lib/server/identity.server.ts` — central identity resolver + guards.
- `src/lib/server/rate-limit.server.ts` — pluggable rate limiter.
- `src/lib/server/audit.server.ts` — audit writer.
- `src/lib/server/mfa.server.ts` — MFA policy + assurance-level gate.
- `src/lib/server/headers.server.ts` — security headers.
- `src/routes/admin.mfa.tsx` — MFA setup/challenge page.
- Tests: `safe-redirect.test.ts`, `permissions.test.ts`, `admin-routes.test.ts`.

## 5. Database migrations

- `supabase/migrations/20260621090000_staff_provisioning_and_owner_safety.sql`:
  - Owner-safety trigger (`guard_owner_safety`) — blocks demoting/deactivating/deleting the last active owner.
  - `provision_staff(p_user_id, p_role, p_display_name, p_actor_id, p_is_active)` — correct actor attribution; old 3-arg signature dropped.
  - `update_staff_role(actor, target, role)` and `set_staff_active(actor, target, active)` — audited, `service_role`-only.

Existing migrations (1–7) were already sound (private schema, hardened SECURITY DEFINER, RLS without recursion) and left intact.

## 6. Final login flow

1. `/login` (one page for all) → `loginWithEmail` → CSRF check → rate limit (IP+email) → `signInWithPassword`.
2. `getAuthenticatedIdentity({strict})` (getUser) → customer | staff | `inactive_staff` | `lookup_failed`.
3. Denials sign out + return a safe message; success → `resolvePostLoginDestination`.
4. Privileged success is audited; client navigates to the server-chosen destination.

## 7. Final identity-resolution flow

`getClaims`/`getUser` → user id → `staff_profiles` by **user id** → no row = customer · active row = role · inactive = denied (sign out) · query error = fail closed. Role is never read from the browser, a JWT parsed client-side, or OAuth email.

## 8. Final redirect matrix

| Identity          | next                                                  | Result                     |
| ----------------- | ----------------------------------------------------- | -------------------------- |
| Customer          | —                                                     | `/account`                 |
| Staff/Admin/Owner | —                                                     | `/admin`                   |
| Customer          | `/checkout`, `/account/*`, `/shop`, `/product/*`      | honored                    |
| Customer          | `/admin*`                                             | `/account` (+ "no access") |
| Customer          | non-approved path                                     | `/account`                 |
| Privileged        | `/account`, `/checkout`, any non-admin                | `/admin`                   |
| Privileged        | `/admin/<page>` with permission                       | honored                    |
| Privileged        | `/admin/<page>` without permission                    | `/admin`                   |
| Any               | external/`//`/`\\`/encoded/`javascript:`/`data:`/loop | rejected → default         |

## 9. Final role hierarchy

`owner (30) > admin (20) > staff (10)` — defined once in `auth-types.ts` (`meetsMinimumRole`) and `permissions.ts`.

## 10. Final permission matrix

Authoritative source: `src/lib/permissions.ts` (also rendered read-only in `/admin/staff`).

- **Staff:** dashboard, orders view/manage, customers view, courier view/manage, products view, inventory view/manage.
- **Admin:** all staff + customers manage, products/categories/inventory manage, payments view/verify, coupons, reviews, content/media/policies/sizes, reports, settings, staff view/manage. **No** audit/security/integrations/owner assignment.
- **Owner:** all permissions.

## 11. Admin navigation by role

Generated from the registry via `navForRole(role)` (sidebar + mobile menu). Forbidden links never render; the server guard still blocks direct URLs and the post-login resolver downgrades unpermitted `/admin/*` to `/admin`.

## 12. Customer-route protection

`loadCustomerArea` → unauth `/login?next=…` · active staff `/admin` · inactive `/login?notice=inactive` (signed out) · lookup error `/login?notice=verify` · customer allowed.

## 13. Admin-route protection

`loadAdminArea` (runs in `/admin` layout `beforeLoad` for every `/admin/*`) → unauth `/login?next=…` · customer `/account?notice=denied` · inactive signed out · lookup error fail closed · per-path permission else `/admin?notice=permission` · MFA gate when enforced. Provisioning/role/active server functions each re-authorize independently.

## 14. OAuth implementation status

Implemented and feature-gated (`VITE_ENABLE_GOOGLE_OAUTH`, `VITE_ENABLE_FACEBOOK_OAUTH`). `startOAuth` validates provider+`next`, builds the canonical `redirectTo`, returns the PKCE URL. `/auth/callback` exchanges the code then runs the **same** identity/destination resolver. Role is never granted from OAuth email. Buttons show "Unavailable" until enabled. **Dashboard step required** before turning on (see §27/§28).

## 15. MFA implementation status

TOTP foundation complete: enroll/verify/challenge/unenroll server functions, `/admin/mfa` UI, assurance-level gate, `requireAssuranceLevel` for sensitive actions, last-factor protection for required roles. Enforcement is flag-gated (`ENFORCE_ADMIN_MFA`, default off) so owners aren't locked out before TOTP is enabled in the dashboard and an owner enrolls. **Dashboard step required** (Authentication → enable MFA).

## 16. Password-reset status

Forgot-password → generic non-enumerating response, rate-limited. Reset link → `/auth/confirm?type=recovery` → `/account/update-password`. `updatePassword` verifies identity (getUser), applies the **privileged tier for staff**, audits privileged completion.

## 17. Email-verification status

Signup sends a confirm link → `/auth/confirm?type=email` → verify → central resolver → confirmed customer lands on `/account`. The public verification path never creates a staff profile.

## 18. Staff-provisioning status

Owner/admin-gated invite flow (`inviteUserByEmail` — no password handled/logged) + atomic `provision_staff` RPC with compensation on failure. Admin may create only `staff`; admin/owner creation requires owner. All changes audited with the real actor.

## 19. Owner safety rules

Last active owner cannot be demoted, deactivated, or deleted (DB trigger + server checks). Admin cannot assign owner or alter an owner row. Enforced server-side regardless of UI.

## 20. Audit-log behavior

`writeAudit` records: privileged login success/denied, logout, password-reset completion, MFA enroll/remove/challenge, staff invite/provision/activate/deactivate/role-change, permission denials, with real actor, target, safe metadata. Secrets/PII redacted; never stores tokens/passwords/codes.

## 21. Environment variables added/changed

Added (public): `VITE_ENABLE_GOOGLE_OAUTH`, `VITE_ENABLE_FACEBOOK_OAUTH`.
Added (server): `ENFORCE_ADMIN_MFA`, `ADDITIONAL_ALLOWED_ORIGINS`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
`validateEnvAtStartup()` fails fast in production on missing/malformed required vars.

## 22. Credentials requiring MANUAL rotation (treat as compromised)

The repository's `.env` contained live secrets. **Rotate all of these now** (values intentionally omitted):

- Supabase **service-role** key
- Supabase anon/publishable key (lower risk, still rotate)
- Steadfast API key + secret
- Pathao production client id/secret
- Pathao sandbox client id/secret + username/password

`.env` is git-ignored; ensure it is excluded from any distributable archive.

## 23. Tests added

`safe-redirect.test.ts`, `permissions.test.ts`, `admin-routes.test.ts`; updated `validation.test.ts` (password tiers/denylist) and `login-destination.test.ts` (permission-aware + privileged-only-/admin). Total **126 passing**.

## 24. Command results

- `tsc --noEmit` → clean.
- `eslint .` → 0 errors (pre-existing `react-refresh` warnings only).
- `vitest run` → **126 passed / 8 files**.
- `vite build` → success.
- Client bundle scan → **no** service-role key / private secrets (anon key only, expected).
- HTTP checks → `/account`,`/admin`,`/admin/orders` redirect to `/login?next=…`; `/admin/login`→`/login?next=/admin`; login shows "Email address"; CSP + security headers present.

## 25. Remaining blockers

1. **Live privileged browser E2E** — run `scripts/e2e-auth-test.ts` against a dedicated non-production Supabase project (`E2E_ALLOW=1` + `E2E_SUPABASE_*`). Not run against the real project by design.
2. **Enable MFA** in the Supabase dashboard, enroll an owner, then set `ENFORCE_ADMIN_MFA=true`.
3. **Configure OAuth providers** in Supabase + set the `VITE_ENABLE_*` flags.
4. **Rotate the exposed credentials** (§22).
5. For multi-instance deploys, set the Upstash vars so rate limiting is shared.

## 26. Supabase dashboard steps

1. Apply migration `20260621090000_*` (and confirm 1–7 are applied).
2. Authentication → Providers → enable **TOTP MFA**.
3. Authentication → URL configuration → add the site URL + `/auth/callback`, `/auth/confirm` redirect URLs.
4. Authentication → Email templates → confirm signup/recovery/invite templates; configure SMTP for invites.
5. Provision the first owner via `npm run provision-admin`.

## 27. Google provider setup

1. Google Cloud → OAuth consent screen + OAuth client (Web).
2. Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → Google → paste client id/secret, enable.
4. Set `VITE_ENABLE_GOOGLE_OAUTH=true`.

## 28. Facebook provider setup

1. Meta for Developers → app → Facebook Login.
2. Valid OAuth redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
3. Supabase → Providers → Facebook → paste app id/secret, enable.
4. Set `VITE_ENABLE_FACEBOOK_OAUTH=true`.

## 29. Production deployment checklist

- [ ] Rotate all credentials in §22; set them as platform env vars (never commit).
- [ ] `NODE_ENV=production`, correct `VITE_SITE_URL` (HTTPS); confirm `validateEnvAtStartup` passes.
- [ ] Apply all migrations to the production project.
- [ ] Provision the first owner; enable MFA; enroll owner; set `ENFORCE_ADMIN_MFA=true`.
- [ ] Configure OAuth providers + flags (or leave disabled → buttons show "Unavailable").
- [ ] Set Upstash vars for shared rate limiting on multi-instance.
- [ ] Verify cookies are `Secure` in prod and the CSP allows your Supabase domain.
- [ ] Run the safe E2E suite against a dedicated test project.
- [ ] Confirm no service-role module/secret in the client bundle (scan passes).
