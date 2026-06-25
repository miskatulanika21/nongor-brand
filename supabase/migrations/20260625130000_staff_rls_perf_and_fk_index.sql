-- Advisor cleanup: staff_profiles SELECT policy performance + FK covering index.
--
-- Two Supabase performance advisors flagged public.staff_profiles:
--   * auth_rls_initplan          — `staff_read_own` called auth.uid() per row.
--   * multiple_permissive_policies — `staff_read_own` + `admin_read_all_staff`
--     were two PERMISSIVE policies for the same (authenticated, SELECT), so both
--     ran for every row.
--
-- Fix: collapse the two SELECT policies into ONE permissive policy whose auth
-- calls are wrapped in a scalar sub-select, so the planner evaluates them ONCE
-- (initplan) instead of per row. Semantics are preserved EXACTLY:
--   a staff member may read their own row, OR an owner/admin may read all rows.
-- private.current_staff_role() is SECURITY DEFINER and reads staff_profiles with
-- RLS bypassed, so referencing it here does not reintroduce the recursion that
-- 20260620150547_fix_staff_profiles_rls_recursion.sql resolved.
--
-- Also adds the covering index for product_inventory_movements.actor_id flagged
-- by the unindexed_foreign_keys advisor (the movement-history actor FK).

-- ---- staff_profiles: single, initplan-friendly SELECT policy ----------------
DROP POLICY IF EXISTS "staff_read_own" ON public.staff_profiles;
DROP POLICY IF EXISTS "admin_read_all_staff" ON public.staff_profiles;

CREATE POLICY "staff_select_self_or_admin"
  ON public.staff_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT private.current_staff_role()) = ANY (ARRAY['owner', 'admin']::private.staff_role[])
  );

-- ---- covering index for the movement-history actor FK -----------------------
CREATE INDEX IF NOT EXISTS idx_movements_actor
  ON public.product_inventory_movements (actor_id);
