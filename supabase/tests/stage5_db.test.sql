-- Stage 5 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty).
--
-- §audit covers api.list_audit_logs (the owner-only read RPC that surfaces the
-- real audit trail on the admin Audit Logs page):
--   * grant posture: service-role only (anon/authenticated hold no EXECUTE)
--   * owner-only: owner succeeds; admin / non-staff / null → actor_not_authorized
--   * actor resolution: actor_id → email (auth.users) + display_name + role
--     (staff_profiles), resolved SQL-side inside the SECURITY DEFINER fn
--   * newest-first ordering, total count, filtering (action / search / date),
--     and limit/offset pagination
--
-- Conventions (same as pass2/pass3/pass4/stage4): expected-SUCCESS runs plainly;
-- expected-FAILURE flips a flag inside a sub-block and RAISE 'FAIL:' if the call
-- did NOT raise (or raised the wrong code); value checks RAISE 'FAIL:' on a
-- violated invariant.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),  -- owner
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),  -- admin
  ('00000000-0000-0000-0000-0000000000c1', 'cust@test.local');   -- non-staff

INSERT INTO public.staff_profiles (user_id, role, is_active, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner', true, 'Owner One'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', true, 'Admin Two');

INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'product.created', 'product', 'PRD-1',
     '{"name":"Kurti Test"}'::jsonb, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000a1', 'shipment.booked', 'shipment', 'SHP-1',
     '{"provider":"steadfast"}'::jsonb, now() - interval '2 days'),
  (NULL, 'order.transition', 'order', 'NGR-1',
     '{"from":"confirmed","to":"processing"}'::jsonb, now() - interval '10 minutes');

-- ============================================================
-- §audit-1 — grant posture: service-role only
-- ============================================================
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r,
      'api.list_audit_logs(uuid,text,text,uuid,timestamptz,timestamptz,text,integer,integer)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on api.list_audit_logs', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role',
    'api.list_audit_logs(uuid,text,text,uuid,timestamptz,timestamptz,text,integer,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role must hold EXECUTE on api.list_audit_logs';
  END IF;
END $$;

-- ============================================================
-- §audit-2 — owner-only authorization
-- ============================================================
-- owner: allowed
DO $$
DECLARE v jsonb;
BEGIN
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1');
  IF (v->>'total')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: owner expected total 3, got %', v->>'total';
  END IF;
END $$;

-- admin / non-staff / null: rejected with actor_not_authorized
DO $$
DECLARE v_raised boolean; a uuid;
BEGIN
  FOREACH a IN ARRAY ARRAY[
    '00000000-0000-0000-0000-0000000000a2'::uuid,  -- admin
    '00000000-0000-0000-0000-0000000000c1'::uuid,  -- non-staff customer
    '00000000-0000-0000-0000-000000000099'::uuid   -- unknown
  ] LOOP
    v_raised := false;
    BEGIN
      PERFORM api.list_audit_logs(p_actor := a);
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
      IF SQLERRM <> 'actor_not_authorized' THEN
        RAISE EXCEPTION 'FAIL: expected actor_not_authorized for %, got %', a, SQLERRM;
      END IF;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'FAIL: actor % was allowed to read audit logs', a;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- §audit-3 — actor resolution + newest-first ordering
-- ============================================================
DO $$
DECLARE v jsonb; first jsonb; prod jsonb;
BEGIN
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1');

  -- newest first: order.transition (10 min ago) leads
  first := v->'rows'->0;
  IF (first->>'action') <> 'order.transition' THEN
    RAISE EXCEPTION 'FAIL: newest-first expected order.transition, got %', first->>'action';
  END IF;
  -- system actor resolves to NULL identity (no email/name)
  IF (first->>'actor_id') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: system row actor_id should be null';
  END IF;

  -- find the product.created row and check resolution
  SELECT elem INTO prod
    FROM jsonb_array_elements(v->'rows') elem
   WHERE elem->>'action' = 'product.created';
  IF (prod->>'actor_email') <> 'owner@test.local' THEN
    RAISE EXCEPTION 'FAIL: actor_email not resolved, got %', prod->>'actor_email';
  END IF;
  IF (prod->>'actor_name') <> 'Owner One' THEN
    RAISE EXCEPTION 'FAIL: actor_name not resolved, got %', prod->>'actor_name';
  END IF;
  IF (prod->>'actor_role') <> 'owner' THEN
    RAISE EXCEPTION 'FAIL: actor_role not resolved, got %', prod->>'actor_role';
  END IF;
