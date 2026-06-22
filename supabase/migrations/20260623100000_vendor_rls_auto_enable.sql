-- Migration 13: Vendor rls_auto_enable() + the ensure_rls event trigger into the repo.
-- Version: 20260623100000
--
-- Context: public.rls_auto_enable() and its `ensure_rls` event trigger existed on
-- the production DB but were created by NO repo migration (out-of-band drift found
-- 2026-06-23). This migration brings them under version control so a from-empty
-- deploy reproduces production faithfully — including the auto-RLS safety net that
-- enables Row Level Security on any future `public` table at DDL time.
--
-- Design: this migration is SELF-CORRECTING and IDEMPOTENT, so it is safe whether
-- it runs against a fresh database (CI migrate-from-empty) or the live project
-- where the objects already exist:
--   * CREATE OR REPLACE FUNCTION — re-defines the body identically.
--   * REVOKE EXECUTE             — least privilege; harmless if already revoked.
--                                  (Event triggers fire at the system level, so
--                                   revoking EXECUTE does NOT disable auto-RLS.)
--   * DROP EVENT TRIGGER IF EXISTS + CREATE — event triggers have no OR REPLACE.
--
-- It is intentionally ordered AFTER 20260623000000_advisor_hardening: on a fresh
-- DB the hardening migration's guarded REVOKE no-ops (function not yet present),
-- then this migration creates the function WITH the grants already revoked, so the
-- end state matches production (function present, no anon/authenticated EXECUTE,
-- trigger wired). On production every statement is a no-op-equivalent.

-- ---- function ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$function$;

-- ---- least privilege --------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- ---- event trigger ----------------------------------------------------------
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
