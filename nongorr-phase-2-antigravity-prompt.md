# Nongorr Studio — Phase 2 Backend, API, Server and Production-Readiness Prompt

**Version 3 — Incorporates Stage 1.5 security-closure requirements**

## Role

Act as a senior full-stack architect, e-commerce backend engineer, database designer, and application-security engineer.

You are working on **Nongorr Studio**, a premium Bangladesh-focused women's fashion and beauty e-commerce site. Your job is to close the remaining Stage 1 security defects (Stage 1.5), then implement the full commercial backend — catalog, checkout, orders, payments, couriers, customer accounts, and admin operations — as a secure, persistent, production-ready commerce system **without redesigning, removing, or weakening the existing UI or features**.

---

## Authoritative sources of truth

In this order:

1. **Live Supabase project** (migration status, RLS policies, actual function schemas)
2. **Reproducible command output** (`bun run typecheck`, `bun run test`, `bun run build`)
3. **Repository source code** (what the code currently does)
4. **This prompt** (what to build next)
5. **`docs/stage-1-auth-report.md`** and **`docs/database-stage-1.md`** (Stage 1 design intent — not proof of completion)

When these conflict, follow the earlier item. Documentation and self-reported test results are **not proof**. Code and live environment behavior are.

---

## IMMEDIATE: Security pre-conditions before any implementation

These must be confirmed or completed before writing a single line of new code.

### Credential rotation

The Stage 1 auth report (§22) documents that live secrets were committed to `.env`:

- Supabase service-role key
- Supabase anon key
- Steadfast API key and secret
- Pathao production client ID and secret
- Pathao sandbox client ID, secret, username, and password

**Treat all of these as compromised until the owner confirms rotation and revocation in each provider dashboard.** Rotating the value is the critical security action. History scrubbing is a separate, coordinated operation — see the Git history section below.

### Git history cleanup — owner-authorized operation only

The prompt rule "do not rewrite published Git history" applies to **normal development**. Scrubbing committed secrets is a one-time security operation that requires explicit owner authorization and coordination. Antigravity must **not** perform this automatically.

When the owner authorizes it, follow this order:

1. Confirm all exposed credentials are already revoked in provider dashboards.
2. Back up the full repository.
3. Inform all collaborators — they must re-clone after the operation.
4. Temporarily lift branch protection if required.
5. Use `git-filter-repo` or BFG Repo-Cleaner — never `git filter-branch`.
6. Force-push only with explicit owner approval and after the backup is confirmed.
7. Require every collaborator to re-clone; stale clones still contain the old secrets.

Rotating and revoking credentials is the **immediate** safety action. History scrubbing **reduces future risk** but must be coordinated. Do both; do not treat one as a substitute for the other.

---

## Current project state — read before assuming anything

### Stack (post-Stage 1)

- TanStack Start, file-based routing
- React 19, TypeScript strict mode, Tailwind CSS v4, Vite 7
- TanStack Router, TanStack React Query
- Supabase JS v2.108 + `@supabase/ssr` 0.12 (auth and SSR wired)
- Bun lockfile and Bun-based scripts
- ~36,500 lines of TypeScript/TSX, 182 source files, 60 route files
- 21 admin routes, 33 public/site routes, auth routes

### Stage 1 design intent (substantially implemented — not yet fully verified)

Stage 1 aimed to deliver: unified login, server-side identity resolution, fail-closed RBAC, CSRF protection, rate limiting, security headers, TOTP MFA scaffolding, password-tier validation, owner-safety at the database level, and audit logging. The architecture of all of these is sound.

### Stage 1 confirmed defects — must fix before Stage 2

Four confirmed bugs exist that will silently fail or create security gaps in a live environment:

**Bug 1 — Staff RPC calls target the wrong schema (CRITICAL)**
`src/lib/staff.api.ts` calls `admin.rpc("provision_staff", ...)`, `admin.rpc("update_staff_role", ...)`, and `admin.rpc("set_staff_active", ...)`. These functions live in the `private` schema which is correctly not exposed via PostgREST. Without schema qualification, the calls target the `public` schema and will fail with "function not found" on a live Supabase project. Staff provisioning, role changes, and activation/deactivation are currently broken in any live environment.

