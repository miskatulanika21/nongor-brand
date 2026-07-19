-- Courier RPC smoke test — runs against the EPHEMERAL local Supabase DB in CI
-- (all migrations applied from empty).
--
-- WHY THIS FILE EXISTS
-- --------------------
-- On 2026-07-19 a live booking revealed that api.list_shipments had raised on
-- EVERY call since Stage 5 shipped:
--
--   ERROR: 42883: function row_to_jsonb(public.shipment_events) does not exist
--
-- Postgres has row_to_json() and to_jsonb(); row_to_jsonb() is neither. The
-- migration applied cleanly because a plpgsql body is not resolved until it is
-- CALLED — so `supabase start` was green, `db lint` was green, and all 721 unit
-- tests were green, while /admin/courier silently showed every booked order as
-- having no shipment at all.
--
-- stage5_db.test.sql covers courier LOGIC in depth, but only ever called 6 of the
-- 12 courier RPCs. list_shipments was one of the 6 it never called, so nothing
-- ever executed the broken body.
--
-- This file is deliberately NOT a logic test — stage5_db.test.sql owns that. It
-- asserts one thing only: **every courier RPC can actually execute**. Shallow on
-- purpose, exhaustive on purpose.
--
-- §smoke-14 is the part that keeps it exhaustive: it enumerates the courier RPCs
-- from pg_proc and fails if any is missing from the covered list below. Adding a
-- new courier RPC therefore breaks CI until it gets a smoke call here — which is
-- the actual fix for the bug class, rather than for this one bug.
--
-- It has already earned its keep: `api.create_return_shipment` (added later the
-- same day) tripped this guard the moment it was created, before any UI existed
-- to call it.
--
-- Conventions match pass2/pass3/pass4/stage4/stage5: RAISE 'FAIL: …' on a
-- violated invariant; ON_ERROR_STOP aborts the run.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'smoke-owner@test.local');

INSERT INTO public.staff_profiles (user_id, role, is_active, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'owner', true, 'Smoke Owner');

-- Courier RPCs need only orders rows (no items/products) — same as stage5.
INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
  ship_district, ship_zone, ship_address, subtotal, discount, shipping_fee, total,
  payment_method, status, idempotency_key)
VALUES
  ('NGR-SMOKE-01', repeat('1',64), 'Smoke Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-smoke-1'),
  ('NGR-SMOKE-02', repeat('2',64), 'Smoke Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-smoke-2'),
  ('NGR-SMOKE-03', repeat('3',64), 'Smoke Cust', '01700000000', 'Dhaka', 'dhaka',
   'Rd 1', 1000, 0, 0, 1000, 'cod', 'ready_to_ship', 'idem-smoke-3');

-- ============================================================
-- §smoke-1..13 — every courier RPC executes
-- ============================================================
DO $$
DECLARE
  v_actor uuid := '00000000-0000-0000-0000-0000000000b1';
  v_o1 uuid; v_o2 uuid; v_o3 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  v jsonb;
