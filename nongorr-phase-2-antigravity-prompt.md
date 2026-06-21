# Nongorr Studio — Phase 2 Backend, API, Server and Production-Readiness Prompt

## Role

Act as a senior staff-level full-stack architect, e-commerce backend engineer, database designer, application-security engineer, and production-release reviewer.

You are working on **Nongorr Studio**, a premium Bangladesh-focused women’s fashion and beauty e-commerce site. The supplied archive is the current approved frontend/UI prototype. Your job is to convert it into a secure, persistent, production-ready commerce system **without redesigning, removing, or weakening the existing UI or features**.

## Source project

Work from the supplied project archive/repository exactly as received.

Current verified baseline:

- TanStack Start with file-based routing
- React 19
- TypeScript strict mode
- Tailwind CSS v4
- Vite 7
- TanStack Router and React Query
- Plain TanStack Start Vite config (`vite.config.ts`); no deploy target is wired yet (choose one in Phase 2)
- Bun lockfile and Bun-based scripts
- About 30,000 lines of TypeScript/TSX
- 53 route files: 32 public/site routes and 20 admin routes, plus root routing
- 70 React component files
- Only one visible unit-test file
- The current UI includes storefront, product detail, cart, checkout, wishlist, customer account, order history/tracking, and a broad admin dashboard

Important project rules already present in the repository:

- Do not manually edit `src/routeTree.gen.ts`; it is generated.
- The Vite config is a plain TanStack Start setup in `vite.config.ts`; add or change plugins there.
- Do not rewrite published Git history, force-push, rebase, amend, or squash already-pushed commits.
- Preserve the root `<Outlet />` and TanStack Start routing conventions.
- Prefer server-only modules and TanStack Start server functions/routes for server logic; never expose secrets in client code or `VITE_*` variables.

## Non-negotiable preservation contract

1. **Do not redesign the site.** Preserve the approved visual design, page layouts, responsive behavior, component structure, class names, styling, animations, routes, navigation, and user flows.
2. **Do not remove existing pages, controls, fields, filters, tabs, cards, admin modules, product types, custom-size functionality, policy pages, or customer flows.**
3. Backend integration must happen behind the existing interface. Modify existing components only as much as required to connect real data, validation, authentication, loading, errors, and permissions.
4. Do not replace the framework or rebuild the application in Next.js, Remix, Laravel, WordPress, or another stack.
5. Do not perform a broad UI refactor while implementing backend work.
6. Do not silently change business rules, product prices, shipping fees, free-delivery thresholds, statuses, sizing behavior, URLs, product slugs, or content.
7. Once a feature becomes real, replace misleading text such as “demo,” “local preview,” or “not connected” only where necessary for truthfulness. Keep the same visual hierarchy, dimensions, and styling.
8. Do not create fake integrations, fake credentials, fake legal details, fake customer data, fake payment verification, or fake courier success responses.
9. Do not blindly install libraries, upgrade core framework versions, change deployment targets, or rewrite configuration. Explain the need and compatibility first.

## Mandatory working behavior — do not work blindly

Before changing implementation:

1. Extract/clone the project and inspect the complete repository.
2. Read `AGENTS.md`, `package.json`, `vite.config.ts`, `src/routes/README.md`, server entry files, route tree, all domain files in `src/lib`, all public routes, and every admin route.
3. Run and record the untouched baseline:
   - `bun install --frozen-lockfile`
   - `bun run typecheck`
   - `bun run lint`
   - `bun run format:check`
   - `bun run test`
   - `bun run build`
4. Create a clean restoration point/commit before implementation. Never rewrite history.
5. Produce these documents before major coding:
   - `docs/phase-2-backend-audit.md`
   - `docs/phase-2-architecture.md`
   - `docs/phase-2-data-model.md`
   - `docs/phase-2-implementation-plan.md`
   - `docs/phase-2-risk-register.md`