**Bug 2 — Staff invitation type rejected by confirm route (CRITICAL)**
`staff.api.ts` sends invitation emails with `redirectTo: .../auth/confirm?type=invite`. The confirm route validates against `ALLOWED_CONFIRM_TYPES = ["email", "recovery", "magiclink"]` — `"invite"` is not in this list. When a staff member clicks the invitation link, the confirm route immediately returns `"Invalid confirmation link."` The entire staff onboarding flow is broken.

**Bug 3 — MFA not enforced on sensitive privileged operations (HIGH)**
`requireAssuranceLevel()` exists in `mfa.server.ts` and is well-designed, but is never called from `staff.api.ts`. An owner or admin with a password-only (AAL1) session can invite staff, change roles, and deactivate accounts without any MFA step-up. The enforcement infrastructure exists but is not connected where it counts.

**Bug 4 — Audit-log RLS allows admin but permission registry restricts to owner-only (MEDIUM)**
`permissions.ts` correctly places `audit.view` in `OWNER_ONLY_PERMISSIONS`. The database RLS policy `admin_read_audit_logs` allows `current_staff_role() IN ('owner', 'admin')`. An admin can query `audit_logs` directly via Supabase even though the application permission model says only owners may see audit records. The database must be the final security boundary; the UI hiding a menu item is not security.

### Additional weaknesses to address in Stage 1.5

**Rate limiting uses combined keys, not independent limits**
`checkRateLimit("login", [ip, email])` produces one key `login:ip|email`. An attacker rotating IPs gets a fresh bucket per IP. An attacker rotating email addresses gets a fresh bucket per email. Independent per-IP and per-account limits are required.

**Security headers have a silent failure path**
`applySecurityHeaders(response)` mutates `response.headers` in-place inside a `try { } catch { }` that swallows all errors. If the response object has guarded or immutable headers, the mutation silently fails and the response goes out without security headers. Rebuild the response with new headers instead of mutating in-place.

**Rate limiter fails open**
The rate limiter is designed to fail open on store errors so a limiter outage does not lock users out of login. This is a documented and acceptable tradeoff for login. For high-risk privileged operations (staff mutation, payment verification), consider whether fail-closed is more appropriate.

**Audit writes are best-effort for all operations**
`writeAudit()` never blocks or reverses the primary action on failure. This is acceptable for low-risk events. For owner role changes, payment verification, and refund approvals, failed audit writes should either be transactional (written in the same database transaction) or handled through a transactional outbox. The current design is a risk for those operations.

**Owner concurrency not fully serialized**
The `guard_owner_safety` trigger checks for remaining owners with a plain `SELECT count(*)`. Under PostgreSQL Read Committed isolation, two concurrent transactions can both pass this check simultaneously and both proceed, potentially leaving no active owner. The check needs `SELECT ... FOR UPDATE` on a sentinel row or use of an advisory lock for true serialization. This is a low-probability risk for a small boutique but should be fixed for correctness.

### What is still mock / localStorage-only (the Phase 2 scope)

- Products, categories, inventory — hardcoded in `src/lib/products.ts`
- Orders — 3 seed records in `src/lib/orders.ts`; checkout writes to `localStorage` with `Math.random()` order ID
- Cart, wishlist, checkout state — `localStorage` only
- Customer profiles, saved addresses, saved measurements — `localStorage` only (`src/lib/account-ui.tsx`)
- Coupons — 3 hardcoded mocks in `src/lib/checkout-ui.ts`, client-side only
- Payment screenshots — local object URLs only, never uploaded anywhere
- bKash TrxID — not verified or stored in a database
- Courier (SteadFast, Pathao) — no API calls exist
- All admin modules except staff/RBAC — wired to mock arrays
- Newsletter, contact, reviews, banners, media library, policies, settings, reports — all mock
- bKash number, phone, WhatsApp — placeholders (`01700-000000`)

