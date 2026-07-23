# Nongorr Studio

The storefront and operations platform for **Nongorr** — a Bangladeshi fashion
label. It is a single full-stack application that serves both the customer-facing
shop and the staff admin panel, backed by Supabase (Postgres + Auth) and deployed
to Vercel.

> **Proprietary — all rights reserved.** This is closed-source software. See
> [`LICENSE`](./LICENSE). No license to use, copy, or distribute is granted.

Production: **https://nongorr.com**

---

## What's inside

**Storefront** — catalog, product pages with non-destructive image framing,
cart, coupons, guest and authenticated checkout, order placement and tracking,
customer accounts (profile, addresses, body measurements, security/MFA),
wishlist, size guides, and all policy/legal pages.

**Admin panel** (`/admin`) — products, categories, inventory, orders and
lifecycle actions, courier bookings and shipments, coupons, banners, media
library, customers, staff/RBAC, reviews, contact inbox, CMS policies, size
charts, reports/analytics, settings, audit log, and MFA management.

**Couriers** — live integrations with **Pathao** and **SteadFast**, including
booking, status webhooks, and shipment tracking.

**Security & ops** — CSP with per-request nonces, CSRF origin checks,
independent per-IP/per-account rate limiting, Sentry error monitoring, Vercel
Analytics + Speed Insights, and a full CI/CD + backup/DR runbook.

---

## Tech stack

| Layer           | Technology                                                      |
| --------------- | --------------------------------------------------------------- |
| Framework       | [TanStack Start](https://tanstack.com/start) (SSR) + React 19   |
| Routing         | TanStack Router (file-based, `src/routes/`)                     |
| Data            | TanStack Query                                                  |
| Backend         | Supabase — Postgres, Auth, RLS, Storage                         |
| Styling         | Tailwind CSS v4 + Radix UI primitives (shadcn-style components) |
| Forms / schema  | React Hook Form + Zod                                           |
| Build / bundler | Vite 7 + Nitro                                                  |
| Hosting         | Vercel (region `bom1`, co-located with Supabase `ap-south-1`)   |
| Monitoring      | Sentry, Vercel Analytics & Speed Insights                       |
| Tests           | Vitest (unit) + Playwright (e2e/smoke, axe a11y)                |
| Package manager | Bun                                                             |

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh)
- A Supabase project (URL, anon key, service-role key)

### Setup

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
#    then fill in the required values (see below)

# 3. Start the dev server (http://localhost:8080)
bun run dev
```

The dev server runs on **port 8080** — `VITE_SITE_URL` must match it so
CSRF-origin and OAuth-redirect checks line up locally.

### Required environment variables

At minimum you need Supabase credentials and the site URL. See
[`.env.example`](./.env.example) for the fully documented list (couriers, OAuth
flags, MFA enforcement, rate-limit store, etc.).

| Variable                    | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `VITE_SUPABASE_URL`         | Supabase project URL                           |
| `VITE_SUPABASE_ANON_KEY`    | Browser-safe anon/publishable key              |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** privileged key — never `VITE_` |
| `VITE_SITE_URL`             | Public app URL (`http://localhost:8080` local) |

---

## Scripts

| Command                    | What it does                                        |
| -------------------------- | --------------------------------------------------- |
| `bun run dev`              | Start the dev server on `:8080`                     |
| `bun run build`            | Production build                                    |
| `bun run preview`          | Preview a production build                          |
| `bun run typecheck`        | `tsc --noEmit`                                      |
| `bun run lint`             | ESLint                                              |
| `bun run format`           | Prettier write (`format:check` to verify)           |
| `bun run test`             | Unit tests (Vitest)                                 |
| `bun run test:e2e`         | Playwright e2e suite                                |
| `bun run test:smoke`       | Playwright smoke suite                              |
| `bun run check`            | Full gate: typecheck + lint + format + test + build |
| `bun run check:migrations` | Verify local migrations match the tracked set       |
| `bun run seed-catalog`     | Seed catalog data (`scripts/seed-catalog.ts`)       |
| `bun run provision-admin`  | Create an admin/owner account                       |

Run `bun run check` before pushing — it mirrors CI.

---

## Project structure

```
src/
  routes/            File-based routes
    _site.*          Customer storefront pages
    admin.*          Admin panel pages
    api.*            Server endpoints (health, webhooks, CSP report)
    auth.*           Auth callback / confirm / password update
  components/        UI components (Radix/shadcn-style + app components)
  lib/               Server & client logic (*.api.ts, checkout, security, courier)
  hooks/             React hooks
  assets/            Bundled assets
  server.ts          SSR entry + security-header wrapper
supabase/migrations/ Postgres schema & RLS (80 migrations)
scripts/             Ops scripts (seed, provision, migration/staging guards)
e2e/                 Playwright specs
docs/                Stage reports, launch cutover & runbooks
```

Server-side logic lives in `*.api.ts` modules. Server-only code must only be
imported inside handler closures — never at module top level in files reachable
from the client bundle.

---

## Testing & quality gates

- **Unit** — `bun run test` (Vitest, jsdom + Testing Library)
- **E2E / smoke / a11y** — `bun run test:e2e` (Playwright, `@axe-core/playwright`)
- **CI** runs the full `check` gate plus a migrations guard on every push.

---

## Deployment

Deployed on **Vercel**. The Vercel function region is pinned to `bom1` to stay
co-located with the Supabase database in AWS `ap-south-1` (Mumbai). Environment
variables are managed in the Vercel dashboard.

Operational runbooks live in [`docs/`](./docs) — notably the launch cutover,
CI/CD & rollback, backup & DR, secrets & rotation, and observability guides.

---

## Documentation

| Doc                                                  | Contents                             |
| ---------------------------------------------------- | ------------------------------------ |
| [`WALKTHROUGH.md`](./WALKTHROUGH.md)                 | How the actual data flows work today |
| [`CURRENT_STATUS.md`](./CURRENT_STATUS.md)           | Current state of every module        |
| [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) | Roadmap and staged plan              |
| [`SECURITY.md`](./SECURITY.md)                       | Security policy & reporting          |
| [`docs/`](./docs)                                    | Stage reports and ops runbooks       |

---

## Contact

- **Customer support:** support@nongorr.com
- **Website:** [nongorr.com](https://nongorr.com)

## License

Copyright © 2026 Nongorr (Miskatul Afrin Anika). All rights reserved.
Proprietary and confidential — see [`LICENSE`](./LICENSE).
For licensing / business inquiries: **support@nongorr.com**
