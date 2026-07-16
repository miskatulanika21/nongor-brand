-- Reconcile public.audit_logs with production (Stage 7 / P6 drift fix).
--
-- The P6 restore drill (docs/stage-7-backup-and-dr.md §2) surfaced that
-- production's public.audit_logs had drifted from source control: an out-of-band
-- change gave it `id uuid DEFAULT gen_random_uuid()` plus an `ip_address inet`
-- column, while the committed migrations still produced `id bigint GENERATED
-- ALWAYS AS IDENTITY` and no ip_address. This forward migration adopts prod's
-- shape into version control so a fresh rebuild (CI migrations-local, or a real
-- DR restored from migrations) matches production.
--
-- Everything else already matches prod: the columns actor_id/action/target_type/
-- target_id/metadata/created_at, the actor_id → auth.users FK, the three indexes,
-- and the RLS policy (reconciled to `private.current_staff_role() = 'owner'` by
-- 20260622120000_stage_1_5_security_closure.sql).
--
-- IDEMPOTENT + FORWARD-ONLY: on prod (already uuid + ip_address) every step is a
-- guarded no-op, so applying this simply records the drift in schema history; on
-- a fresh database it performs the real conversion. Safe to retype the primary
-- key because nothing references audit_logs.id (verified: no inbound FKs), and
-- every writer inserts without an explicit id (the default supplies it).

-- 1. ip_address (present in prod, was missing here). Nullable; no writer sets it
--    today — it exists for request-origin capture.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS ip_address inet;

-- 2. id: bigint GENERATED ALWAYS AS IDENTITY → uuid DEFAULT gen_random_uuid().
DO $$
BEGIN
  IF (
    SELECT data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'audit_logs'
       AND column_name = 'id'
  ) = 'bigint' THEN
    -- Drop the IDENTITY property and default before retyping. Any pre-existing
    -- rows get fresh uuids (audit_logs.id is not FK-referenced); on a fresh CI
    -- database the table is empty at this point anyway.
    ALTER TABLE public.audit_logs ALTER COLUMN id DROP IDENTITY IF EXISTS;
    ALTER TABLE public.audit_logs ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.audit_logs
      ALTER COLUMN id TYPE uuid USING gen_random_uuid();
    ALTER TABLE public.audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END $$;
