-- Migration 12: Supabase security-advisor hardening (post Stage 1.5).
-- Version: 20260623000000
--
-- Clears two pre-existing security-advisor findings that were outside the
-- Stage 1.5 scope but block declaring the security stage fully closed:
--
--   (1) anon/authenticated EXECUTE on public.rls_auto_enable()
--       rls_auto_enable() is an EVENT TRIGGER function (RETURNS event_trigger),
--       wired to the `ensure_rls` event trigger. Calling it directly via RPC is
--       harmless (its first action, pg_event_trigger_ddl_commands(), raises
--       outside an event-trigger context), but there is no reason for anon /
--       authenticated / PUBLIC to hold EXECUTE on it. Event triggers fire via
--       the system regardless of EXECUTE grants, so revoking does NOT disable
--       the auto-RLS behaviour — it only removes the direct-call surface and the
--       advisor warning.
--
--   (2) public.set_updated_at() had a mutable search_path
--       It only sets NEW.updated_at = now(); now() resolves from pg_catalog
--       (always implicitly searched), so pinning search_path = '' is safe.

-- NOTE: public.rls_auto_enable() + its `ensure_rls` event trigger currently live
-- on the production DB but are NOT created by any repo migration (out-of-band
-- drift, pre-existing). The REVOKE is therefore guarded so this migration applies
-- cleanly to a fresh database (migrate-from-empty CI) where the function does not
-- exist, while still hardening the deployed project where it does. See
-- docs/stage-1.5-operational-closure-followup.md for the recommended follow-up to
-- vendor rls_auto_enable/ensure_rls into a migration.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

ALTER FUNCTION public.set_updated_at() SET search_path = '';
