-- Stage 7 (P1 / F-14) — promote an EXISTING account to staff.
--
-- Before this, staff provisioning only ever invited a NEW email
-- (auth.admin.inviteUserByEmail), which fails outright when the person already
-- has a customer account — so an existing customer could never be made staff.
--
-- This RPC resolves the email to an existing auth.users id IN SQL (a SECURITY
-- DEFINER read — deliberately not auth.admin.listUsers, which the F-13 fix
-- avoided because it silently pages at 50 users), then inserts the staff_profiles
-- row via the same battle-tested private.provision_staff (upsert + the
-- guard_owner_safety trigger + canonical staff.provisioned audit). It also writes
-- a distinct staff.promoted audit so the trail shows a customer→staff transition.
--
-- Control flow (no raise for the not-found case, so the caller can fall back to
-- the invite flow cleanly):
--   { status: 'promoted',   user_id }  — existing account, now staff
--   { status: 'not_found'            }  — no account with that email → invite
--   { status: 'already_staff', user_id } — already has a staff profile
--
-- Authorization is enforced in the server fn (owner/admin role + MFA step-up +
-- rate limit) exactly like the invite path; EXECUTE is service-role only; the
-- owner-safety trigger is the final row-level boundary.

CREATE OR REPLACE FUNCTION api.promote_to_staff(
  p_email text,
  p_role text DEFAULT 'staff',
  p_display_name text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(p_email))
  ORDER BY created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = v_user_id) THEN
    RETURN jsonb_build_object('status', 'already_staff', 'user_id', v_user_id);
  END IF;

  -- Reuse the shared provisioning path (upsert + owner-safety trigger +
  -- canonical staff.provisioned audit).
  PERFORM private.provision_staff(
    v_user_id,
    p_role::private.staff_role,
    p_display_name,
    p_actor_id,
    true
  );

  -- Distinct trail entry: this was an existing account promoted, not an invite.
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'staff.promoted', 'staff_profiles', v_user_id::text,
          jsonb_build_object('role', p_role));

  RETURN jsonb_build_object('status', 'promoted', 'user_id', v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION api.promote_to_staff(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.promote_to_staff(text, text, text, uuid) TO service_role;

COMMENT ON FUNCTION api.promote_to_staff(text, text, text, uuid) IS
  'Stage 7 / F-14: promote an existing account (resolved by email) to staff, reusing private.provision_staff. Returns status promoted|not_found|already_staff. Service-role only; the server fn enforces role + MFA step-up.';