6. Map each current UI action to its present mock/local implementation and its required production service/API/database operation.
7. Identify decisions that are genuine blockers. Ask the owner instead of guessing.
8. Continue all independent, non-blocked work while waiting for answers; never pretend a blocked integration is complete.

Whenever you discover a conflict, ambiguity, risky assumption, framework incompatibility, destructive migration, or security issue:

- Stop that specific change.
- State the exact files and behavior involved.
- Explain the risk in plain language.
- Present the safest options, with a recommendation and consequences.
- Ask a focused question.
- Do not ask about trivial implementation details that a senior engineer should resolve independently.

## Verified current-state findings that must guide the work

The project is a polished prototype, not yet a production backend.

### Critical current issues

- `src/routes/admin.login.tsx` contains a hard-coded client-visible password: `nongorr2026`.
- Admin access is only a `sessionStorage` flag, also checked client-side in `src/routes/admin.tsx`.
- Customer login/register/reset are timed frontend simulations using a browser-local demo flag.
- Products, categories, reviews, inventory, orders, customers, coupons, banners, media, reports, settings, staff roles, audit logs, payments, and courier operations are mock arrays or route-local state.
- Cart, wishlist, checkout state, account profiles, addresses, measurements, order history, and last-order data are primarily stored in `localStorage`/`sessionStorage`.
- Checkout creates an order with `Math.random()`, writes it to local storage, and clears the cart.
- Product prices, sale prices, custom-size charges, discounts, shipping fees, totals, coupon validity, stock, and order status are currently trusted from client-side state.
- Payment screenshots are only local object URLs and are never uploaded.
- Manual bKash TrxID is not verified, protected, uniquely constrained, or audited by a server.
- Order tracking can search demo/device orders by order ID or phone; a real API must not expose customer orders through insecure phone-number enumeration.
- Admin permission toggles are visual only and provide no authorization.
- Media upload, contact form, newsletter, reviews, policies, settings, reports, and courier actions are not persistent.
- Business contact and bKash values include placeholders and must not be treated as live.
- There are no database migrations, production schema, storage configuration, deployment manifest, CI workflow, backup policy, health check, rate limiter, or real observability setup in the archive.
- Test coverage is far below production requirements.

### Existing strengths to preserve

- Strong responsive UI and coherent design system
- Clear TanStack file-based routing
- Bangladesh-specific currency, phone validation, districts, delivery zones, and manual bKash flow
- Product types for kurti, saree, three-piece, girls’ dress, cosmetics, makeup, and serum
- Ready-size, girls-size, custom-size measurement, stock, coupon, payment, order, courier, customer, staff, content, and reporting interfaces already represented in the UI
- Central brand, shipping, category, order-status, and product models that can be migrated into shared production domain contracts
- Existing error boundaries and SSR failure handling
- Existing SEO metadata, sitemap, robots, structured data, and noindex behavior for private pages

## Architecture decision gate

Do not pick infrastructure blindly.

The preferred direction, because it fits the current app and existing TODO comments, is:

- Keep **TanStack Start** as the frontend and same-origin server/API layer.
- Put business logic in typed server functions/routes and server-only service modules.
- Use a managed **PostgreSQL** database.
- Prefer **Supabase PostgreSQL + Auth + Storage** if the owner confirms it, using migrations, generated types, Row Level Security, and private storage buckets.
- Keep privileged operations server-side; never expose service-role credentials.
- Keep deployment compatible with the confirmed Nitro target.

Before implementing provider-specific code, confirm:

