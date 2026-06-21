# Stage 1 Database Schema — Nongorr Studio

## Overview

Stage 1 establishes the staff/admin RBAC layer on Supabase. All objects use
Row Level Security (RLS) and a `private` schema for privileged helper functions.

## Schema Architecture

```
public                       private (system use only)
├── staff_profiles           ├── staff_role (enum)
├── audit_logs               ├── role_weight()
└── set_updated_at()         ├── meets_minimum_role()
                             ├── current_staff_role()   ← SECURITY DEFINER
                             └── provision_staff()       ← SECURITY DEFINER
```

## Tables

### `public.staff_profiles`

| Column       | Type               | Nullable | Default | Notes                   |
| ------------ | ------------------ | -------- | ------- | ----------------------- |
| id           | bigint (identity)  | NO       | auto    | Primary key             |
| user_id      | uuid               | NO       | —       | FK → auth.users, unique |
| role         | private.staff_role | NO       | 'staff' | owner/admin/staff       |
| is_active    | boolean            | NO       | true    |                         |
| display_name | text               | YES      | NULL    |                         |
| created_at   | timestamptz        | NO       | now()   |                         |
| updated_at   | timestamptz        | NO       | now()   | Auto-set by trigger     |

**Indexes:** user_id (unique), role

**RLS policies:**

| Policy               | Command | Uses                   | Who               |
| -------------------- | ------- | ---------------------- | ----------------- |
| staff_read_own       | SELECT  | `user_id = auth.uid()` | Any authenticated |
| admin_read_all_staff | SELECT  | `current_staff_role()` | owner, admin      |
| owner_insert_staff   | INSERT  | `current_staff_role()` | owner only        |
| owner_update_staff   | UPDATE  | `current_staff_role()` | owner only        |

### `public.audit_logs`

| Column      | Type              | Nullable | Default | Notes                  |
| ----------- | ----------------- | -------- | ------- | ---------------------- |
| id          | bigint (identity) | NO       | auto    | Primary key            |
| actor_id    | uuid              | YES      | —       | FK → auth.users        |
| action      | text              | NO       | —       | e.g. staff.provisioned |
| target_type | text              | YES      | —       |                        |
| target_id   | text              | YES      | —       |                        |
| metadata    | jsonb             | YES      | '{}'    |                        |
| created_at  | timestamptz       | NO       | now()   |                        |

**Indexes:** actor_id, action, created_at (DESC)

**RLS policies:**

| Policy                | Command | Uses                   | Who          |
| --------------------- | ------- | ---------------------- | ------------ |
| admin_read_audit_logs | SELECT  | `current_staff_role()` | owner, admin |

## Enum

### `private.staff_role`

Values: `'staff'` (weight 10) → `'admin'` (weight 20) → `'owner'` (weight 30)

## Functions

### `private.current_staff_role()`

- **Purpose:** Read the caller's staff role without triggering RLS recursion
- **Security:** `SECURITY DEFINER`, `SET search_path = ''`
- **Grants:** `authenticated` only (PUBLIC revoked)

### `private.role_weight(r staff_role) → integer`

- **Purpose:** Convert a role to an integer for comparison
- **Security:** `IMMUTABLE`, `SET search_path = ''`
- **Grants:** `authenticated` only (PUBLIC revoked)

### `private.meets_minimum_role(actual, minimum) → boolean`

- **Purpose:** Check if `actual` role meets `minimum` requirement
- **Security:** `IMMUTABLE`, `SET search_path = ''`
- **Grants:** `authenticated` only (PUBLIC revoked)

### `private.provision_staff(p_user_id, p_role, p_display_name) → jsonb`

- **Purpose:** Atomically create/upsert staff profile + audit log
- **Security:** `SECURITY DEFINER`, `SET search_path = ''`
- **Grants:** `service_role` only (PUBLIC revoked)

### `public.set_updated_at() → trigger`

- **Purpose:** Auto-set `updated_at = now()` on UPDATE

## Migration History

| #   | Version        | Name                               | Description                               |
| --- | -------------- | ---------------------------------- | ----------------------------------------- |
| 1   | 20260620143927 | create_private_schema              | Schema, enum, role_weight, set_updated_at |
| 2   | 20260620143948 | create_staff_profiles              | Table, indexes, trigger, initial RLS      |
| 3   | 20260620144004 | create_current_staff_role_function | SECURITY DEFINER helper                   |
| 4   | 20260620144019 | create_audit_logs                  | Table, indexes, RLS                       |
| 5   | 20260620144036 | create_provision_admin_function    | Atomic provisioning RPC                   |
| 6   | 20260620150547 | fix_staff_profiles_rls_recursion   | Replace subqueries with function calls    |
| 7   | 20260620165800 | harden_security_definer_functions  | search_path, revoke PUBLIC, fix audit     |

## Security Notes

1. All `SECURITY DEFINER` functions use `SET search_path = ''` to prevent
   search-path hijacking.
2. All private functions have `PUBLIC` execute revoked; only minimum required
   roles have explicit grants.
3. `provision_staff()` is only callable by `service_role` — never by
   authenticated users directly.
4. RLS policies on `staff_profiles` use `current_staff_role()` to avoid
   infinite recursion (the function bypasses RLS via SECURITY DEFINER).
