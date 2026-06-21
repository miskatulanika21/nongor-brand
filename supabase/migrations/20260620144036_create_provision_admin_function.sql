-- Migration 5: Create provision_staff RPC function
-- Version: 20260620144036
--
-- Atomically creates a staff profile and audit log entry.
-- Called from the provisioning script via the service_role client.

CREATE OR REPLACE FUNCTION private.provision_staff(
  p_user_id uuid,
  p_role private.staff_role DEFAULT 'owner',
  p_display_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.staff_profiles (user_id, role, is_active, display_name)
  VALUES (p_user_id, p_role, true, p_display_name)
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    display_name = COALESCE(EXCLUDED.display_name, staff_profiles.display_name),
    updated_at = now()
  RETURNING jsonb_build_object(
    'id', id,
    'user_id', user_id,
    'role', role,
    'is_active', is_active,
    'display_name', display_name
  ) INTO v_result;

  -- Log the provisioning action
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_user_id,
    'staff.provisioned',
    'staff_profiles',
    p_user_id::text,
    jsonb_build_object('role', p_role::text, 'display_name', p_display_name)
  );

  RETURN v_result;
END;
$$;

-- Only service_role may call this
GRANT EXECUTE ON FUNCTION private.provision_staff(uuid, private.staff_role, text)
  TO service_role;