### Database tables that currently exist (verified from migrations directory)

```
public.staff_profiles    — RBAC roles and active status
public.audit_logs        — security event records
```

Migration files exist for 8 migrations in `supabase/migrations/`. Whether these are applied to the live Supabase environment must be independently verified before Stage 1.5 begins:

```
bun run supabase migration list
```

or the equivalent Supabase CLI command against the target project. **Do not assume migration files in the repository means migrations are applied remotely.**

---

## Mandatory working behavior — do not work blindly

Before changing any implementation:

1. Clone the repository and run:

   ```
   bun install --frozen-lockfile
   bun run typecheck
   bun run lint
   bun run format:check
   bun run test
   bun run build
   ```

   Record every command's exact output. This is the baseline. All results must pass before Stage 1.5 begins.

2. Read these files in this order:
   - `docs/database-stage-1.md` — Stage 1 database design
   - `docs/stage-1-auth-report.md` — Stage 1 implementation report
   - `src/lib/server/` — all server-only infrastructure
   - `src/lib/auth.api.ts`, `src/lib/staff.api.ts`, `src/lib/mfa.api.ts` — existing server functions
   - `src/lib/permissions.ts`, `src/lib/validation.ts`, `src/lib/brand.ts` — business rules
   - `src/lib/products.ts`, `src/lib/orders.ts`, `src/lib/checkout-ui.ts`, `src/lib/store.tsx` — what is still mock
   - All `src/routes/` files

3. Verify the live Supabase environment:
   - Run `supabase migration list` against the target project and record output
   - Confirm which migrations are actually applied
   - Do not proceed until migration status is known

4. Produce these documents before coding:
   - `CURRENT_STATUS.md` — current verified state (real vs mock, confirmed bugs, migration status)
   - `IMPLEMENTATION_PLAN.md` — stage-by-stage plan with tasks, dependencies, and exit criteria
   - `WALKTHROUGH.md` — updated after each stage to reflect actual data flows
   - `docs/phase-2-architecture.md` — architecture decisions
   - `docs/phase-2-data-model.md` — complete database schema before writing migrations

5. Update `CURRENT_STATUS.md`, `IMPLEMENTATION_PLAN.md`, and `WALKTHROUGH.md` after every stage. These are the authoritative record of evolving project state.

6. Identify genuine blockers and ask the owner. Continue all non-blocked work. Never report a blocked integration as complete.

When you find a conflict, ambiguity, security risk, or destructive migration path:

- Stop that specific change
- State the exact files and behavior involved
- Explain the risk plainly
- Present the safest options with a recommendation
- Ask a focused question — not trivial implementation details

---

## Non-negotiable preservation contract

1. Do not redesign the site. Preserve the approved visual design, layouts, responsive behavior, component structure, routes, and user flows.
2. Do not remove any existing pages, controls, fields, filters, tabs, cards, admin modules, product types, custom-size functionality, policy pages, or customer flows.
3. Backend integration happens behind the existing interface. Modify existing components only as required to connect real data, loading, errors, and permissions.
4. Do not replace the framework or rebuild in another stack.
5. Do not silently change business rules, prices, shipping fees, free-delivery thresholds, statuses, sizing behavior, URLs, or product slugs.
6. Once a feature becomes real, replace "demo," "local preview," or "not connected" labels only where necessary. Keep the same visual hierarchy and styling.
7. Do not create fake integrations, fake credentials, fake legal details, fake customer data, fake payment verification, or fake courier responses.
8. Do not blindly install libraries, upgrade framework versions, or rewrite configuration without explaining the need first.
9. Do not reimpose auth, RBAC, CSRF, security headers, password validation, or audit logging that Stage 1 already delivered correctly. Fix the four confirmed bugs; extend the rest.
10. The UI will need targeted modifications when real data, errors, pagination, permission states, payment states, and operational workflows are connected. Plan for this — the UI does not require a full redesign but it is not frozen.

---

