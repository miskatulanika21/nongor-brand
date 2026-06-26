-- Stage 2 hardening (F-02) — close the direct staff_profiles write path.
--
-- staff_profiles carried a legacy `GRANT INSERT, UPDATE ... TO authenticated`
-- plus `owner_insert_staff` / `owner_update_staff` RLS policies. Because the
-- `public` schema is exposed through PostgREST, an authenticated *owner* could
-- therefore POST/PATCH /rest/v1/staff_profiles directly — bypassing the whole
-- protected workflow (CSRF + permission + MFA step-up + rate limit + the
-- canonical staff audit) that the in-app path enforces.
--
-- All legitimate staff writes already go through service-role api.* RPCs
-- (provision_staff / update_staff_role / set_staff_active), which bypass RLS and
-- table grants entirely, so removing the authenticated write path changes no
-- supported behavior. SELECT stays intact: the identity resolver reads
-- staff_profiles under the caller's session via `staff_select_self_or_admin`.

-- Remove the authenticated-role write policies (service-role does not use them).
DROP POLICY IF EXISTS "owner_insert_staff" ON public.staff_profiles;
DROP POLICY IF EXISTS "owner_update_staff" ON public.staff_profiles;

-- Revoke direct write grants from the API roles. SELECT is deliberately kept so
-- the self/admin read policy keeps working; DELETE never had a policy anyway.
REVOKE INSERT, UPDATE, DELETE ON public.staff_profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.staff_profiles FROM anon;
