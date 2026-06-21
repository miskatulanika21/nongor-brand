-- Migration 8: Correct audit actor attribution, add role/active RPCs, and
-- enforce owner-safety at the database level (defense in depth).
-- Version: 20260621090000
--
-- Fixes:
--   1. provision_staff() recorded the TARGET as the audit actor. It now takes
--      an explicit p_actor_id (the provisioner) and p_is_active, and attributes
--      the audit entry to the real actor (null = system/bootstrap).
--   2. Adds update_staff_role() and set_staff_active() RPCs (service_role only)
--      with correct actor attribution and audit logging.
--   3. Adds a BEFORE UPDATE/DELETE trigger that prevents demoting, deactivating,
--      or deleting the LAST active owner — enforced even if app logic is bypassed.

-- ============================================================
-- 1. Owner-safety trigger
-- ============================================================
CREATE OR REPLACE FUNCTION private.guard_owner_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  other_active_owners integer;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.role = 'owner'::private.staff_role AND OLD.is_active THEN
      SELECT count(*) INTO other_active_owners
      FROM public.staff_profiles
      WHERE role = 'owner'::private.staff_role AND is_active AND id <> OLD.id;
      IF other_active_owners = 0 THEN
        RAISE EXCEPTION 'Cannot remove the last active owner';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: block demotion or deactivation of the last active owner.
  IF OLD.role = 'owner'::private.staff_role
     AND OLD.is_active
     AND (NEW.role <> 'owner'::private.staff_role OR NEW.is_active = false) THEN
    SELECT count(*) INTO other_active_owners
    FROM public.staff_profiles
    WHERE role = 'owner'::private.staff_role AND is_active AND id <> OLD.id;
    IF other_active_owners = 0 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last active owner';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_safety ON public.staff_profiles;
CREATE TRIGGER trg_owner_safety
  BEFORE UPDATE OR DELETE ON public.staff_profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_owner_safety();

-- ============================================================
-- 2. Reworked provision_staff() with correct actor attribution
-- ============================================================
CREATE OR REPLACE FUNCTION private.provision_staff(
  p_user_id uuid,
  p_role private.staff_role DEFAULT 'owner'::private.staff_role,
  p_display_name text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.staff_profiles (user_id, role, is_active, display_name)
  VALUES (p_user_id, p_role, p_is_active, p_display_name)
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    display_name = COALESCE(EXCLUDED.display_name, public.staff_profiles.display_name),
    updated_at = now()
  RETURNING jsonb_build_object(
    'id', id, 'user_id', user_id, 'role', role,
    'is_active', is_active, 'display_name', display_name
  ) INTO v_result;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id,
    'staff.provisioned',
    'staff_profiles',
    p_user_id::text,
    jsonb_build_object('role', p_role::text, 'is_active', p_is_active, 'system', p_actor_id IS NULL)
  );

  RETURN v_result;
END;
$$;

-- Drop the old 3-arg signature so callers move to the explicit-actor version.
DROP FUNCTION IF EXISTS private.provision_staff(uuid, private.staff_role, text);

REVOKE ALL ON FUNCTION private.provision_staff(uuid, private.staff_role, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.provision_staff(uuid, private.staff_role, text, uuid, boolean)
  TO service_role;

-- ============================================================
-- 3. update_staff_role()
-- ============================================================
CREATE OR REPLACE FUNCTION private.update_staff_role(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_new_role private.staff_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_role private.staff_role;
  v_result jsonb;
BEGIN
  SELECT role INTO v_old_role FROM public.staff_profiles WHERE user_id = p_target_user_id;
  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'Staff profile not found';
  END IF;

  UPDATE public.staff_profiles
  SET role = p_new_role, updated_at = now()
  WHERE user_id = p_target_user_id
  RETURNING jsonb_build_object('user_id', user_id, 'role', role) INTO v_result;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id, 'staff.role_changed', 'staff_profiles', p_target_user_id::text,
    jsonb_build_object('from', v_old_role::text, 'to', p_new_role::text)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.update_staff_role(uuid, uuid, private.staff_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.update_staff_role(uuid, uuid, private.staff_role) TO service_role;

-- ============================================================
-- 4. set_staff_active()
-- ============================================================
CREATE OR REPLACE FUNCTION private.set_staff_active(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE public.staff_profiles
  SET is_active = p_active, updated_at = now()
  WHERE user_id = p_target_user_id
  RETURNING jsonb_build_object('user_id', user_id, 'is_active', is_active) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Staff profile not found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id,
    CASE WHEN p_active THEN 'staff.activated' ELSE 'staff.deactivated' END,
    'staff_profiles', p_target_user_id::text,
    jsonb_build_object('is_active', p_active)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.set_staff_active(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_staff_active(uuid, uuid, boolean) TO service_role;
