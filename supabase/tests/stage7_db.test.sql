-- Stage 7 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty).
--
-- §delete_account covers api.delete_account (self-serve customer deletion):
--   * a customer's orders are anonymized to guest ownership (records survive,
--     user_id -> NULL, a fresh 64-char guest_token_hash, XOR still satisfied)
--   * personal data cascades away (customer_profiles); the auth.users row is
--     deleted; an account.deleted audit row is written
--   * a staff/owner account is rejected (staff_cannot_self_delete)
--   * an unknown user is rejected (account_not_found)
--   * grant posture: service-role only (revoked from anon/authenticated)
--
-- §promote_to_staff covers api.promote_to_staff (F-14 existing-customer→staff):
--   * an existing account (resolved case-insensitively by email) gets a
--     staff_profiles row + staff.promoted AND staff.provisioned audits; the
--     customer profile is preserved
--   * a second call returns already_staff; an unknown email returns not_found
--   * grant posture: service-role only

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, aud, role, instance_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-0000000007c1', 'cust7@test.local', 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),   -- customer with an order
  ('00000000-0000-0000-0000-0000000007b1', 'owner7@test.local', 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now());    -- staff (owner)

INSERT INTO public.staff_profiles (user_id, role, is_active, display_name) VALUES
  ('00000000-0000-0000-0000-0000000007b1', 'owner', true, 'Owner Seven');

INSERT INTO public.customer_profiles (user_id, full_name) VALUES
  ('00000000-0000-0000-0000-0000000007c1', 'Customer Seven');

INSERT INTO public.orders (
  order_no, user_id, customer_name, customer_phone,
  ship_district, ship_zone, ship_address,
  subtotal, discount, shipping_fee, total, payment_method, status, idempotency_key
) VALUES (
  'NGR-2026-0007C1', '00000000-0000-0000-0000-0000000007c1', 'Customer Seven', '01700000007',
  'Dhaka', 'dhaka', 'Seven Road, Dhaka',
  1000, 0, 60, 1060, 'cod', 'pending_confirmation', 'stage7-del-key-1'
);

-- ── §delete_account — happy path ─────────────────────────────────────────────
DO $$
DECLARE
  v_hash_before text;
  v_result jsonb;
BEGIN
  SELECT guest_token_hash INTO v_hash_before FROM public.orders WHERE order_no = 'NGR-2026-0007C1';

  v_result := api.delete_account('00000000-0000-0000-0000-0000000007c1');

  IF (v_result->>'orders_anonymized')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 order anonymized, got %', v_result;
  END IF;

  -- auth user gone
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000007c1') THEN
    RAISE EXCEPTION 'FAIL: auth user not deleted';
  END IF;

  -- personal data cascaded
  IF EXISTS (SELECT 1 FROM public.customer_profiles WHERE user_id = '00000000-0000-0000-0000-0000000007c1') THEN
    RAISE EXCEPTION 'FAIL: customer_profile not cascaded';
  END IF;

  -- order preserved, now anonymized to a guest with a rotated 64-char hash
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE order_no = 'NGR-2026-0007C1'
      AND user_id IS NULL
      AND guest_token_hash IS NOT NULL
      AND char_length(guest_token_hash) = 64
  ) THEN
    RAISE EXCEPTION 'FAIL: order not anonymized to guest';
  END IF;

  IF (SELECT guest_token_hash FROM public.orders WHERE order_no = 'NGR-2026-0007C1') = v_hash_before THEN
    RAISE EXCEPTION 'FAIL: guest_token_hash not rotated';
  END IF;

  -- audit written (actor_id nulled by cascade, id preserved in metadata)
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'account.deleted'
      AND target_id = '00000000-0000-0000-0000-0000000007c1'
      AND metadata->>'deleted_user_id' = '00000000-0000-0000-0000-0000000007c1'
  ) THEN
    RAISE EXCEPTION 'FAIL: account.deleted audit missing';
  END IF;
END $$;

-- ── §delete_account — staff rejected ─────────────────────────────────────────
DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM api.delete_account('00000000-0000-0000-0000-0000000007b1');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'staff_cannot_self_delete' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: staff self-delete was allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000007b1') THEN
    RAISE EXCEPTION 'FAIL: staff user was deleted despite guard';
  END IF;
