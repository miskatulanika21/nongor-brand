-- Migration 11: Make last-owner protection concurrency-safe.
-- Version: 20260622130000
--
-- Problem (Item C): private.guard_owner_safety() (migration 8) decides whether a
-- demotion/deactivation/deletion is allowed using a bare `SELECT count(*)` of
-- the OTHER active owners. Under PostgreSQL's default READ COMMITTED isolation,
-- two concurrent transactions each demoting/deactivating/deleting a DIFFERENT
-- active owner can BOTH read `other_active_owners >= 1` at the same instant and
-- BOTH commit — leaving zero active owners. A row-level lock on the edited row
-- does not help, because each transaction edits a different row.
--
-- Fix: take a transaction-level ADVISORY lock on a single constant key at the
-- very top of the guard, BEFORE evaluating the remaining-active-owner count.
-- This serializes every owner-safety-relevant mutation (all UPDATE demotion/
-- deactivation paths and every DELETE path) against each other: the second
-- transaction blocks until the first commits/rolls back, then re-reads an
-- accurate count and is correctly refused if it would remove the last owner.
-- The lock auto-releases at transaction end (xact-scoped). The staff table is
-- tiny and these mutations are rare, so the added contention is negligible.
--
-- This migration only CREATE OR REPLACEs the function body; the trigger
-- (trg_owner_safety BEFORE UPDATE OR DELETE) created in migration 8 is
-- unchanged and continues to call it. Migration 8 is NOT edited.
--
-- Note on built-ins under `SET search_path = ''`: pg_catalog is always
-- implicitly searched, so pg_advisory_xact_lock(), hashtext(), count() and
-- now() resolve without schema qualification (consistent with migration 8).

CREATE OR REPLACE FUNCTION private.guard_owner_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  other_active_owners integer;
BEGIN
  -- Serialize all owner-safety evaluations on one constant key. Acquired BEFORE
  -- the count check so concurrent demotion/deactivation/deletion of different
  -- owners cannot both pass. hashtext() gives a stable bigint key for this guard.
  PERFORM pg_advisory_xact_lock(hashtext('private.guard_owner_safety'));

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

-- ============================================================
-- Item D — transactional audit contract (verification, not a change)
-- ============================================================
-- The three critical staff mutations are defined in migration 8 as single
-- PL/pgSQL functions that perform the business mutation AND the canonical audit
-- INSERT with NO surrounding EXCEPTION block:
--
--   private.provision_staff()    INSERT staff_profiles  + INSERT audit_logs('staff.provisioned')
--   private.update_staff_role()  UPDATE staff_profiles  + INSERT audit_logs('staff.role_changed')
--   private.set_staff_active()   UPDATE staff_profiles  + INSERT audit_logs('staff.activated'|'deactivated')
--
-- Because a PL/pgSQL function runs inside the caller's transaction and has no
-- EXCEPTION handler, a failure of the canonical audit INSERT raises and rolls
-- back the entire function — the staff mutation cannot commit without its audit
-- row, and vice versa. The api.* wrappers (migration 10) only delegate, adding
-- no EXCEPTION handler, so the guarantee is preserved end-to-end. The
-- best-effort writeAudit() in staff.api.ts is SUPPLEMENTARY (e.g. 'staff.invited',
-- 'authz.denied') and never the canonical record. See
-- docs/stage-1.5-security-closure-report.md for the reproducible rollback proof.