## Architecture decision gate

Confirm these with the owner before writing provider-specific code:

1. **Hosting target:** Prefer Node.js server via Nitro `node-server` preset as the safe default. Switch to `cloudflare-pages` or `vercel` only on explicit owner confirmation. Do not pick a platform blindly.
2. **Supabase project:** Is the existing project the production project, or must a separate one be created for production? Migrations must be applied to the correct project.
3. **Customer auth for first release:** Email/password (already in Stage 1) only, or also phone OTP? Phone OTP requires a confirmed SMS provider and cost plan.
4. **Real business details:** bKash number and account type (personal/merchant), phone, WhatsApp, email, legal business name if registered, final production domain, social URLs.
5. **Transactional email provider and confirmed sender domain.**
6. **Courier credentials:** Confirmed-rotated Steadfast and Pathao API credentials.
7. **Payment approach for first release:** Manual bKash verification only (preferred), or is a payment gateway approved?
8. **Initial staff accounts:** Who gets owner, admin, and staff roles at go-live?

If any are unavailable, build provider-neutral interfaces and safe development adapters. Mark blocked integrations clearly. Never report them as live.

---

## Database schema — `api` wrapper pattern for private functions

The `private` schema is deliberately not exposed through PostgREST. All existing `private.*` functions must remain there. To fix Bug 1, create a separate `api` schema with controlled wrapper functions:

```sql
-- Example pattern for each private staff function
CREATE SCHEMA IF NOT EXISTS api;

CREATE OR REPLACE FUNCTION api.provision_staff(
  p_user_id uuid,
  p_role private.staff_role,
  p_display_name text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Recheck authorization in PostgreSQL before delegating
  IF private.current_staff_role() NOT IN ('owner'::private.staff_role, 'admin'::private.staff_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN private.provision_staff(p_user_id, p_role, p_display_name, p_actor_id, p_is_active);
END;
$$;

REVOKE ALL ON FUNCTION api.provision_staff FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.provision_staff TO service_role;
```

Expose only the `api` schema via PostgREST. Do not expose `private`.

Then update `staff.api.ts` to call:

```typescript
const { error } = await admin.schema("api").rpc("provision_staff", { ... });
```

Supabase JS v2.108 supports `.schema("api").rpc(...)`. Apply this pattern to `update_staff_role` and `set_staff_active` as well.

---

## Stage 1.5 — Authentication, RBAC and security closure

**This is the immediate stage. Stage 2 cannot begin until every exit criterion below passes.**

### Required work

1. **Fix private-schema RPC invocation (Bug 1)**
   - Create `api` schema with wrapper functions for `provision_staff`, `update_staff_role`, `set_staff_active`
   - Apply `SECURITY DEFINER`, `SET search_path = ''`, revoke from PUBLIC/anon/authenticated, grant only to service_role
   - Update `staff.api.ts` to call `admin.schema("api").rpc(...)`
   - Test against the live Supabase project

2. **Fix staff invitation callback (Bug 2)**
   Two options — choose one and confirm with owner:
   - **Option A:** Add `"invite"` to `ALLOWED_CONFIRM_TYPES` in `validation.ts` and handle it in `auth.confirm.tsx` (Supabase sends a `token_hash` for invitations that `verifyOtp` accepts with `type: "invite"`)
   - **Option B:** Change the invitation `redirectTo` to use `type=email` (Supabase invitation tokens are also accepted as `type=email` depending on the Supabase project configuration — verify which type the project actually sends)

   After fixing, perform a complete real email E2E test: invite sent → email received → link clicked → session created → staff profile found → onboarding completed

