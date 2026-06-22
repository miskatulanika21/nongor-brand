# IMPLEMENTATION_PLAN — Nongorr Studio Phase 2

Stage-by-stage plan with exit criteria. Derived from
`nongorr-phase-2-antigravity-prompt.md` (V3). Update after each stage; keep in
sync with `CURRENT_STATUS.md`.

## Stage 1.5 — Security closure (current)

**Done (code):**

- [x] Bug 1 — `api` schema wrappers + `staff.api.ts` uses `.schema("api").rpc()`
- [x] Bug 2 — `invite` confirm type wired end-to-end (→ set initial password)
- [x] Bug 3 — `requireStepUp()` (AAL2) in the three staff mutations, gated by
      `ENFORCE_ADMIN_MFA`
- [x] Bug 4 — `admin_read_audit_logs` RLS tightened to owner-only

**Remaining to close the stage (operator):**

- [ ] Apply migration `20260622120000_stage_1_5_security_closure.sql`
- [ ] Add `api` to PostgREST exposed schemas (keep `private` hidden)
- [ ] Confirm all 9 migrations applied (`supabase migration list`)
- [ ] Rotate & revoke all Stage 1-committed credentials
- [ ] MFA rollout (owner enrolls + verifies recovery) → `ENFORCE_ADMIN_MFA=true`
- [ ] Real-email invite E2E: invite → email → link → password set → admin

**Deferred V3 weaknesses (schedule before launch):** independent per-IP/account
rate-limit keys; header rebuild-vs-mutate; `guard_owner_safety` concurrency
serialization; transactional/outbox audit for critical ops; CI pipeline.

**Exit gate:** all checkboxes above true and verified against the live project.

## Stage 2 (Pass 2+) — Catalog writes

Admin product/category/inventory/media/settings writes; inventory
movements/reservations; collections; DB-backed category counts &
color/fabric facets; Storage media library; rating/review_count maintenance.
Enforce `products.manage` / `categories.manage`. Retire the `PRODUCTS` array
once the admin write path is DB-backed.

**Exit:** admin changes persist and drive the storefront; no mock array for
catalog; permissions enforced server-side.

## Stage 3 — Checkout & orders

Server-authoritative pricing (never trust client totals); transactional order
creation (validate stock → reserve → order → items → payment → commit);
idempotency key; sequential server-generated order numbers; `PaymentProvider`
interface + `ManualBkashProvider`. Tables: orders, order_items,
order_status_history, payments, payment_screenshots, coupons, coupon_usages,
idempotency_keys. localStorage migration per the V3 table (one-time flag).

**Exit:** one order per submission under retry; totals recomputed server-side;
payment evidence in private Storage.

## Stage 4 — Customer accounts

Replace `account-ui.tsx` localStorage with `createServerFn`. Tables:
customer_profiles, saved_addresses, saved_measurements. Order history by
`auth.uid()`. Secure guest tracking (order id + verification factor, never phone
alone).

## Stage 5 — Admin sales ops & integrations

`CourierAdapter` interface; `SteadFastAdapter` then `PathaoAdapter` (only with
rotated credentials); verified, idempotent webhooks. Tables: courier_providers,
shipments, shipment_events, webhook_events, notification_outbox. Notifications
via outbox, never in the checkout transaction.

## Stage 6 — Content & operational modules

Reviews moderation, banners, CMS/policies, contact storage, newsletter
consent/unsubscribe, reports + CSV, owner-only audit viewer, site_settings
(move `brand.ts` values to DB).

## Stage 7 — Hardening & launch

Security review, rate limiting extended to all public mutations, concurrency
tests (oversell/coupon race/duplicate order), error monitoring, CI/CD deploy,
backup/restore docs, perf (LCP < 2.5s mobile) and a11y audits, CSP tightening,
legal review.

## Working rules (every stage)

Baseline `bun run check` and read source before changing it. Preserve the
existing UI/flows (V3 preservation contract). Never fake integrations,
credentials, or payment/courier responses. Update `CURRENT_STATUS.md`,
`IMPLEMENTATION_PLAN.md`, `WALKTHROUGH.md` after each stage.