END $$;

-- ── §delete_account — unknown user rejected ──────────────────────────────────
DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM api.delete_account('00000000-0000-0000-0000-00000000dead');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'account_not_found' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: unknown user did not raise'; END IF;
END $$;

-- ── §delete_account — grant posture (service-role only) ──────────────────────
DO $$
DECLARE
  v_anon int;
  v_auth int;
  v_svc int;
BEGIN
  SELECT count(*) INTO v_anon FROM information_schema.role_routine_grants
    WHERE routine_schema='api' AND routine_name='delete_account' AND grantee='anon';
  SELECT count(*) INTO v_auth FROM information_schema.role_routine_grants
    WHERE routine_schema='api' AND routine_name='delete_account' AND grantee='authenticated';
  SELECT count(*) INTO v_svc FROM information_schema.role_routine_grants
    WHERE routine_schema='api' AND routine_name='delete_account' AND grantee='service_role';
  IF v_anon <> 0 OR v_auth <> 0 THEN RAISE EXCEPTION 'FAIL: delete_account executable by anon/authenticated'; END IF;
  IF v_svc <> 1 THEN RAISE EXCEPTION 'FAIL: delete_account not granted to service_role'; END IF;
END $$;

-- ── §promote_to_staff — F-14 promote / already_staff / not_found ─────────────
INSERT INTO auth.users (id, email, aud, role, instance_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-0000000007c2', 'Promote.Seven@test.local', 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now());
INSERT INTO public.customer_profiles (user_id, full_name) VALUES
  ('00000000-0000-0000-0000-0000000007c2', 'Promote Seven');

DO $$
DECLARE
  v_actor uuid := '00000000-0000-0000-0000-0000000007b1'; -- staff owner from §fixtures
  v_uid uuid := '00000000-0000-0000-0000-0000000007c2';
  r1 jsonb; r2 jsonb; r3 jsonb;
BEGIN
  -- case-insensitive promote of an existing customer
  r1 := api.promote_to_staff('promote.seven@test.local', 'admin', 'Promoted Seven', v_actor);
  IF r1->>'status' <> 'promoted' THEN RAISE EXCEPTION 'FAIL promote: %', r1; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id=v_uid AND role='admin' AND is_active) THEN
    RAISE EXCEPTION 'FAIL: staff row not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action='staff.promoted' AND target_id=v_uid::text) THEN
    RAISE EXCEPTION 'FAIL: no staff.promoted audit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action='staff.provisioned' AND target_id=v_uid::text) THEN
    RAISE EXCEPTION 'FAIL: no staff.provisioned audit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_profiles WHERE user_id=v_uid) THEN
    RAISE EXCEPTION 'FAIL: customer profile lost';
  END IF;

  -- second call → already_staff
  r2 := api.promote_to_staff('promote.seven@test.local', 'staff', NULL, v_actor);
  IF r2->>'status' <> 'already_staff' THEN RAISE EXCEPTION 'FAIL already_staff: %', r2; END IF;

  -- unknown email → not_found
  r3 := api.promote_to_staff('nobody-seven@test.local', 'staff', NULL, v_actor);
  IF r3->>'status' <> 'not_found' THEN RAISE EXCEPTION 'FAIL not_found: %', r3; END IF;
END $$;

DO $$
DECLARE v_anon int; v_auth int; v_svc int;
BEGIN
  SELECT count(*) INTO v_anon FROM information_schema.role_routine_grants
    WHERE routine_schema='api' AND routine_name='promote_to_staff' AND grantee='anon';
  SELECT count(*) INTO v_auth FROM information_schema.role_routine_grants
    WHERE routine_schema='api' AND routine_name='promote_to_staff' AND grantee='authenticated';
  SELECT count(*) INTO v_svc FROM information_schema.role_routine_grants
    WHERE routine_schema='api' AND routine_name='promote_to_staff' AND grantee='service_role';
  IF v_anon <> 0 OR v_auth <> 0 THEN RAISE EXCEPTION 'FAIL: promote_to_staff executable by anon/authenticated'; END IF;
  IF v_svc <> 1 THEN RAISE EXCEPTION 'FAIL: promote_to_staff not granted to service_role'; END IF;
END $$;

ROLLBACK;
