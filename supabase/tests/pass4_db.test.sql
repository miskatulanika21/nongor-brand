-- Stage 3 Pass 4 DB integration test — runs against the EPHEMERAL local Supabase
-- DB in CI (all migrations applied from empty). Covers the order LIFECYCLE +
-- customer reads that pass3_db.test.sql (schema + place/quote) does not:
--   * manual (bkash) happy path: submit evidence → verify → confirm → …
--       → shipped → delivered → returned + restock (reservation consume/restock)
--   * custom-measurement round-trip (place stores; get_order_detail / get_my_order
--       / track_order project it; empty measures normalize to NULL)
--   * reject → retry; COD confirm
--   * duplicate-TrxID flag (submit warning + get_order_detail projection)
--   * guest track scoping; transition guards; admin_order_stats; RPC grants
--
-- Conventions (same as pass2/pass3): expected-SUCCESS runs plainly; expected-
-- FAILURE wraps in a sub-block and RAISE 'FAIL:' if it did NOT raise; value
-- checks RAISE 'FAIL:' on a violated invariant.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000b1'),  -- staff actor
  ('00000000-0000-0000-0000-0000000000b2');  -- customer (owns an order)
INSERT INTO public.staff_profiles (user_id, role, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'owner'::private.staff_role, true);

INSERT INTO public.product_categories (slug, name, sort_order) VALUES ('p4-cat', 'P4 Cat', 0);
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'p4-prod', 'p4-prod', 'P4 Product', id, 500, 50
  FROM public.product_categories WHERE slug = 'p4-cat';
INSERT INTO public.products (code, slug, name, category_id, price, stock, custom_size, custom_size_charge)
  SELECT 'p4-cust', 'p4-cust', 'P4 Custom', id, 2000, 5, true, 300
  FROM public.product_categories WHERE slug = 'p4-cat';

-- Actor UUIDs are inlined as literals below (psql \set vars are NOT interpolated
-- inside dollar-quoted DO blocks): staff = …b1, customer = …b2.

-- ============================================================
-- §1 — manual (bkash) happy path + reservation consume/restock
--       + measurements round-trip through place + all read RPCs
-- ============================================================
DO $$
DECLARE
  r jsonb; oid uuid; ono text; hash text; pid uuid; det jsonb; trk jsonb;
  cu jsonb := jsonb_build_object('name','Rina','phone','01711111111','district','Dhaka','address','1 Rd');
  -- a ready line carrying per-line measurements (fulfilment data, line-level)
  lines jsonb := '[{"code":"p4-prod","qty":2,"measures":{"bust":"36","waist":"30"}}]'::jsonb;