BEGIN
  SELECT id INTO v_o1 FROM public.orders WHERE order_no = 'NGR-SMOKE-01';
  SELECT id INTO v_o2 FROM public.orders WHERE order_no = 'NGR-SMOKE-02';
  SELECT id INTO v_o3 FROM public.orders WHERE order_no = 'NGR-SMOKE-03';

  -- §smoke-1 create_shipment_attempt
  v := api.create_shipment_attempt(p_actor := v_actor, p_order_id := v_o1,
        p_provider := 'manual', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'smoke-h1');
  v_s1 := (v->>'shipment_id')::uuid;
  IF v_s1 IS NULL THEN RAISE EXCEPTION 'FAIL: create_shipment_attempt returned no shipment_id'; END IF;

  -- §smoke-2 mark_shipment_booking_success
  PERFORM api.mark_shipment_booking_success(v_s1, 'SMOKE-CID-1', 'SMOKE-TRK-1', '{}'::jsonb);

  -- §smoke-3 update_shipment_status
  v := api.update_shipment_status(v_s1, 'in_transit', '{}'::jsonb, 'webhook');
  IF v IS NULL THEN RAISE EXCEPTION 'FAIL: update_shipment_status returned NULL'; END IF;

  -- §smoke-4 record_shipment_event (informational, must not change courier_status)
  v := api.record_shipment_event(v_s1, 'tracking_update', '{}'::jsonb, 'webhook');
  IF v IS NULL THEN RAISE EXCEPTION 'FAIL: record_shipment_event returned NULL'; END IF;

  -- §smoke-5 list_shipments — THE REGRESSION. Must execute AND return the row
  -- with its nested events; a jsonb-function typo here raises 42883 at runtime.
  v := api.list_shipments(p_actor := v_actor, p_order_id := v_o1);
  IF v IS NULL OR jsonb_typeof(v) <> 'array' THEN
    RAISE EXCEPTION 'FAIL: list_shipments did not return a jsonb array, got %', jsonb_typeof(v);
  END IF;
  IF jsonb_array_length(v) <> 1 THEN
    RAISE EXCEPTION 'FAIL: list_shipments expected 1 shipment, got %', jsonb_array_length(v);
  END IF;
  IF v->0->>'tracking_code' <> 'SMOKE-TRK-1' THEN
    RAISE EXCEPTION 'FAIL: list_shipments tracking_code, got %', v->0->>'tracking_code';
  END IF;
  -- The nested aggregate is a SECOND call site of the same jsonb function and was
  -- equally broken; assert the events array is really built, not just present.
  IF jsonb_typeof(v->0->'events') <> 'array' THEN
    RAISE EXCEPTION 'FAIL: list_shipments events is not an array';
  END IF;
  IF jsonb_array_length(v->0->'events') < 1 THEN
    RAISE EXCEPTION 'FAIL: list_shipments events empty despite recorded events';
  END IF;

  -- §smoke-6 list_courier_providers
  v := api.list_courier_providers(p_actor := v_actor);
  IF v IS NULL OR jsonb_typeof(v) <> 'array' THEN
    RAISE EXCEPTION 'FAIL: list_courier_providers did not return a jsonb array';
  END IF;
  IF jsonb_array_length(v) < 1 THEN
    RAISE EXCEPTION 'FAIL: list_courier_providers returned no seeded providers';
  END IF;

  -- §smoke-7 update_shipment_reconciliation
  PERFORM api.update_shipment_reconciliation(p_actor := v_actor, p_shipment_id := v_s1,
    p_courier_fee := 60, p_return_fee := 0, p_settlement_ref := 'SMOKE-SETTLE-1');

  -- §smoke-8 cancel_shipment (fresh shipment — cancelling the delivered one is
  -- a different guard, and this file tests reachability, not lifecycle rules)
  v := api.create_shipment_attempt(p_actor := v_actor, p_order_id := v_o2,
        p_provider := 'manual', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'smoke-h2');
  v_s2 := (v->>'shipment_id')::uuid;
  PERFORM api.mark_shipment_booking_success(v_s2, 'SMOKE-CID-2', 'SMOKE-TRK-2', '{}'::jsonb);
  PERFORM api.cancel_shipment(p_actor := v_actor, p_shipment_id := v_s2,
    p_reason := 'smoke test');

  -- §smoke-9 fail_shipment_booking + §smoke-10 resolve_stale_attempt
  v := api.create_shipment_attempt(p_actor := v_actor, p_order_id := v_o3,
        p_provider := 'manual', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'smoke-h3');
  v_s3 := (v->>'shipment_id')::uuid;
  PERFORM api.fail_shipment_booking(v_s3, 'smoke failure');

  -- resolve_stale_attempt needs a PENDING attempt past its expiry window.
  v := api.create_shipment_attempt(p_actor := v_actor, p_order_id := v_o3,
        p_provider := 'manual', p_collection_mode := 'cod', p_cod_amount := 1000,
        p_request_hash := 'smoke-h4');
  v_s3 := (v->>'shipment_id')::uuid;
  UPDATE public.shipments SET pending_expires_at = now() - interval '1 hour'
    WHERE id = v_s3;
  PERFORM api.resolve_stale_attempt(p_actor := v_actor, p_shipment_id := v_s3);

  -- §smoke-11 create_return_shipment — a return leg off the delivered forward
  -- parcel (v_s1, marked success above). Asserts the leg is really a child
  -- 'return' row, not another forward shipment.
  v := api.create_return_shipment(p_actor := v_actor, p_parent_id := v_s1,
        p_reason := 'smoke test return');
  IF (v->>'shipment_id') IS NULL THEN
    RAISE EXCEPTION 'FAIL: create_return_shipment returned no shipment_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = (v->>'shipment_id')::uuid
      AND shipment_kind = 'return'
      AND parent_shipment_id = v_s1
  ) THEN
    RAISE EXCEPTION 'FAIL: create_return_shipment did not create a linked return leg';
  END IF;
  -- A second open return on the same parent must be refused.
  BEGIN
    PERFORM api.create_return_shipment(p_actor := v_actor, p_parent_id := v_s1);
    RAISE EXCEPTION 'FAIL: duplicate return was allowed';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM NOT LIKE '%duplicate_return%' THEN RAISE; END IF;
  END;

  -- §smoke-12 record_webhook_event + §smoke-13 set_webhook_event_processed
  v := api.record_webhook_event('steadfast', 'smoke:evt-1', '{"delivery_status":"pending"}'::jsonb);
  IF (v->>'is_new')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: record_webhook_event first insert should be new';
  END IF;
  PERFORM api.set_webhook_event_processed('steadfast', 'smoke:evt-1', NULL);
END $$;

-- ============================================================
-- §smoke-14 — coverage guard: no courier RPC may go uncalled
-- ============================================================
-- This is the class fix. If someone adds a courier RPC and does not smoke-call
-- it above, CI fails here — so a never-executed function body can no longer ship
-- green. Add the name to the array ONLY together with a call in §smoke-1..12.
DO $$
DECLARE
  covered text[] := ARRAY[
    'cancel_shipment',
    'create_return_shipment',
    'create_shipment_attempt',
    'fail_shipment_booking',
    'list_courier_providers',
    'list_shipments',
    'mark_shipment_booking_success',
    'record_shipment_event',
    'record_webhook_event',
    'resolve_stale_attempt',
    'set_webhook_event_processed',
    'update_shipment_reconciliation',
    'update_shipment_status'
  ];
  missing text[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'api'
    AND (p.proname LIKE '%shipment%' OR p.proname LIKE '%courier%' OR p.proname LIKE '%webhook%')
    -- Reporting RPCs are read-only aggregates owned by the Stage-6 reports
    -- suite (stage6_db.test.sql), not part of the courier booking surface.
    AND p.proname <> 'report_courier_performance'
    AND NOT (p.proname = ANY(covered));

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'FAIL: courier RPC(s) % exist but are never smoke-called. Add a call in §smoke-1..13 AND list them in `covered`.',
      array_to_string(missing, ', ');
  END IF;
END $$;

ROLLBACK;