1. Production hosting target: a Cloudflare-compatible Nitro build, a Node server, Vercel, or another platform?
2. Database/auth/storage provider: Supabase confirmed, or another PostgreSQL provider?
3. Is there an existing Supabase project, and can the required public/server credentials be supplied securely?
4. Customer authentication for the first production release: email/password, phone OTP, both, or another method? Phone OTP requires a confirmed SMS provider and cost plan.
5. Real business email, phone, WhatsApp, bKash number/type, legal business name if any, domain, and social URLs.
6. Transactional email provider and sender domain.
7. Steadfast and/or Pathao merchant/API credentials and webhook documentation.
8. Whether the first release remains manual bKash verification only, with no payment gateway.
9. Required staff accounts and owner/admin/staff permission policy.
10. Production return, refund, privacy, terms, and data-retention rules that require owner/legal approval.

If these are unavailable, build provider-neutral interfaces, migrations, validation, tests, and safe development adapters, but clearly mark the affected integration as blocked. Never report it as live.

## Required production architecture

Use clean layers without overengineering:

1. **UI/routes** — current pages and components, visually preserved.
2. **Query/action adapters** — hooks or route loaders that call typed server operations.
3. **Server/API layer** — authentication, validation, authorization, idempotency, transactions, and response contracts.
4. **Domain services** — catalog, pricing, cart quote, checkout, inventory, orders, payment review, courier, accounts, content, reporting, notifications, and audit.
5. **Repository/data layer** — database access isolated from route components.
6. **External adapters** — storage, email, SMS, WhatsApp links, Steadfast, Pathao, and future payment gateway interfaces.
7. **Infrastructure** — environment validation, logging, monitoring, migrations, seeds, CI, backups, and deployment documentation.

Do not place database calls directly throughout React components. Do not create one massive service file. Do not expose raw database records as unstable public API contracts.

## Required database/domain model

Design normalized migrations with UUID/internal IDs, timestamps, soft-delete/archive behavior where appropriate, foreign keys, constraints, indexes, and auditability.

At minimum model:

### Identity and access

- auth users/provider identities
- customer profiles
- saved addresses
- saved measurement profiles
- staff profiles
- roles
- permissions
- staff-role assignments
- active/revoked sessions where supported

### Catalog

- product categories
- collections/discovery groups
- products
- product variants/options
- ready-size variants
- girls-size variants
- custom-size eligibility and charges
- product media with order, alt text, type, dimensions, storage key, and usage references
- product attributes for garment and beauty-specific fields
- product SEO metadata
- product status: draft, active, hidden, archived
- reviews and moderation state

### Inventory

- inventory levels per product/variant
- low-stock thresholds
- inventory reservations
- inventory movements with reason, actor, order reference, previous quantity, next quantity, and timestamp
- backorder policy

### Cart, pricing, and promotions

- optional authenticated carts and cart items
- coupons/promotions
- category/product eligibility
- start/end times
- global and per-customer usage limits
- redemption records
- free-shipping promotions
- immutable price/discount quote snapshots used at checkout

### Orders

- orders
- order items with immutable product/variant/name/image/price/custom-charge snapshots
- custom measurements attached to the relevant order item
- customer and delivery address snapshots
- delivery zone and shipping charge
- coupon/discount snapshot
- internal/customer notes
- order status history
- cancellation, return, and refund records
- idempotency keys
- sequential, collision-safe public order numbers

### Payments

- payment submissions
- normalized sender number
- normalized/uppercase TrxID
- private payment screenshot/evidence object reference
- pending, verified, rejected, correction-required, suspicious states
- verifier, verification timestamp, reason/note
- unique/index strategy to detect duplicate TrxIDs without blocking legitimate administrative correction workflows
- refund records

### Courier/shipping

- courier providers
- shipments
- booking request/response references
- tracking IDs
- shipment status/events
- webhook event store with idempotency and signature-verification status
- retry/error fields

### Content and operations

- banners with placement and scheduling
- editable policies/content blocks where the UI supports them
- site/business settings
- delivery-zone settings
- size charts and custom measurement field settings
- contact messages
- newsletter subscriptions with consent/unsubscribe state
- notification outbox/logs
- audit logs