3. **Enforce AAL2 on sensitive privileged operations (Bug 3)**
   Add `requireAssuranceLevel()` calls inside these handlers **before** executing the operation:
   - `provisionStaff`
   - `updateStaffRole`
   - `setStaffActive`

   Also require AAL2 for any future: payment verification, refund approval, integration-key changes, customer-data exports, security/owner changes.

   **MFA enforcement rollout order — do not skip steps:**
   1. Verify the owner account exists in the live Supabase project
   2. Owner enrolls TOTP and verifies it works
   3. Owner verifies the recovery procedure
   4. Owner confirms an AAL2 session reaches the admin area correctly
   5. Add `requireAssuranceLevel` to sensitive handlers
   6. Set `ENFORCE_ADMIN_MFA=true` in the environment
   7. Test the full admin onboarding path: owner invites admin → admin accepts → admin enrolls MFA → admin reaches only authorized modules

   Do not add enforcement before step 4 or the owner risks being locked out.

4. **Align audit-log RLS with the permission registry (Bug 4)**
   Change the `admin_read_audit_logs` policy to match `audit.view` being owner-only:

   ```sql
   DROP POLICY IF EXISTS "admin_read_audit_logs" ON public.audit_logs;
   CREATE POLICY "admin_read_audit_logs"
     ON public.audit_logs FOR SELECT TO authenticated
     USING (private.current_staff_role() = 'owner'::private.staff_role);
   ```

   If the intent is for admins to also read audit logs, update `permissions.ts` to grant `audit.view` to the admin role — choose one source of truth and make the database match it.

5. **Fix security header mutation pattern**
   Replace the in-place mutation in `headers.server.ts` and `server.ts` with a pattern that constructs a new `Response`:

   ```typescript
   const newHeaders = new Headers(response.headers);
   // set headers on newHeaders
   return new Response(response.body, {
     status: response.status,
     statusText: response.statusText,
     headers: newHeaders,
   });
   ```

   After deployment, verify actual HTTP responses include the expected headers using `curl -I` or a header-inspection tool against the deployed URL.

6. **Add independent per-IP and per-account rate limits**
   Replace the single combined-key approach with independent checks:

   ```typescript
   // Check IP limit independently
   const ipResult = await checkRateLimit("login:ip", [ip]);
   // Check account limit independently
   const accountResult = await checkRateLimit("login:account", [normalizedEmail]);
   // Both must pass
   if (!ipResult.allowed || !accountResult.allowed) { ... }
   ```

   Verify that the forwarded-IP header (`x-forwarded-for`, `cf-connecting-ip`) is trusted only from the actual hosting proxy and cannot be spoofed by the client.

7. **Verify all 8 Stage 1 migrations in the target Supabase environment**
   Run `supabase migration list` against the project. Record which migrations are applied. Apply any that are missing. Do not assume files in the repository means they are applied remotely.

8. **Make last-owner protection concurrency-safe**
   Add serialization to `guard_owner_safety` using `SELECT ... FOR UPDATE` or a Postgres advisory lock so two concurrent demotion transactions cannot both pass the owner-count check simultaneously.

9. **Improve audit reliability for critical operations**
   For owner role changes, payment verification, and refund approvals: write the audit entry in the same database transaction as the primary operation, or use a transactional outbox table. For lower-risk events the existing best-effort pattern is acceptable.

10. **Rotate and revoke all previously committed credentials**
    Confirm with the owner that all credentials listed in the security pre-conditions section are revoked and replaced.

11. **Add CI pipeline**
    Add a CI workflow (GitHub Actions or equivalent) that runs on every push to `main` and every pull request:

    ```
    bun install --frozen-lockfile
    bun run typecheck
    bun run lint
    bun run format:check
    bun run test
    supabase db lint (if available)
    bun run build
    ```

    No failing commit should reach `main` without a failing CI run.

12. **Independently run and record the complete quality suite**
    Run `bun run check` and record the exact output. The 126 passing tests reported in the Stage 1 document are self-reported documentation, not verified fact. Current reproducible output overrides documentation.

### Stage 1.5 exit criteria — hard gate for Stage 2

Stage 1.5 is complete only when all of the following are true and verifiable:

- [ ] Real owner logs in with email/password → MFA challenge → AAL2 session → admin dashboard
- [ ] Owner invites a staff member → email is delivered → invitation link succeeds (does not show error page) → staff establishes account → MFA enrolled where required → staff reaches only authorized admin modules
- [ ] Admin cannot query `audit_logs` via Supabase directly (RLS blocks it)
- [ ] Removing the last active owner is blocked at the database level even under concurrent load
- [ ] Sensitive operations (provision staff, change role, deactivate) require AAL2 or return a clear step-up redirect
- [ ] Security headers are confirmed present in actual deployed HTTP responses via `curl -I`
- [ ] All 8 migrations confirmed applied in the target Supabase environment
- [ ] CI pipeline runs and passes on a clean clone
- [ ] `bun run check` passes with exact output recorded
- [ ] All exposed credentials confirmed rotated and revoked in provider dashboards

---

## Stage 2 — Catalog, media, and settings

Begin only after Stage 1.5 exit criteria are fully met.

### Database tables to create

```
categories
products
product_variants
product_images
product_attributes
product_reviews (with moderation_state)
inventory_levels
inventory_reservations
inventory_movements
site_settings
```

Design with: UUID primary keys, `created_at`/`updated_at` timestamps, `deleted_at` for soft-delete, RLS policies on every table, indexes on slug, SKU, status, category, and created_at.

### Key decisions

- Product images go to Supabase Storage (private bucket for drafts, public bucket for approved/live images)
- `site_settings` replaces hardcoded values in `brand.ts` for bKash number, phone, WhatsApp, email, legal name, and domain
- Replace runtime `PRODUCTS` array import with Supabase query in loaders
- Admin product CRUD must enforce `products.manage` permission via `requirePermission`
- Category management must enforce `categories.manage`
- Seed the 10 existing products and 5 categories through a repeatable migration/seed script — not a hardcoded array

---

## Stage 3 — Authoritative pricing and checkout

> **Implementation status (2026-06-27) — see `CURRENT_STATUS.md` for detail.**
> Backend **live**: order schema + numbering + idempotency (Pass 1), inventory
> reservations (Pass 1r), and the server-authoritative `api.quote_order` /
> `api.place_order` RPCs (Pass 3a — server re-pricing, `quote_token` drift guard,
> race-safe idempotency, oversell guard, reservations, guest tokens). **In
> progress** (Pass 3b): app integration — admin payment-method settings +
> `checkout-shared` shipped; checkout/cart UI rewire, cart reconciliation, inline
> TrxID, and F-04 gate removal next. **Deferred:** coupons/`coupon_usages` (P5),
> payment evidence + verification in private Storage (P4). The `PaymentProvider`
> interface is realised RPC-first (manual bKash/Nagad + COD); no gateway is faked.

### Key rules — non-negotiable

- **Never trust browser-supplied totals.** The server must reload product price, sale price, custom-size charge, coupon discount, shipping fee, and free-delivery eligibility from the database and recalculate the final total.
- **Transactional order creation:** validate stock → reserve inventory → create order → create order items → create payment record → commit. If any step fails, roll back everything.
- **Idempotency key:** the checkout form generates a UUID before submission; the server uses it to prevent duplicate orders on retry or double-click.
- **Real order IDs:** sequential, server-generated order numbers replace the current `Math.random()` approach.

### Payment provider abstraction

Create an interface that both manual bKash and a future gateway implement:

```typescript
interface PaymentProvider {
  initiatePayment(params: PaymentInitParams): Promise<PaymentInitResult>;
  verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerifyResult>;
  getStatus(paymentId: string): Promise<PaymentStatus>;
}
```

Implement `ManualBkashProvider` first. Never fake a gateway integration.

### Database tables to create

```
orders
order_items
order_status_history
payments
payment_screenshots  (storage key reference only — file in private Supabase Storage bucket)
coupons
coupon_usages
idempotency_keys
```

### localStorage cleanup strategy

The following keys exist in users' browsers. Handle them carefully:

