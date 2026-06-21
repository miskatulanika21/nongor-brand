-- Migration 7: Harden SECURITY DEFINER functions and fix audit_logs policy
-- Version: 20260620165800
--
-- Issues fixed:
-- 1. SECURITY DEFINER functions lacked search_path = '' (search_path hijack risk)
-- 2. Functions had PUBLIC execute grants (least privilege violation)
-- 3. audit_logs policy still used self-referencing subquery instead of current_staff_role()
--
-- After this migration all private.* functions use fully qualified names,
-- empty search_path, and minimum required grants.

-- ============================================================
-- 1. Harden current_staff_role()
-- ============================================================
CREATE OR REPLACE FUNCTION private.current_staff_role()
RETURNS private.staff_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.staff_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_staff_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_staff_role() TO authenticated;

-- ============================================================
-- 2. Harden role_weight()
-- ============================================================
CREATE OR REPLACE FUNCTION private.role_weight(r private.staff_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE r
    WHEN 'owner'::private.staff_role THEN 30
    WHEN 'admin'::private.staff_role THEN 20
    WHEN 'staff'::private.staff_role THEN 10
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION private.role_weight(private.staff_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.role_weight(private.staff_role) TO authenticated;

-- ============================================================
-- 3. Harden meets_minimum_role()
-- ============================================================
CREATE OR REPLACE FUNCTION private.meets_minimum_role(
  actual private.staff_role,
  minimum private.staff_role
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT private.role_weight(actual) >= private.role_weight(minimum);
$$;

REVOKE ALL ON FUNCTION private.meets_minimum_role(private.staff_role, private.staff_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.meets_minimum_role(private.staff_role, private.staff_role) TO authenticated;

-- ============================================================
-- 4. Harden provision_staff()
-- ============================================================
CREATE OR REPLACE FUNCTION private.provision_staff(
  p_user_id uuid,
  p_role private.staff_role DEFAULT 'owner'::private.staff_role,
  p_display_name text DEFAULT NULL
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
  VALUES (p_user_id, p_role, true, p_display_name)
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    display_name = COALESCE(EXCLUDED.display_name, public.staff_profiles.display_name),
    updated_at = now()
  RETURNING jsonb_build_object(
    'id', id,
    'user_id', user_id,
    'role', role,
    'is_active', is_active,
    'display_name', display_name
  ) INTO v_result;

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

REVOKE ALL ON FUNCTION private.provision_staff(uuid, private.staff_role, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.provision_staff(uuid, private.staff_role, text) TO service_role;

-- ============================================================
-- 5. Fix audit_logs policy to use current_staff_role() instead of subquery
-- ============================================================
DROP POLICY IF EXISTS "admin_read_audit_logs" ON public.audit_logs;

CREATE POLICY "admin_read_audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    private.current_staff_role() IN ('owner'::private.staff_role, 'admin'::private.staff_role)
  );
