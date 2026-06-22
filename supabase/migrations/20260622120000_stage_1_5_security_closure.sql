-- Migration 10: Stage 1.5 security closure (Bug 1 + Bug 4).
-- Version: 20260622120000
--
-- Fixes:
--   Bug 1 (CRITICAL) — Staff RPCs are unreachable on a live project.
--     The privileged staff functions live in the `private` schema, which is
--     deliberately NOT exposed through PostgREST. `admin.rpc("provision_staff")`
--     therefore targets `public.provision_staff` (which does not exist) and
--     fails with "function not found". This migration adds an `api` schema with
--     thin SECURITY DEFINER wrappers that delegate to the `private` functions,
--     so they can be reached as `admin.schema("api").rpc(...)` while `private`
--     stays hidden.
--
--   Bug 4 (MEDIUM) — Audit-log RLS allowed admin + owner, but the application
--     permission registry (permissions.ts) treats `audit.view` as owner-only.
--     The database must be the final boundary, so the RLS policy is tightened
--     to owner-only to match the single source of truth.
--
-- Authorization model for the `api` wrappers:
--   These wrappers are EXECUTE-able by `service_role` only and are called from
--   the server via the service-role admin client. service_role carries no
--   `auth.uid()`, so `private.current_staff_role()` is null in this context —
--   an in-function role recheck is therefore impossible here and is intentionally
--   omitted. The authorization boundary is enforced in three layers that DO
--   apply: (1) the app calls these only after requireRole()/requireAssuranceLevel()
--   in staff.api.ts, (2) EXECUTE is granted to service_role only (revoked from
--   PUBLIC/anon/authenticated), and (3) the private.guard_owner_safety trigger
--   enforces the last-owner invariant at the row level regardless of caller.
--
-- The wrappers accept the role as `text` and cast to `private.staff_role`
-- internally so PostgREST never needs to introspect an enum that lives in a
-- non-exposed schema.

-- ============================================================
-- Bug 1 — `api` schema with service-role-only wrappers
-- ============================================================
CREATE SCHEMA IF NOT EXISTS api;

REVOKE ALL ON SCHEMA api FROM PUBLIC;
GRANT USAGE ON SCHEMA api TO service_role;

-- ---- api.provision_staff ----------------------------------------------------
CREATE OR REPLACE FUNCTION api.provision_staff(
  p_user_id uuid,
  p_role text DEFAULT 'owner',
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
  RETURN private.provision_staff(
    p_user_id,
    p_role::private.staff_role,
    p_display_name,
    p_actor_id,
    p_is_active
  );
END;
$$;

REVOKE ALL ON FUNCTION api.provision_staff(uuid, text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.provision_staff(uuid, text, text, uuid, boolean)
  TO service_role;

-- ---- api.update_staff_role --------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_staff_role(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN private.update_staff_role(
    p_actor_id,
    p_target_user_id,
    p_new_role::private.staff_role
  );
END;
$$;

REVOKE ALL ON FUNCTION api.update_staff_role(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.update_staff_role(uuid, uuid, text)
  TO service_role;

-- ---- api.set_staff_active ---------------------------------------------------
CREATE OR REPLACE FUNCTION api.set_staff_active(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN private.set_staff_active(
    p_actor_id,
    p_target_user_id,
    p_active
  );
END;
$$;

REVOKE ALL ON FUNCTION api.set_staff_active(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_staff_active(uuid, uuid, boolean)
  TO service_role;

-- IMPORTANT (manual deploy step, not expressible in SQL):
-- The `api` schema must be added to the project's PostgREST "Exposed schemas"
-- (Supabase Dashboard → Project Settings → API → Exposed schemas, or the
-- `[api] schemas` array in supabase/config.toml for CLI deploys) so that
-- `supabase-js` `.schema("api").rpc(...)` can reach these functions. Without
-- this, the calls 404. `private` must remain excluded.

-- ============================================================
-- Bug 4 — audit-log RLS tightened to owner-only
-- ============================================================
-- Matches OWNER_ONLY_PERMISSIONS["audit.view"] in src/lib/permissions.ts.
-- If admins should ever read audit logs, change permissions.ts instead and
-- make this policy match — there must be one source of truth.
DROP POLICY IF EXISTS "admin_read_audit_logs" ON public.audit_logs;

CREATE POLICY "admin_read_audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    private.current_staff_role() = 'owner'::private.staff_role
  );