| Key                          | Strategy                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `nongorr_cart`               | Keep for guest sessions; merge into server state on login; clear only after successful merge |
| `nongorr_wishlist`           | Keep for guest sessions; sync to server on login                                             |
| `nongorr_checkout_ui`        | Keep delivery zone preference; clear coupon and notes after real order created               |
| `nongorr_orders`             | Clear on first authenticated load after real orders exist in DB; replace with server fetch   |
| `nongorr_last_order`         | Clear on first authenticated load; replace with server fetch                                 |
| `nongorr.announce.dismissed` | Safe to keep indefinitely — UX preference only                                               |

Use a migration flag (e.g., `nongorr_migrated_v2`) so cleanup runs once per browser, not on every page load.

---

## Stage 4 — Customer accounts and orders

### Database tables to create

```
customer_profiles
saved_addresses
saved_measurements
```

### Key decisions

- Replace `src/lib/account-ui.tsx` localStorage implementation with `createServerFn` calls
- Customer order history loads from the `orders` table filtered by `auth.uid()`
- Address prefill in checkout reads from `saved_addresses`
- Measurement prefill reads from `saved_measurements`
- Guest tracking requires order ID plus a secure verification factor (e.g., matching phone or time-limited token) — never expose all orders for a phone number through an unauthenticated search

---

## Stage 5 — Admin sales operations and integrations

### Courier adapter interface

Create before implementing Steadfast or Pathao:

```typescript
interface CourierAdapter {
  createConsignment(order: OrderForShipment): Promise<ConsignmentResult>;
  trackShipment(trackingId: string): Promise<ShipmentStatus>;
  cancelConsignment(consignmentId: string): Promise<void>;
  handleWebhook(payload: unknown, signature: string): Promise<WebhookResult>;
}
```

Implement `SteadFastAdapter` first only after the owner confirms rotated credentials are available. `PathaoAdapter` second. Verify webhook signatures. Store raw event IDs. Process webhooks idempotently. Log all failures and retries.

### Database tables to create

```
courier_providers
shipments
shipment_events
webhook_events
notification_outbox
```

Notifications (WhatsApp links, transactional email) go through the outbox — they must not block or be part of the checkout database transaction.

---

## Stage 6 — Content and operational modules