END $$;

-- ============================================================
-- §audit-4 — filtering: action / search / date range
-- ============================================================
DO $$
DECLARE v jsonb;
BEGIN
  -- action filter
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_action := 'shipment.booked');
  IF (v->>'total')::int <> 1 THEN RAISE EXCEPTION 'FAIL: action filter total, got %', v->>'total'; END IF;

  -- search over metadata
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_search := 'steadfast');
  IF (v->>'total')::int <> 1 THEN RAISE EXCEPTION 'FAIL: metadata search total, got %', v->>'total'; END IF;

  -- search over actor email → both owner rows
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_search := 'owner@test');
  IF (v->>'total')::int <> 2 THEN RAISE EXCEPTION 'FAIL: email search total, got %', v->>'total'; END IF;

  -- date lower bound excludes the 2-days-ago shipment row
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_from := now() - interval '1 day');
  IF (v->>'total')::int <> 2 THEN RAISE EXCEPTION 'FAIL: date-from total, got %', v->>'total'; END IF;
END $$;

-- ============================================================
-- §audit-5 — pagination (limit/offset with full total)
-- ============================================================
DO $$
DECLARE v jsonb;
BEGIN
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_limit := 1, p_offset := 0);
  IF jsonb_array_length(v->'rows') <> 1 THEN RAISE EXCEPTION 'FAIL: limit 1 rows length'; END IF;
  IF (v->>'total')::int <> 3 THEN RAISE EXCEPTION 'FAIL: total ignores paging, got %', v->>'total'; END IF;

  -- offset past the end → empty rows, total intact
  v := api.list_audit_logs(p_actor := '00000000-0000-0000-0000-0000000000a1',
        p_limit := 10, p_offset := 10);
  IF jsonb_array_length(v->'rows') <> 0 THEN RAISE EXCEPTION 'FAIL: offset past end not empty'; END IF;
  IF (v->>'total')::int <> 3 THEN RAISE EXCEPTION 'FAIL: total after offset, got %', v->>'total'; END IF;
END $$;

-- ============================================================
-- §courier — shipment lifecycle → order status progression
-- ============================================================
-- Regression coverage for the #1 fix: SteadFast emits no pickup signal, so an
-- order must be able to go courier_booked → delivered directly; Pathao reports
-- transit, so in_transit → shipped → delivered; returned_to_merchant is a no-op
-- (admin decides). Courier RPCs need only orders rows (no items/products).

INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
  ship_district, ship_zone, ship_address, subtotal, discount, shipping_fee, total,
  payment_method, status, idempotency_key)
VALUES
  ('NGR-TEST-STF1', repeat('a',64), 'Test Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-stf1'),
  ('NGR-TEST-PTH1', repeat('b',64), 'Test Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-pth1'),
  ('NGR-TEST-RET1', repeat('c',64), 'Test Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-ret1'),
  ('NGR-TEST-STF2', repeat('d',64), 'Test Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-stf2');