BEGIN
  SELECT id INTO pid FROM public.products WHERE code = 'p4-prod';

  r := api.place_order(lines, cu, 'dhaka', 'bkash', 's1-idem', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s1','sha256'),'hex'));
  oid := (r->>'order_id')::uuid; ono := r->>'order_no';
  IF (r->>'status') <> 'pending_payment' THEN RAISE EXCEPTION 'FAIL: s1 place status %', r; END IF;
  IF private.available_qty(pid, NULL) <> 48 THEN RAISE EXCEPTION 'FAIL: s1 reserve'; END IF;

  -- place stored the per-line measurements
  IF (SELECT custom_measurements FROM public.order_items WHERE order_id = oid)
       <> '{"bust":"36","waist":"30"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s1 measurements not stored'; END IF;

  SELECT guest_token_hash INTO hash FROM public.orders WHERE id = oid;

  -- customer submits evidence (guest scope = 'guest:'||token_hash) → payment_submitted
  r := api.submit_payment_evidence(oid, 'TRX-S1', '01711111111', 'guest:'||hash, 'ss/1.jpg');
  IF (r->>'status') <> 'payment_submitted' OR (r->>'duplicate_trx_id_warning')::bool THEN
    RAISE EXCEPTION 'FAIL: s1 submit %', r; END IF;
  IF (SELECT status FROM public.payments WHERE order_id = oid) <> 'submitted' THEN
    RAISE EXCEPTION 'FAIL: s1 payment not submitted'; END IF;

  -- admin verifies → order confirmed, payment verified, reservation consumed (stock 48)
  r := api.verify_payment(oid, '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF (r->>'status') <> 'confirmed' THEN RAISE EXCEPTION 'FAIL: s1 verify %', r; END IF;
  IF (SELECT status FROM public.payments WHERE order_id = oid) <> 'verified'
     OR (SELECT verified_by FROM public.payments WHERE order_id = oid) <> '00000000-0000-0000-0000-0000000000b1'::uuid THEN
    RAISE EXCEPTION 'FAIL: s1 payment not verified'; END IF;
  IF (SELECT stock FROM public.products WHERE id = pid) <> 48 THEN
    RAISE EXCEPTION 'FAIL: s1 stock not consumed'; END IF;
  IF (SELECT status FROM public.inventory_reservations WHERE order_id = oid) <> 'consumed' THEN
    RAISE EXCEPTION 'FAIL: s1 reservation not consumed'; END IF;
  IF (SELECT confirmed_at FROM public.orders WHERE id = oid) IS NULL THEN
    RAISE EXCEPTION 'FAIL: s1 confirmed_at unset'; END IF;

  -- get_order_detail projects the measurements + trx_id_duplicate=false (only verified)
  det := api.get_order_detail(oid, '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF (det->'items'->0->'custom_measurements') <> '{"bust":"36","waist":"30"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s1 detail measurements'; END IF;
  IF (det->'payment'->>'trx_id_duplicate')::bool THEN
    RAISE EXCEPTION 'FAIL: s1 lone trx flagged duplicate'; END IF;

  -- guest track projects the same measurements
  trk := api.track_order(ono, hash);
  IF (trk->'items'->0->'custom_measurements') <> '{"bust":"36","waist":"30"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s1 track measurements'; END IF;

  -- #8: track projects the product link (slug) + SKU (code), and courier is null
  -- until a shipment exists.
  IF (trk->'items'->0->>'sku') <> 'p4-prod' THEN
    RAISE EXCEPTION 'FAIL: s1 track sku %', trk->'items'->0; END IF;
  IF (trk->'items'->0->>'product_slug') IS NULL THEN
    RAISE EXCEPTION 'FAIL: s1 track product_slug missing %', trk->'items'->0; END IF;
  IF (trk->'courier') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s1 courier should be null pre-booking %', trk->'courier'; END IF;

  -- march to delivered
  PERFORM api.transition_order(oid, 'processing',    '00000000-0000-0000-0000-0000000000b1'::uuid);
  PERFORM api.transition_order(oid, 'ready_to_ship', '00000000-0000-0000-0000-0000000000b1'::uuid);
  PERFORM api.transition_order(oid, 'shipped',       '00000000-0000-0000-0000-0000000000b1'::uuid);
  PERFORM api.transition_order(oid, 'delivered',     '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF (SELECT status FROM public.orders WHERE id = oid) <> 'delivered' THEN
    RAISE EXCEPTION 'FAIL: s1 not delivered'; END IF;

  -- return WITH restock → stock back to 50
  r := api.return_order(oid, '00000000-0000-0000-0000-0000000000b1'::uuid, true, 'changed mind');
  IF (r->>'status') <> 'returned' THEN RAISE EXCEPTION 'FAIL: s1 return %', r; END IF;
  IF (SELECT stock FROM public.products WHERE id = pid) <> 50 THEN
    RAISE EXCEPTION 'FAIL: s1 restock (stock=%)', (SELECT stock FROM public.products WHERE id = pid); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action='order.transition' AND target_id=oid::text
                   AND (metadata->>'restock')::bool AND metadata->>'to'='returned') THEN
    RAISE EXCEPTION 'FAIL: s1 restock audit'; END IF;
END $$;

-- ============================================================
-- §1b — #8: a booked courier surfaces in the customer projection. Isolated on a
-- fresh guest order so it never interferes with the §1 return flow.
-- ============================================================
DO $$
DECLARE r jsonb; oid uuid; ono text; hash text; trk jsonb;
  cu jsonb := jsonb_build_object('name','Ship','phone','01755550000','district','Dhaka','address','9 Rd');
BEGIN
  r := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'cod', 's1b-idem', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s1b','sha256'),'hex'));
  oid := (r->>'order_id')::uuid; ono := r->>'order_no';
  SELECT guest_token_hash INTO hash FROM public.orders WHERE id = oid;

  INSERT INTO public.shipments (order_id, provider, shipment_kind, booking_status, consignment_id, tracking_code, courier_status)
  VALUES (oid, 'steadfast', 'forward', 'success', 'CID-S1B', 'TRK-S1B', 'in_transit');

  trk := api.track_order(ono, hash);
  IF (trk->'courier'->>'provider') <> 'steadfast'
     OR (trk->'courier'->>'tracking_code') <> 'TRK-S1B'
     OR (trk->'courier'->>'consignment_id') <> 'CID-S1B'
     OR (trk->'courier'->>'courier_status') <> 'in_transit' THEN
    RAISE EXCEPTION 'FAIL: s1b courier projection %', trk->'courier'; END IF;

  -- with no booked shipment, courier collapses back to null
  DELETE FROM public.shipments WHERE order_id = oid;
  trk := api.track_order(ono, hash);
  IF (trk->'courier') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s1b no-shipment courier not null %', trk->'courier'; END IF;
END $$;

-- ============================================================
-- §2 — owner-scoped read (get_my_order) + custom line + empty-measures→NULL
-- ============================================================
DO $$
DECLARE r jsonb; oid uuid; my jsonb; lst jsonb;
  cu jsonb := jsonb_build_object('name','Owner','phone','01722222222','district','Dhaka','address','2 Rd');
BEGIN
  -- a signed-in customer places a custom order with real measurements
  r := api.place_order(
    '[{"code":"p4-cust","size":"Custom","qty":1,"measures":{"hip":"40","sleeve":"22"}}]'::jsonb,
    cu, 'dhaka', 'bkash', 's2-idem', '00000000-0000-0000-0000-0000000000b2'::uuid, NULL);
  oid := (r->>'order_id')::uuid;

  -- get_my_order (owner) projects the measurements; wrong owner → not found
  my := api.get_my_order(oid, '00000000-0000-0000-0000-0000000000b2'::uuid);
  IF (my->'items'->0->'custom_measurements') <> '{"hip":"40","sleeve":"22"}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s2 get_my_order measurements'; END IF;
  -- #8: owner detail carries the product SKU + slug; the list carries every
  -- item name so search can match ALL items, not just the first.
  IF (my->'items'->0->>'sku') <> 'p4-cust' THEN
    RAISE EXCEPTION 'FAIL: s2 get_my_order sku %', my->'items'->0; END IF;
  IF (my->'items'->0->>'product_slug') IS NULL THEN
    RAISE EXCEPTION 'FAIL: s2 get_my_order product_slug missing %', my->'items'->0; END IF;
  lst := api.list_my_orders('00000000-0000-0000-0000-0000000000b2'::uuid, 20, 0);
  IF jsonb_typeof(lst->'orders'->0->'item_names') <> 'array'
     OR jsonb_array_length(lst->'orders'->0->'item_names') < 1 THEN
    RAISE EXCEPTION 'FAIL: s2 list_my_orders item_names %', lst->'orders'->0; END IF;
  BEGIN PERFORM api.get_my_order(oid, '00000000-0000-0000-0000-0000000000b1'::uuid);
        RAISE EXCEPTION 'FAIL: s2 cross-user read allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE EXCEPTION 'FAIL: s2 wrong err %', SQLERRM; END IF; END;

  -- empty measures object normalizes to NULL at place time
  r := api.place_order('[{"code":"p4-prod","qty":1,"measures":{}}]'::jsonb,
    cu, 'dhaka', 'cod', 's2-empty', '00000000-0000-0000-0000-0000000000b2'::uuid, NULL);
  IF (SELECT custom_measurements FROM public.order_items WHERE order_id=(r->>'order_id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: s2 empty measures not NULL'; END IF;
END $$;

-- shape CHECK: an empty jsonb object is rejected at the column level
DO $$
DECLARE oid uuid;
BEGIN
  SELECT id INTO oid FROM public.orders WHERE idempotency_key = 's2-empty';
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, name, unit_price, qty, line_total, custom_measurements)
    SELECT oid, id, 'x', 1, 1, 1, '{}'::jsonb FROM public.products WHERE code='p4-prod';
    RAISE EXCEPTION 'FAIL: empty-object measurements accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ============================================================
-- §3 — reject → retry → verify
-- ============================================================
DO $$
DECLARE r jsonb; oid uuid; hash text;
  cu jsonb := jsonb_build_object('name','Rej','phone','01733333333','district','Dhaka','address','3 Rd');
BEGIN
  r := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'bkash', 's3-idem', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s3','sha256'),'hex'));
  oid := (r->>'order_id')::uuid;
  SELECT guest_token_hash INTO hash FROM public.orders WHERE id = oid;

  PERFORM api.submit_payment_evidence(oid, 'TRX-S3', '01733333333', 'guest:'||hash, NULL);
  r := api.reject_payment(oid, 'blurry screenshot', '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF (r->>'status') <> 'payment_rejected' THEN RAISE EXCEPTION 'FAIL: s3 reject %', r; END IF;
  IF (SELECT status FROM public.payments WHERE order_id=oid) <> 'rejected'
     OR (SELECT reject_reason FROM public.payments WHERE order_id=oid) <> 'blurry screenshot' THEN
    RAISE EXCEPTION 'FAIL: s3 payment not rejected'; END IF;

  -- retry: submit again (payment_rejected allows) then verify
  r := api.submit_payment_evidence(oid, 'TRX-S3B', '01733333333', 'guest:'||hash, NULL);
  IF (r->>'status') <> 'payment_submitted' THEN RAISE EXCEPTION 'FAIL: s3 retry %', r; END IF;
  r := api.verify_payment(oid, '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF (r->>'status') <> 'confirmed' THEN RAISE EXCEPTION 'FAIL: s3 reverify %', r; END IF;
END $$;

-- ============================================================
-- §4 — COD confirm
-- ============================================================
DO $$
DECLARE r jsonb; oid uuid; pid uuid;
  cu jsonb := jsonb_build_object('name','Cod','phone','01744444444','district','Dhaka','address','4 Rd');
BEGIN
  SELECT id INTO pid FROM public.products WHERE code = 'p4-prod';
  r := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'cod', 's4-idem', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s4','sha256'),'hex'));
  oid := (r->>'order_id')::uuid;
  IF (r->>'status') <> 'pending_confirmation' THEN RAISE EXCEPTION 'FAIL: s4 place %', r; END IF;

  -- verify_payment must NOT apply to a COD order (no non-cod payment row)
  BEGIN PERFORM api.verify_payment(oid, '00000000-0000-0000-0000-0000000000b1'::uuid);
        RAISE EXCEPTION 'FAIL: s4 verify on COD allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'payment_not_found' THEN RAISE EXCEPTION 'FAIL: s4 verify err %', SQLERRM; END IF; END;

  r := api.confirm_cod(oid, '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF (r->>'status') <> 'confirmed' THEN RAISE EXCEPTION 'FAIL: s4 confirm_cod %', r; END IF;
END $$;

-- ============================================================
-- §5 — duplicate-TrxID: warning at submit + flag in get_order_detail
-- ============================================================
DO $$
DECLARE rx jsonb; ry jsonb; ox uuid; oy uuid; hx text; hy text; det jsonb;
  cu jsonb := jsonb_build_object('name','Dup','phone','01755555555','district','Dhaka','address','5 Rd');
BEGIN
  -- order X: verified with TRX-DUP
  rx := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'bkash', 's5-x', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s5x','sha256'),'hex'));
  ox := (rx->>'order_id')::uuid;
  SELECT guest_token_hash INTO hx FROM public.orders WHERE id = ox;
  PERFORM api.submit_payment_evidence(ox, 'TRX-DUP', '01755555555', 'guest:'||hx, NULL);
  PERFORM api.verify_payment(ox, '00000000-0000-0000-0000-0000000000b1'::uuid);

  -- order Y: submits the SAME trx (same method) → duplicate warning true
  ry := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'bkash', 's5-y', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s5y','sha256'),'hex'));
  oy := (ry->>'order_id')::uuid;
  SELECT guest_token_hash INTO hy FROM public.orders WHERE id = oy;
  ry := api.submit_payment_evidence(oy, 'trx-dup', '01755555555', 'guest:'||hy, NULL);  -- case-insensitive
  IF NOT (ry->>'duplicate_trx_id_warning')::bool THEN RAISE EXCEPTION 'FAIL: s5 no dup warning'; END IF;

  det := api.get_order_detail(oy, '00000000-0000-0000-0000-0000000000b1'::uuid);
  IF NOT (det->'payment'->>'trx_id_duplicate')::bool THEN RAISE EXCEPTION 'FAIL: s5 detail dup flag'; END IF;
END $$;

-- ============================================================
-- §6 — guest track scoping
-- ============================================================
DO $$
DECLARE ono text; hash text; ownedno text;
BEGIN
  SELECT order_no, guest_token_hash INTO ono, hash FROM public.orders WHERE idempotency_key = 's1-idem';

  -- correct order_no + hash works
  IF api.track_order(ono, hash) IS NULL THEN RAISE EXCEPTION 'FAIL: s6 valid track'; END IF;

  -- wrong hash → not found
  BEGIN PERFORM api.track_order(ono, repeat('0',64));
        RAISE EXCEPTION 'FAIL: s6 wrong-hash tracked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE EXCEPTION 'FAIL: s6 hash err %', SQLERRM; END IF; END;

  -- wrong order_no → not found
  BEGIN PERFORM api.track_order('NGR-NOPE', hash);
        RAISE EXCEPTION 'FAIL: s6 wrong-no tracked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE EXCEPTION 'FAIL: s6 no err %', SQLERRM; END IF; END;

  -- an account-owned order (guest_token_hash NULL) is NOT trackable by anyone
  SELECT order_no INTO ownedno FROM public.orders WHERE idempotency_key = 's2-idem';
  BEGIN PERFORM api.track_order(ownedno, repeat('0',64));
        RAISE EXCEPTION 'FAIL: s6 owned order tracked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE EXCEPTION 'FAIL: s6 owned err %', SQLERRM; END IF; END;
END $$;

-- ============================================================
-- §7 — transition guards: invalid jump, version conflict, non-staff
-- ============================================================
DO $$
DECLARE r jsonb; oid uuid; v integer; got text;
  cu jsonb := jsonb_build_object('name','Grd','phone','01766666666','district','Dhaka','address','6 Rd');
BEGIN
  r := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'cod', 's7-idem', NULL, NULL,
    p_guest_token_hash => encode(extensions.digest('tok-s7','sha256'),'hex'));
  oid := (r->>'order_id')::uuid;

  -- illegal jump pending_confirmation → delivered
  BEGIN PERFORM api.transition_order(oid, 'delivered', '00000000-0000-0000-0000-0000000000b1'::uuid);
        RAISE EXCEPTION 'FAIL: s7 illegal jump allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'invalid_transition' THEN RAISE EXCEPTION 'FAIL: s7 jump=%', got; END IF; END;

  -- version conflict
  SELECT version INTO v FROM public.orders WHERE id = oid;
  BEGIN PERFORM api.transition_order(oid, 'confirmed', '00000000-0000-0000-0000-0000000000b1'::uuid, NULL, v + 5);
        RAISE EXCEPTION 'FAIL: s7 stale version allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'version_conflict' THEN RAISE EXCEPTION 'FAIL: s7 ver=%', got; END IF; END;

  -- non-staff actor rejected
  BEGIN PERFORM api.transition_order(oid, 'confirmed', '00000000-0000-0000-0000-0000000000b2'::uuid);
        RAISE EXCEPTION 'FAIL: s7 non-staff allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: s7 staff=%', got; END IF; END;
END $$;

-- ============================================================
-- §8 — admin_order_stats: values + staff gate
-- ============================================================
DO $$
DECLARE s jsonb; got text;
BEGIN
  s := api.admin_order_stats('00000000-0000-0000-0000-0000000000b1'::uuid);
  -- non-negative, coherent shape; custom_pending counts the in-progress custom
  -- order from §2 (pending_payment, has a custom_measurements line).
  IF (s->>'total_orders')::int < 6 THEN RAISE EXCEPTION 'FAIL: s8 total %', s; END IF;
  IF (s->>'custom_pending')::int < 1 THEN RAISE EXCEPTION 'FAIL: s8 custom_pending %', s; END IF;
  IF (s->>'delivered_revenue')::int < 0 THEN RAISE EXCEPTION 'FAIL: s8 revenue %', s; END IF;

  -- non-staff rejected
  BEGIN PERFORM api.admin_order_stats('00000000-0000-0000-0000-0000000000b2'::uuid);
        RAISE EXCEPTION 'FAIL: s8 non-staff stats allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: s8 gate=%', got; END IF; END;
END $$;

-- ============================================================
-- §9 — grants: pass-4 RPCs are service-role only (anon/auth blocked)
-- ============================================================
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'api.transition_order(uuid,text,uuid,text,integer,boolean)',
    'api.verify_payment(uuid,uuid)',
    'api.reject_payment(uuid,text,uuid)',
    'api.confirm_cod(uuid,uuid)',
    'api.cancel_order(uuid,uuid,text)',
    'api.return_order(uuid,uuid,boolean,text)',
    'api.submit_payment_evidence(uuid,text,text,text,text)',
    'api.get_order_detail(uuid,uuid)',
    'api.get_my_order(uuid,uuid)',
    'api.track_order(text,text)',
    'api.admin_order_stats(uuid)',
    'api.list_orders(uuid,text,text,integer,integer)'
  ] LOOP
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role lacks EXECUTE on %', fn; END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon can EXECUTE %', fn; END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated can EXECUTE %', fn; END IF;
  END LOOP;
END $$;

-- ============================================================
-- §10 — client-held guest token: idempotent replay does NOT rotate
--   (order-workflow #1 + #2). The client generates the token and sends only its
--   hash; place_order returns NO token. A replay preserves totals, issues no
--   token, and — critically — leaves guest_token_hash UNCHANGED so a saved or
--   shared tracking link (and concurrent retries) stay valid. Scope is bound to
--   the original actor; a guest placement without a token hash is rejected; a
--   mismatched payload on the same key still conflicts.
--
--   Concurrency note: true parallelism can't be expressed in one SQL transaction,
--   but the safety proof is structural — the unique idempotency key serializes
--   writers, and the replay branch performs NO writes (asserted below via the
--   unchanged hash), so no ordering of concurrent retries can invalidate a token.
-- ============================================================
DO $$
DECLARE
  r1 jsonb; r2 jsonb; oid uuid; ono text; h_before text; h_after text;
  raw text := 'client-token-s10-raw-value-0123456789';
  cli_hash text := encode(extensions.digest('client-token-s10-raw-value-0123456789','sha256'),'hex');
  cu jsonb := jsonb_build_object('name','Replay','phone','01788888888','district','Dhaka','address','8 Rd');
  lines jsonb := '[{"code":"p4-prod","qty":1}]'::jsonb;
BEGIN
  -- fresh guest place: full totals, NO server token; the stored hash is the
  -- client's own, and the client's raw token tracks the order.
  r1  := api.place_order(lines, cu, 'dhaka', 'cod', 's10-idem', NULL, NULL, p_guest_token_hash => cli_hash);
  oid := (r1->>'order_id')::uuid; ono := r1->>'order_no';
  IF (r1->>'replayed')::bool THEN RAISE EXCEPTION 'FAIL: s10 fresh flagged replayed'; END IF;
  IF (r1->'guest_token') <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL: s10 fresh leaked a token %', r1; END IF;
  IF (r1->>'subtotal')::int <> 500 THEN RAISE EXCEPTION 'FAIL: s10 fresh subtotal %', r1; END IF;
  IF (r1->>'total')::int <= 500 THEN RAISE EXCEPTION 'FAIL: s10 fresh total (no shipping) %', r1; END IF;
  SELECT guest_token_hash INTO h_before FROM public.orders WHERE id = oid;
  IF h_before <> cli_hash THEN RAISE EXCEPTION 'FAIL: s10 stored hash is not the client hash'; END IF;
  -- the client's raw token hashes (server-side, in track wrapper) to the stored hash
  IF encode(extensions.digest(raw,'sha256'),'hex') <> h_before THEN
    RAISE EXCEPTION 'FAIL: s10 raw token does not hash to stored hash'; END IF;
  IF api.track_order(ono, h_before) IS NULL THEN RAISE EXCEPTION 'FAIL: s10 token not trackable'; END IF;

  -- REPLAY (same key + payload): totals preserved, NO token, hash UNCHANGED.
  r2 := api.place_order(lines, cu, 'dhaka', 'cod', 's10-idem', NULL, NULL, p_guest_token_hash => cli_hash);
  IF NOT (r2->>'replayed')::bool THEN RAISE EXCEPTION 'FAIL: s10 replay not flagged %', r2; END IF;
  IF (r2->>'order_id') <> (r1->>'order_id') THEN RAISE EXCEPTION 'FAIL: s10 replay different order'; END IF;
  IF (r2->>'total')::int <> (r1->>'total')::int THEN RAISE EXCEPTION 'FAIL: s10 replay lost total %', r2; END IF;
  IF (r2->>'subtotal')::int <> (r1->>'subtotal')::int THEN RAISE EXCEPTION 'FAIL: s10 replay lost subtotal'; END IF;
  IF (r2->'guest_token') <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL: s10 replay leaked a token %', r2; END IF;
  SELECT guest_token_hash INTO h_after FROM public.orders WHERE id = oid;
  IF h_after <> h_before THEN RAISE EXCEPTION 'FAIL: s10 replay ROTATED the hash (link invalidated)'; END IF;
  -- the ORIGINAL link still works after the replay
  IF api.track_order(ono, h_before) IS NULL THEN RAISE EXCEPTION 'FAIL: s10 original link broke after replay'; END IF;

  -- a REPLAY under a signed-in actor (different scope) is rejected
  BEGIN
    PERFORM api.place_order(lines, cu, 'dhaka', 'cod', 's10-idem',
      '00000000-0000-0000-0000-0000000000b2'::uuid, NULL, p_guest_token_hash => cli_hash);
    RAISE EXCEPTION 'FAIL: s10 cross-scope replay allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE EXCEPTION 'FAIL: s10 scope err=%', SQLERRM; END IF;
  END;

  -- same key, DIFFERENT payload → still a conflict (identity is preserved)
  BEGIN
    PERFORM api.place_order('[{"code":"p4-prod","qty":2}]'::jsonb, cu, 'dhaka', 'cod', 's10-idem',
      NULL, NULL, p_guest_token_hash => cli_hash);
    RAISE EXCEPTION 'FAIL: s10 mismatched payload did not conflict';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE EXCEPTION 'FAIL: s10 conflict err=%', SQLERRM; END IF;
  END;

  -- a guest placement with NO token hash is rejected (would be untrackable)
  BEGIN
    PERFORM api.place_order(lines, cu, 'dhaka', 'cod', 's10-notoken', NULL, NULL);
    RAISE EXCEPTION 'FAIL: s10 guest without token hash allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'guest_token_required' THEN RAISE EXCEPTION 'FAIL: s10 notoken err=%', SQLERRM; END IF;
  END;

  -- a malformed token hash is rejected
  BEGIN
    PERFORM api.place_order(lines, cu, 'dhaka', 'cod', 's10-badtoken', NULL, NULL,
      p_guest_token_hash => 'not-a-valid-sha256');
    RAISE EXCEPTION 'FAIL: s10 malformed token hash allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'guest_token_required' THEN RAISE EXCEPTION 'FAIL: s10 badtoken err=%', SQLERRM; END IF;
  END;
END $$;

-- §10b — signed-in replay: totals preserved, never a guest token, deletion-safe
DO $$
DECLARE
  r1 jsonb; r2 jsonb; oid uuid; th text;
  cu jsonb := jsonb_build_object('name','ReplayU','phone','01799999999','district','Dhaka','address','9 Rd');
BEGIN
  -- a signed-in order carries NO guest token hash even if the client sends one
  r1 := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'cod', 's10u-idem',
    '00000000-0000-0000-0000-0000000000b2'::uuid, NULL,
    p_guest_token_hash => encode(extensions.digest('ignored','sha256'),'hex'));
  oid := (r1->>'order_id')::uuid;
  SELECT guest_token_hash INTO th FROM public.orders WHERE id = oid;
  IF th IS NOT NULL THEN RAISE EXCEPTION 'FAIL: s10u signed-in order stored a guest hash (deletion risk)'; END IF;

  r2 := api.place_order('[{"code":"p4-prod","qty":1}]'::jsonb, cu, 'dhaka', 'cod', 's10u-idem',
    '00000000-0000-0000-0000-0000000000b2'::uuid, NULL);
  IF NOT (r2->>'replayed')::bool THEN RAISE EXCEPTION 'FAIL: s10u replay not flagged %', r2; END IF;
  IF (r2->>'total')::int <> (r1->>'total')::int THEN RAISE EXCEPTION 'FAIL: s10u replay lost total'; END IF;
  IF (r2->'guest_token') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: s10u signed-in replay leaked a guest token'; END IF;
END $$;

ROLLBACK;
