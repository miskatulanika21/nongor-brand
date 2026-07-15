# Nongorr Test Credentials

Below are the default credentials configured for testing the various roles and permissions in the system. All test accounts have been created in the live Supabase project (`xomjxtmhkglhuiccekld`) that `.env` points at — there is no separate staging database yet. Verified 2026-07-16: all six accounts exist, are email-confirmed, and hold the roles listed; none have any orders yet.

## Credentials Table

| Role         | Email                   | Password          | Access Level / Target Area                                    |
| :----------- | :---------------------- | :---------------- | :------------------------------------------------------------ |
| **Owner**    | `owner@nongorr.test`    | `NongorrTest123!` | Admin Dashboard (Full Owner permissions including audit logs) |
| **Admin**    | `admin@nongorr.test`    | `NongorrTest123!` | Admin Dashboard (Manage products, orders, settings, etc.)     |
| **Staff**    | `staff@nongorr.test`    | `NongorrTest123!` | Admin Dashboard (View-only and operational/processing tasks)  |
| **Customer** | `customer@nongorr.test` | `NongorrTest123!` | Storefront Customer Account (Orders, checkout, addresses)     |

---

## QA Credentials (Legacy / Auto-tests)

For Playwright E2E automation and legacy QA scripts, the following credentials are also available:

| Role            | Email                      | Password         |
| :-------------- | :------------------------- | :--------------- |
| **QA Admin**    | `qa-admin@nongorr.test`    | `QApassword123!` |
| **QA Customer** | `qa-customer@nongorr.test` | `QApassword123!` |

> [!NOTE]
> The passwords meet the system's strict security validation criteria (minimum 10 characters, mixed case, containing both digits and special characters).