Do not duplicate derived customer totals, product counts, or reports without a justified aggregation strategy. Add indexes for public slugs, SKU, status, created time, customer phone/email, order number, TrxID, tracking ID, coupon code, inventory variant, and admin filters.

## Server/API requirements

Implement typed operations for all existing screens. Use the framework-native server mechanism and same-origin APIs unless a documented external API is required.

### Public catalog

- list/search/filter/sort/paginate products
- retrieve product by slug
- retrieve categories, collections, active banners, settings, size settings, and approved reviews
- return only public fields
- support SEO/SSR loaders and dynamic sitemap generation
- use cache/revalidation appropriate to catalog data

### Authentication and account

- register
- login
- logout
- current session/user
- forgot/reset password
- email/phone verification according to the confirmed auth method
- profile CRUD
- address CRUD and one-default invariant
- measurement-profile CRUD
- password/security/session controls where supported
- server-side route protection for account pages

### Cart and checkout

- optionally preserve guest cart/wishlist locally for usability, but never trust it for final pricing
- merge/sync guest data after login without duplicating items
- produce a server-authoritative cart/checkout quote
- validate product visibility, variant, size, custom measurements, stock, price, sale price, custom charge, coupon, delivery zone, shipping, and free-delivery rules
- create orders transactionally
- support an idempotency key so double-clicks/retries cannot create duplicate orders
- reserve/decrement inventory atomically and record inventory movements
- release reservations on cancellation/expiry as designed
- upload payment evidence to private storage with server-side file validation
- normalize and validate Bangladesh phone numbers and TrxIDs
- never accept totals calculated by the browser as authoritative

### Customer orders and tracking

- authenticated users can view only their own orders
- guest tracking must require a secure combination such as order ID plus matching phone/verification token; never expose all orders for a phone number through an unauthenticated search
- return customer-safe status history only
- exclude internal notes, payment evidence, staff IDs, and sensitive metadata
- allow reorder using current product availability/pricing, not stale order prices

### Admin

Connect every existing admin module to real persistent operations:

- dashboard metrics
- products
- categories/collections
- inventory and movement history
- size settings
- orders and status history
- payment review
- courier booking/tracking
- customers
- coupons
- reviews
- banners
- media library
- policies/content
- reports/export
- site settings
- staff/roles/permissions
- audit logs

Every admin read/write must enforce authorization on the server. Hiding a menu item is not security.

### Integrations

- Keep the first payment flow as **manual bKash verification** unless the owner explicitly approves a gateway.
- Create a payment-provider abstraction so a future gateway can be added without redesigning checkout.
- Create a courier adapter interface.
- Implement Steadfast first only after credentials/docs are supplied; Pathao second.
- Verify webhook signatures where supported, store raw event identifiers safely, process idempotently, and log failures/retries.
- Existing WhatsApp links may remain, but server-side notifications should use a notification/outbox abstraction rather than blocking order transactions.

## Security requirements

Treat this as a real commerce system handling personal, order, and payment-related data.

1. Delete the hard-coded admin password and browser-only admin guard immediately after real auth is ready.
2. Enforce owner/admin/staff RBAC on the server for every operation.
3. Use secure, HTTP-only, Secure, SameSite cookies/session handling supported by the chosen auth stack.
4. Validate every server input with shared schemas; client validation is only UX.
5. Add rate limits for login, registration, reset, contact, newsletter, checkout, coupon checks, review submission, payment submission, and tracking.
6. Add CSRF/origin protection for state-changing same-origin operations as appropriate to the framework/session model.
7. Keep secrets in validated server-only environment variables. Never use `VITE_*` for secrets.
8. Add environment schema validation with safe startup failures and redacted logs.
9. Use private storage for payment screenshots and sensitive documents; access through short-lived signed URLs only for authorized staff.
10. Validate upload MIME type, magic bytes, extension, dimensions, and size. Generate safe storage keys; never trust filenames.
11. Apply RLS/least privilege if Supabase is selected. Test customer isolation and staff permissions.
12. Prevent IDOR, mass assignment, phone/order enumeration, duplicate order submission, coupon race conditions, overselling, duplicate webhook processing, and duplicate TrxID abuse.
13. Use parameterized data access and output escaping. Preserve the existing explicit escaping in printable output.
14. Mask PII and payment identifiers in logs and routine admin lists where full values are unnecessary.
15. Record security-relevant admin actions in immutable audit logs.
16. Add sensible security headers/CSP while testing all existing fonts, images, dialogs, and external WhatsApp/social links for compatibility.
17. Do not leak stack traces, secrets, SQL, or provider responses to customers.