- Reviews (submit, moderate, display)
- Banners with placement and scheduling
- Policies and content blocks (admin CMS)
- Contact message storage
- Newsletter subscriptions with consent/unsubscribe state
- Staff management extended (already wired in Stage 1 — extend, don't replace)
- Reports with real aggregation queries and CSV export
- Audit log viewer (owner-only, extends Stage 1 `audit_logs`)
- Site configuration (bKash number, contact info, WhatsApp — move from `brand.ts` to `site_settings`)

---

## Stage 7 — Hardening and launch readiness

- Security review against every item in the security requirements section
- Rate limiting extended to checkout, coupon check, review submission, payment submission, contact form, newsletter, tracking
- Concurrency tests (oversell, coupon race, duplicate order)
- Error monitoring integration
- CI/CD with automated deploy on passing build
- Database backup and restore procedure documented
- Performance audit: LCP < 2.5s on mobile, all product images via CDN with `srcset`/`sizes`/lazy-loading
- Accessibility audit: keyboard completion, focus restoration, screen-reader announcements, contrast
- CSP tightened: move from `unsafe-inline` toward nonces once TanStack Start hydration supports it
- Enable `ENFORCE_ADMIN_MFA=true` only after all owners have enrolled and recovery is verified
- Legal review of policy pages with real registered legal name filled in

---

## Security requirements

Build on Stage 1. Do not duplicate or weaken existing controls.

1. Use `checkCsrfOrigin` (already in `security.server.ts`) in every new state-changing server function.
2. Use `requirePermission` (already in `rbac.server.ts`) in every admin server function.
3. Use `safeServerLog` with PII redaction for all server logging — never raw `console.log` for user-facing operations.
4. Validate every server input with Zod schemas. Client validation is UX only.
5. Private Supabase Storage for payment screenshots — access only via short-lived signed URLs for authorized staff.
6. Validate upload MIME type, magic bytes, extension, dimensions, and size server-side. Generate safe storage keys; never trust client-supplied filenames.
7. Apply RLS on all new tables. Follow the `staff_profiles` pattern with `private.current_staff_role()` to avoid recursion.
8. Prevent IDOR, phone/order enumeration, duplicate order submission, coupon race conditions, overselling, duplicate webhook processing, and duplicate TrxID abuse.
9. Mask PII and payment identifiers in logs.
10. Do not leak stack traces, secrets, SQL, or provider responses to customers.
11. Record security-relevant admin actions in `audit_logs`. For critical operations, write audit entries transactionally.

---

## Testing requirements

Follow the existing Vitest/jsdom pattern in `src/lib/__tests__/`. New tests extend this directory.

Add:

- Unit tests for pricing, shipping, coupon eligibility, phone normalization, measurement validation, order-state transitions, inventory calculations
- Database/repository integration tests
- Customer-isolation/IDOR tests
- Checkout transaction and idempotency tests
- Inventory concurrency/oversell tests
- Payment submission and duplicate TrxID tests
- Upload validation tests
- Courier adapter/webhook idempotency tests
- Admin CRUD permission tests

**Critical E2E journeys to maintain:**

1. Browse → filter → product detail → select size (ready/custom) → add to cart
2. Apply valid/invalid coupon → delivery selection → server quote
3. Guest checkout → payment evidence → one order only despite retry/double-submit
4. Customer registration/login → profile/address/measurement persistence → own orders only
5. Secure guest tracking (order ID + verification factor, not phone alone)
6. Admin login → product CRUD → storefront update
7. Inventory adjustment → history → checkout stock enforcement
8. Payment verification → status history → customer-visible status
9. Courier booking → tracking update → webhook processed idempotently
10. Role restrictions confirmed for Owner, Admin, and Staff

---

## Required progress reporting

After each stage, update `CURRENT_STATUS.md` and report:

1. Files added and modified (exact list)
2. Database migrations added (with filenames and descriptions)
3. Data flow change: what was mock before, what is real now
4. Security controls implemented or extended
5. Tests added and exact command output for `bun run check`
6. Visual differences (expected: none — provide evidence if any)
7. Blockers requiring owner credentials or decisions
8. Rollback instructions

---

## Definition of done

Phase 2 is complete only when:

- Every current route exists and retains its approved visual design and behavior
- The storefront reads live persistent catalog data
- Admin changes persist and affect the storefront correctly
- Auth and permissions are enforced server-side (Stage 1 + Stage 1.5 foundation)
- Checkout is server-authoritative, transactional, idempotent, and stock-safe
- Orders, order items, custom measurements, payment submissions, status history, and inventory movements persist correctly
- Payment screenshots are in private Supabase Storage, accessible only to authorized staff via signed URLs
- Guest tracking cannot enumerate orders or reveal another customer's data
- Manual bKash verification works as an auditable state machine through the PaymentProvider interface
- Courier integrations are real where credentials exist, or explicitly blocked — not faked
- All admin modules are connected to real persistent data according to the stage scope
- No hardcoded password, service secret, placeholder production credential, or browser-only authorization remains
- Production does not depend on `localStorage` or mock arrays for protected or business-critical data
- Migrations, seeds, rollback, backups, environment setup, and deployment are documented
- `bun run check` passes in CI with recorded output
- A visual regression review confirms no unintended UI change on mobile and desktop
- `CURRENT_STATUS.md`, `IMPLEMENTATION_PLAN.md`, and `WALKTHROUGH.md` are current

---

## Final instruction

Do not confuse "the page renders" with "production ready."
Do not wrap mock arrays in API endpoints and call it done.
Do not move insecure client logic to an unprotected server route.
Do not report a provider integration as complete using a mock response.
Do not claim Stage 1 is complete until Stage 1.5 exit criteria are verified in a live environment.

The commercial system has not been implemented. Stage 1's architecture is sound but has four confirmed bugs and several weaknesses that must be fixed before catalog, checkout, orders, payments, and courier work begin.

Fix Stage 1.5 first. Then build the commerce system on top of it.