-- §courier-1 — SteadFast direct: courier_booked → delivered (THE #1 regression)
DO $$
DECLARE v_owner uuid := '00000000-0000-0000-0000-0000000000a1';
        v_oid uuid; v_sid uuid; v jsonb; v_status text;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE order_no = 'NGR-TEST-STF1';
  v := api.create_shipment_attempt(p_actor := v_owner, p_order_id := v_oid,
        p_provider := 'steadfast', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'h-stf1');
  v_sid := (v->>'shipment_id')::uuid;
  PERFORM api.mark_shipment_booking_success(v_sid, 'CID-1', 'TRK-1', '{}'::jsonb);

  SELECT status INTO v_status FROM public.orders WHERE id = v_oid;
  IF v_status <> 'courier_booked' THEN
    RAISE EXCEPTION 'FAIL: after booking expected courier_booked, got %', v_status;
  END IF;

  -- SteadFast reports delivered with NO prior shipped signal.
  v := api.update_shipment_status(v_sid, 'delivered', '{}'::jsonb, 'webhook');
  IF (v->>'order_transitioned')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: delivered from courier_booked was not applied';
  END IF;
  SELECT status INTO v_status FROM public.orders WHERE id = v_oid;
  IF v_status <> 'delivered' THEN
    RAISE EXCEPTION 'FAIL: expected delivered direct from courier_booked, got %', v_status;
  END IF;
  IF (SELECT count(*) FROM public.notification_events
        WHERE order_id = v_oid AND event_type = 'shipment_delivered') <> 1 THEN
    RAISE EXCEPTION 'FAIL: missing shipment_delivered notification';
  END IF;
END $$;

-- §courier-2 — Pathao normal: in_transit → shipped → delivered
DO $$
DECLARE v_owner uuid := '00000000-0000-0000-0000-0000000000a1';
        v_oid uuid; v_sid uuid; v jsonb; v_status text;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE order_no = 'NGR-TEST-PTH1';
  v := api.create_shipment_attempt(p_actor := v_owner, p_order_id := v_oid,
        p_provider := 'pathao', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'h-pth1');
  v_sid := (v->>'shipment_id')::uuid;
  PERFORM api.mark_shipment_booking_success(v_sid, 'CID-2', 'TRK-2', '{}'::jsonb);

  v := api.update_shipment_status(v_sid, 'in_transit', '{}'::jsonb, 'webhook');
  SELECT status INTO v_status FROM public.orders WHERE id = v_oid;
  IF v_status <> 'shipped' THEN
    RAISE EXCEPTION 'FAIL: in_transit expected shipped, got %', v_status;
  END IF;

  v := api.update_shipment_status(v_sid, 'delivered', '{}'::jsonb, 'webhook');
  SELECT status INTO v_status FROM public.orders WHERE id = v_oid;
  IF v_status <> 'delivered' THEN
    RAISE EXCEPTION 'FAIL: delivered after shipped expected delivered, got %', v_status;
  END IF;
END $$;

-- §courier-3 — returned_to_merchant does NOT auto-transition the order
DO $$
DECLARE v_owner uuid := '00000000-0000-0000-0000-0000000000a1';
        v_oid uuid; v_sid uuid; v jsonb; v_status text;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE order_no = 'NGR-TEST-RET1';
  v := api.create_shipment_attempt(p_actor := v_owner, p_order_id := v_oid,
        p_provider := 'steadfast', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'h-ret1');
  v_sid := (v->>'shipment_id')::uuid;
  PERFORM api.mark_shipment_booking_success(v_sid, 'CID-3', 'TRK-3', '{}'::jsonb);

  v := api.update_shipment_status(v_sid, 'returned_to_merchant', '{}'::jsonb, 'webhook');
  IF (v->>'order_transitioned')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: returned_to_merchant should not auto-transition';
  END IF;
  SELECT status INTO v_status FROM public.orders WHERE id = v_oid;
  IF v_status <> 'courier_booked' THEN
    RAISE EXCEPTION 'FAIL: returned_to_merchant changed order to %, expected courier_booked', v_status;
  END IF;
END $$;

-- §courier-4 — failed delivery from shipped → delivery_failed
DO $$
DECLARE v_owner uuid := '00000000-0000-0000-0000-0000000000a1';
        v_oid uuid; v_sid uuid; v jsonb; v_status text;
BEGIN
  SELECT id INTO v_oid FROM public.orders WHERE order_no = 'NGR-TEST-STF2';
  v := api.create_shipment_attempt(p_actor := v_owner, p_order_id := v_oid,
        p_provider := 'steadfast', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'h-stf2');
  v_sid := (v->>'shipment_id')::uuid;
  PERFORM api.mark_shipment_booking_success(v_sid, 'CID-4', 'TRK-4', '{}'::jsonb);

  PERFORM api.update_shipment_status(v_sid, 'in_transit', '{}'::jsonb, 'webhook');
  v := api.update_shipment_status(v_sid, 'failed', '{}'::jsonb, 'webhook');
  SELECT status INTO v_status FROM public.orders WHERE id = v_oid;
  IF v_status <> 'delivery_failed' THEN
    RAISE EXCEPTION 'FAIL: failed expected delivery_failed, got %', v_status;
  END IF;
END $$;

-- §courier-5 — grant posture: courier lifecycle RPCs are service-role only
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r, 'api.create_shipment_attempt(uuid,uuid,text,text,numeric,text)', 'EXECUTE')
       OR has_function_privilege(r, 'api.update_shipment_status(uuid,text,jsonb,text)', 'EXECUTE')
       OR has_function_privilege(r, 'api.mark_shipment_booking_success(uuid,text,text,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on courier lifecycle RPCs', r;
    END IF;
  END LOOP;
END $$;

ROLLBACK;