## Migration from prototype data

- Preserve current product IDs/slugs/names/types/prices/images/stock/sizes/content during the initial seed unless the owner approves changes.
- Seed the current catalog, categories, settings, and useful demo structures through repeatable development/initial-production seed scripts—not runtime hard-coded arrays.
- Keep demo orders/customers/staff out of production by default.
- Replace runtime imports of `PRODUCTS`, `ORDERS`, and route-local seed arrays with repositories/query results.
- Static assets may remain bundled during the first migration if necessary, but the media library must support real private/public storage and stable URLs.
- Provide a rollback-safe migration strategy and database backup instructions.
- Do not drop or overwrite production data in normal deployment commands.

## UI integration rules

- Preserve all current visual markup wherever possible.
- Reuse existing loading, empty, error, badge, toast, dialog, table, and form components.
- Keep current mobile behavior and accessibility.
- Connect forms to real mutations with proper pending, success, validation, conflict, and retry states.
- Keep optimistic UI only where rollback is safe.
- Do not display success until the server confirms success.
- Replace local object URLs with stored media URLs after successful upload.
- Keep localStorage only for safe UX state such as guest cart/wishlist, announcement dismissal, or recently viewed items. Never use it as the source of truth for users, orders, payments, stock, permissions, or admin data.
- Add a one-time safe migration/cleanup path for old demo storage keys so stale browser data does not create confusing production behavior.
- Do not hand-edit `src/routeTree.gen.ts`; regenerate it through normal tooling.

## Reliability, observability, and operations

Implement:

- structured server logs with request/correlation IDs and redaction
- centralized error mapping
- production error monitoring compatible with the confirmed platform
- health/readiness endpoint that does not disclose secrets
- database migration and seed commands
- retry/backoff for safe external calls
- notification/outbox processing so emails/courier notifications do not break checkout transactions
- audit trail for admin changes
- backup and restore documentation
- data-retention/deletion procedures
- environment templates such as `.env.example` containing names only, never secrets
- local development setup documentation
- production deployment/runbook documentation
- incident rollback steps

## Testing and quality gates

The current project has only one visible unit test, so add meaningful coverage without changing the approved UI.

Required tests:

- domain/unit tests for pricing, shipping, coupon eligibility, phone normalization, measurement validation, order-state transitions, permissions, and inventory calculations
- database/repository integration tests
- auth and authorization tests
- customer-isolation/IDOR tests
- checkout transaction and idempotency tests
- inventory concurrency/oversell tests
- payment submission and duplicate TrxID tests
- upload validation tests
- courier adapter/webhook idempotency tests
- admin CRUD tests
- end-to-end smoke tests for the critical mobile and desktop journeys
- visual regression or screenshot checks for core pages to prove the UI did not change unexpectedly

Critical E2E journeys:

1. Browse/filter/search product → product detail → select ready/custom size → add to cart.
2. Apply valid/invalid coupon → delivery selection → server quote.
3. Guest checkout → payment evidence → one order only despite retry/double submit.
4. Customer registration/login → profile/address/measurement persistence → own orders only.
5. Secure guest tracking with order ID plus verification factor.
6. Admin login → product CRUD → storefront update.
7. Inventory adjustment → history → checkout stock enforcement.
8. Payment verification → order status history → customer-visible status.
9. Courier booking adapter → tracking update/webhook.
10. Role restrictions for Owner, Admin, and Staff.

