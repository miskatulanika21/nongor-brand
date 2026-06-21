-- Migration 6: Fix infinite recursion in staff_profiles RLS policies
-- Version: 20260620150547
--
-- The admin_read_all_staff, owner_insert_staff, and owner_update_staff
-- policies on staff_profiles used self-referencing subqueries that caused
-- infinite recursion when PostgreSQL evaluated RLS.
--
-- Fix: replace the subqueries with private.current_staff_role() which is
-- SECURITY DEFINER and bypasses RLS on staff_profiles.

-- Drop the recursive policies
DROP POLICY IF EXISTS "admin_read_all_staff" ON public.staff_profiles;
DROP POLICY IF EXISTS "owner_insert_staff" ON public.staff_profiles;
DROP POLICY IF EXISTS "owner_update_staff" ON public.staff_profiles;

-- Recreate using the SECURITY DEFINER function
CREATE POLICY "admin_read_all_staff"
  ON public.staff_profiles
  FOR SELECT
  TO authenticated
  USING (
    private.current_staff_role() IN ('owner', 'admin')
  );

CREATE POLICY "owner_insert_staff"
  ON public.staff_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    private.current_staff_role() = 'owner'
  );

CREATE POLICY "owner_update_staff"
  ON public.staff_profiles
  FOR UPDATE
  TO authenticated
  USING (
    private.current_staff_role() = 'owner'
  );
