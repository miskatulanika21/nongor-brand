-- Migration 3: Create SECURITY DEFINER function for RLS policy use
-- Version: 20260620144004
--
-- This function reads the caller's staff role without triggering RLS,
-- because it runs as the function owner (postgres) via SECURITY DEFINER.

CREATE OR REPLACE FUNCTION private.current_staff_role()
RETURNS private.staff_role
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT role FROM public.staff_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;