At every implementation checkpoint run:

- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run test`
- integration tests
- E2E smoke tests
- `bun run build`

Do not suppress real errors, weaken TypeScript, disable lint rules broadly, or delete tests to make checks pass.

## Implementation sequence

### Stage 0 — Baseline and decision gate

- Full audit, baseline build/tests, restore point, architecture documents, dependency/deployment compatibility check, and focused questions.

### Stage 1 — Foundation

- Environment validation
- database project/migrations/types
- repository/service structure
- auth/session/RBAC
- server-side route guards
- audit logging foundation
- seed strategy

### Stage 2 — Catalog, media, and settings

- Product/category/collection/variant/media/inventory persistence
- public catalog queries and SSR metadata
- admin product/category/inventory/media/size/settings wiring
- stable caching/revalidation

### Stage 3 — Authoritative pricing and checkout

- server quote
- coupon engine
- shipping rules
- transactional order creation
- idempotency
- stock reservation/movements
- private payment-evidence upload
- manual bKash submission state

### Stage 4 — Customer accounts and orders

- account/profile/address/measurement persistence
- cart/wishlist migration/sync strategy
- own-order history/details
- secure guest tracking
- reorder behavior

### Stage 5 — Admin sales operations and integrations

- order/payment/customer modules
- status history
- courier adapter, Steadfast first when credentials are available
- Pathao adapter second
- notifications/outbox
- reports and exports

### Stage 6 — Content and operational modules

- reviews, banners, policies, contact, newsletter, staff management, permissions, audit view, and site configuration

### Stage 7 — Hardening and launch readiness

- security review
- rate limits and headers
- concurrency tests
- observability
- CI/CD
- backups/runbooks
- performance/accessibility/SEO regression
- production migration and smoke-test checklist

Complete each stage in small reviewable commits. Do not start the next stage while current critical tests fail.

## Definition of done

Phase 2 is complete only when:

- Every current route still exists and retains its approved visual design and behavior.
- The storefront reads live persistent catalog data.
- Admin changes persist and affect the storefront correctly.
- Customer and admin authentication are real and enforced server-side.
- Owner/Admin/Staff permissions are enforced, not merely displayed.
- Checkout is server-authoritative, transactional, idempotent, and stock-safe.
- Orders, order items, custom measurements, payment submissions, status history, and inventory movements persist correctly.
- Payment screenshots are securely stored and staff-authorized.
- Guest tracking cannot enumerate orders or reveal another customer’s data.
- Manual bKash verification works as an auditable state machine.
- Courier integrations are real where credentials exist, or explicitly blocked—not faked.
- Contact, newsletter, reviews, banners, settings, policies, media, reports, and audit modules are connected according to scope.
- No hard-coded password, service secret, placeholder production credential, or browser-only authorization remains.
- Production does not depend on runtime mock arrays or localStorage for protected/business data.
- Database migrations, seeds, rollback, backups, environment setup, and deployment are documented.
- Typecheck, lint, formatting, unit, integration, E2E, security-critical, and production build checks pass.
- A visual regression review confirms no unintended UI change on mobile and desktop.

## Required progress reporting

After each stage, report:

1. Files added/modified.
2. Database migrations added.
3. Current data flow before vs. after.
4. Security controls implemented.
5. Tests added and exact command results.
6. Any visual differences—expected answer should normally be “none,” with screenshots if possible.
7. Remaining blockers requiring owner credentials or business decisions.
8. Rollback instructions.

## Final warning

Do not confuse “the page renders” with “production ready.” Do not merely wrap mock arrays in API endpoints. Do not move insecure client logic to an unprotected server route. Do not report a provider integration as complete using a mock response. Preserve the interface, but rebuild the underlying data, identity, permissions, checkout, inventory, payment, and operations flows as a real commerce system.
