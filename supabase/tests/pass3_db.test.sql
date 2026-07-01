-- Stage 3 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty). Asserts the database-level invariants
-- that TS/Vitest cannot cover. Run with: psql -v ON_ERROR_STOP=1 -f this.sql
--
-- Convention (same as pass2_db.test.sql):
--   * expected-SUCCESS: run plainly (ON_ERROR_STOP aborts on error).
--   * expected-FAILURE: wrap in a sub-block; if it did NOT raise → RAISE 'FAIL:'.
--   * value checks: RAISE 'FAIL:' when the invariant is violated.
--
-- §P1 — order schema, numbering & idempotency (no RPCs yet).

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures (clean DB) ──────────────────────────────────────────────────────
INSERT INTO public.product_categories (slug, name, sort_order) VALUES ('o-cat', 'Orders Cat', 0);
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'o-prod', 'o-prod', 'Order Product', id, 500, 50
  FROM public.product_categories WHERE slug = 'o-cat';

-- ============================================================
-- §1 — orders pricing invariant + owner XOR
-- ============================================================
DO $$
DECLARE pid uuid; oid uuid;
BEGIN
  SELECT id INTO pid FROM public.products WHERE code = 'o-prod';

  -- unbalanced total rejected
  BEGIN
    INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
      ship_district, ship_zone, ship_address, subtotal, discount, shipping_fee, total,
      payment_method, status, idempotency_key)
    VALUES ('NGR-T-1', repeat('a',64), 'X', '01700000000', 'Dhaka', 'dhaka', 'addr',
      1000, 0, 80, 999, 'bkash', 'pending_payment', 'idem-bad');
    RAISE EXCEPTION 'FAIL: unbalanced total accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- both owners set rejected
  BEGIN
    INSERT INTO public.orders (order_no, user_id, guest_token_hash, customer_name, customer_phone,
      ship_district, ship_zone, ship_address, subtotal, shipping_fee, total,
      payment_method, status, idempotency_key)
    VALUES ('NGR-T-2', gen_random_uuid(), repeat('a',64), 'X', '01700000000', 'Dhaka', 'dhaka', 'addr',
      1000, 80, 1080, 'bkash', 'pending_payment', 'idem-xor1');
    RAISE EXCEPTION 'FAIL: two-owner order accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- neither owner set rejected
  BEGIN
    INSERT INTO public.orders (order_no, customer_name, customer_phone,
      ship_district, ship_zone, ship_address, subtotal, shipping_fee, total,
      payment_method, status, idempotency_key)
    VALUES ('NGR-T-2b', 'X', '01700000000', 'Dhaka', 'dhaka', 'addr',
      1000, 80, 1080, 'bkash', 'pending_payment', 'idem-xor2');
    RAISE EXCEPTION 'FAIL: owner-less order accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- valid guest order + invalid zone rejected
  BEGIN
    INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
      ship_district, ship_zone, ship_address, subtotal, shipping_fee, total,
      payment_method, status, idempotency_key)
    VALUES ('NGR-T-2c', repeat('a',64), 'X', '01700000000', 'Dhaka', 'mars', 'addr',
      1000, 80, 1080, 'bkash', 'pending_payment', 'idem-zone');
    RAISE EXCEPTION 'FAIL: invalid zone accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
    ship_district, ship_zone, ship_address, subtotal, discount, shipping_fee, total,
    payment_method, status, idempotency_key)
  VALUES ('NGR-T-3', repeat('b',64), 'Cathy', '01700000000', 'Dhaka', 'dhaka', 'addr 1',
    2000, 100, 0, 1900, 'cod', 'pending_confirmation', 'idem-ok')
  RETURNING id INTO oid;

  -- duplicate idempotency_key rejected
  BEGIN
    INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
      ship_district, ship_zone, ship_address, subtotal, shipping_fee, total,
      payment_method, status, idempotency_key)
    VALUES ('NGR-T-3dup', repeat('c',64), 'Y', '01700000000', 'Dhaka', 'dhaka', 'a',
      100, 0, 100, 'cod', 'pending_confirmation', 'idem-ok');
    RAISE EXCEPTION 'FAIL: duplicate idempotency_key accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- ============================================================
-- §2 — order_items line_total + FK RESTRICT on product
-- ============================================================
DO $$
DECLARE pid uuid; oid uuid;
BEGIN
  SELECT id INTO pid FROM public.products WHERE code = 'o-prod';
  SELECT id INTO oid FROM public.orders WHERE order_no = 'NGR-T-3';

  BEGIN
    INSERT INTO public.order_items (order_id, product_id, name, unit_price, qty, line_total)
    VALUES (oid, pid, 'Item', 500, 2, 999);
    RAISE EXCEPTION 'FAIL: bad line_total accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.order_items (order_id, product_id, name, unit_price, qty, line_total)
  VALUES (oid, pid, 'Item', 500, 2, 1000);

  -- product with order history cannot be deleted (FK RESTRICT)
  BEGIN
    DELETE FROM public.products WHERE id = pid;
    RAISE EXCEPTION 'FAIL: product with order_items deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

-- ============================================================
-- §3 — order_status_history is append-only
-- ============================================================
DO $$
DECLARE oid uuid; hid uuid; got text;
BEGIN
  SELECT id INTO oid FROM public.orders WHERE order_no = 'NGR-T-3';
  INSERT INTO public.order_status_history (order_id, to_status)
  VALUES (oid, 'pending_confirmation') RETURNING id INTO hid;

  BEGIN UPDATE public.order_status_history SET reason = 'x' WHERE id = hid;
        RAISE EXCEPTION 'FAIL: history UPDATE allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got NOT LIKE '%append-only%' THEN RAISE EXCEPTION 'FAIL: hist update code=%', got; END IF; END;

  BEGIN DELETE FROM public.order_status_history WHERE id = hid;
        RAISE EXCEPTION 'FAIL: history DELETE allowed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got NOT LIKE '%append-only%' THEN RAISE EXCEPTION 'FAIL: hist delete code=%', got; END IF; END;
END $$;

-- ============================================================
-- §4 — verified-TrxID fraud guard (unique only among verified)
-- ============================================================
DO $$
DECLARE oid uuid;
BEGIN
  SELECT id INTO oid FROM public.orders WHERE order_no = 'NGR-T-3';

  INSERT INTO public.payments (order_id, method, amount, trx_id, status)
  VALUES (oid, 'bkash', 1900, 'TRX123', 'verified');

  -- case-insensitive collision among verified → reject
  BEGIN
    INSERT INTO public.payments (order_id, method, amount, trx_id, status)
    VALUES (oid, 'bkash', 1900, 'trx123', 'verified');
    RAISE EXCEPTION 'FAIL: duplicate verified TrxID accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- a pending payment with the same trx is allowed (only verified is unique)
  INSERT INTO public.payments (order_id, method, amount, trx_id, status)
  VALUES (oid, 'bkash', 1900, 'TRX123', 'pending');

  -- a different method may reuse the trx
  INSERT INTO public.payments (order_id, method, amount, trx_id, status)
  VALUES (oid, 'nagad', 1900, 'TRX123', 'verified');
END $$;

-- ============================================================
-- §5 — idempotency_keys + order_no sequence
-- ============================================================
DO $$
DECLARE oid uuid; a bigint; b bigint;
BEGIN
  SELECT id INTO oid FROM public.orders WHERE order_no = 'NGR-T-3';
  INSERT INTO public.idempotency_keys (key, scope, request_hash, order_id)
  VALUES ('idem-ok', 'guest', 'hash123', oid);

  BEGIN
    INSERT INTO public.idempotency_keys (key, scope, request_hash)
    VALUES ('idem-ok', 'guest', 'other');
    RAISE EXCEPTION 'FAIL: duplicate idempotency key accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  a := nextval('public.order_no_seq');
  b := nextval('public.order_no_seq');
  IF b <> a + 1 THEN RAISE EXCEPTION 'FAIL: sequence not monotonic % %', a, b; END IF;
END $$;

-- ============================================================
-- §6 — RPC-only posture: RLS enabled, no policies, no anon/auth grants
-- ============================================================
DO $$
DECLARE t text; n int;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders','order_items','order_status_history','payments',
    'payment_screenshots','idempotency_keys','inventory_reservations'
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.'||t)::regclass) THEN
      RAISE EXCEPTION 'FAIL: % RLS not enabled', t; END IF;
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % has % policies (want 0)', t, n; END IF;
    IF has_table_privilege('anon', 'public.'||t, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL: anon has SELECT on %', t; END IF;
    IF has_table_privilege('authenticated', 'public.'||t, 'INSERT') THEN
      RAISE EXCEPTION 'FAIL: authenticated has INSERT on %', t; END IF;
  END LOOP;
END $$;

-- ============================================================
-- §P2 — reservations: availability, lazy backstop & TTL expiry
-- ============================================================
DO $$
DECLARE pid uuid; base int; o1 uuid; o2 uuid; av int; n int;
BEGIN
  SELECT id, stock INTO pid, base FROM public.products WHERE code = 'o-prod';

  -- order #1: pending_payment, TTL in the PAST, active hold of 3
  INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
    ship_district, ship_zone, ship_address, subtotal, shipping_fee, total, payment_method,
    status, idempotency_key, reservation_expires_at)
  VALUES ('NGR-R-1', repeat('1',64), 'A', '01700000000', 'Dhaka', 'dhaka', 'a',
    100, 0, 100, 'bkash', 'pending_payment', 'idem-r1', now() - interval '1 hour')
  RETURNING id INTO o1;
  INSERT INTO public.inventory_reservations (order_id, product_id, qty, status, expires_at)
  VALUES (o1, pid, 3, 'active', now() - interval '1 hour');

  -- lazy backstop: an EXPIRED hold does not reduce availability
  av := private.available_qty(pid, NULL);
  IF av <> base THEN RAISE EXCEPTION 'FAIL: expired hold reduced availability (av=% base=%)', av, base; END IF;

  -- order #2: pending_confirmation, TTL in the FUTURE, active hold of 2
  INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
    ship_district, ship_zone, ship_address, subtotal, shipping_fee, total, payment_method,
    status, idempotency_key, reservation_expires_at)
  VALUES ('NGR-R-2', repeat('2',64), 'B', '01700000000', 'Dhaka', 'dhaka', 'a',
    100, 0, 100, 'cod', 'pending_confirmation', 'idem-r2', now() + interval '1 hour')
  RETURNING id INTO o2;
  INSERT INTO public.inventory_reservations (order_id, product_id, qty, status, expires_at)
  VALUES (o2, pid, 2, 'active', now() + interval '1 hour');

  -- only the unexpired hold counts
  av := private.available_qty(pid, NULL);
  IF av <> base - 2 THEN RAISE EXCEPTION 'FAIL: active hold not counted (av=% want=%)', av, base - 2; END IF;

  -- expiry sweep: expires #1 only
  n := api.expire_reservations();
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expire count=% (want 1)', n; END IF;
  IF (SELECT status FROM public.orders WHERE id = o1) <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: order1 not expired'; END IF;
  IF (SELECT status FROM public.inventory_reservations WHERE order_id = o1) <> 'released' THEN
    RAISE EXCEPTION 'FAIL: reservation1 not released'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_status_history
                 WHERE order_id = o1 AND to_status = 'expired' AND from_status = 'pending_payment') THEN
    RAISE EXCEPTION 'FAIL: missing expiry history'; END IF;
  IF (SELECT status FROM public.orders WHERE id = o2) <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'FAIL: future-TTL order wrongly expired'; END IF;

  -- an order with submitted evidence past its TTL must NOT be auto-expired
  UPDATE public.orders SET status = 'payment_submitted', reservation_expires_at = now() - interval '1 hour'
    WHERE id = o2;
  n := api.expire_reservations();
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: payment_submitted auto-expired (n=%)', n; END IF;

  -- BUG-03: an ABANDONED payment_rejected order past its TTL IS reclaimed
  -- (status → expired, hold released), unlike payment_submitted above.
  UPDATE public.orders SET status = 'payment_rejected', reservation_expires_at = now() - interval '1 hour'
    WHERE id = o2;
  n := api.expire_reservations();
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: payment_rejected not swept (n=%)', n; END IF;
  IF (SELECT status FROM public.orders WHERE id = o2) <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: rejected order not expired'; END IF;
  IF (SELECT status FROM public.inventory_reservations WHERE order_id = o2) <> 'released' THEN
    RAISE EXCEPTION 'FAIL: rejected reservation not released'; END IF;
END $$;

-- ============================================================
-- §P3 — quote_order + place_order (server pricing, oversell,
--        idempotency, price-drift, guest token)
-- ============================================================
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'o-ord', 'o-ord', 'Orderable', id, 500, 50
  FROM public.product_categories WHERE slug = 'o-cat';

DO $$
DECLARE
  q jsonb; r jsonb; r2 jsonb; av int; got text; pid uuid;
  cust jsonb := jsonb_build_object('name','Cathy','phone','01700000000','district','Dhaka','address','12 Rd');
  lines2 jsonb := '[{"code":"o-ord","qty":2}]'::jsonb;
  tok text;
BEGIN
  SELECT id INTO pid FROM public.products WHERE code = 'o-ord';

  -- quote: 2 x 500 = 1000 + 80 shipping (under the 3000 free threshold)
  q := api.quote_order(lines2, 'dhaka');
  IF (q->>'subtotal')::int <> 1000 OR (q->>'shipping_fee')::int <> 80 OR (q->>'total')::int <> 1080 THEN
    RAISE EXCEPTION 'FAIL: quote %', q; END IF;
  tok := q->>'quote_token';

  -- place a guest COD order with the matching token
  r := api.place_order(lines2, cust, 'dhaka', 'cod', 'p3-idem-1', NULL, tok);
  IF (r->>'total')::int <> 1080 OR (r->>'status') <> 'pending_confirmation'
     OR (r->>'guest_token') IS NULL OR (r->>'replayed')::bool THEN RAISE EXCEPTION 'FAIL: place %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id=(r->>'order_id')::uuid AND qty=2 AND unit_price=500)
     OR NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE order_id=(r->>'order_id')::uuid AND status='active' AND qty=2)
     OR NOT EXISTS (SELECT 1 FROM public.payments WHERE order_id=(r->>'order_id')::uuid AND amount=1080 AND status='pending')
     OR NOT EXISTS (SELECT 1 FROM public.order_status_history WHERE order_id=(r->>'order_id')::uuid AND to_status='pending_confirmation')
     OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action='order.placed' AND target_id=(r->>'order_id')) THEN
    RAISE EXCEPTION 'FAIL: order child rows'; END IF;
  av := private.available_qty(pid, NULL);
  IF av <> 48 THEN RAISE EXCEPTION 'FAIL: availability=% (want 48)', av; END IF;

  -- idempotent replay → same order, no duplicate
  r2 := api.place_order(lines2, cust, 'dhaka', 'cod', 'p3-idem-1', NULL, tok);
  IF NOT (r2->>'replayed')::bool OR (r2->>'order_no') <> (r->>'order_no')
     OR (SELECT count(*) FROM public.orders WHERE idempotency_key='p3-idem-1') <> 1 THEN
    RAISE EXCEPTION 'FAIL: replay'; END IF;

  -- true oversell: qty 49 (<=50 bound) but only 48 available
  BEGIN PERFORM api.place_order('[{"code":"o-ord","qty":49}]'::jsonb, cust, 'dhaka', 'bkash', 'p3-os', NULL, NULL);
        RAISE EXCEPTION 'FAIL: oversell accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'out_of_stock' THEN RAISE EXCEPTION 'FAIL: oversell=%', got; END IF; END;

  -- qty bound
  BEGIN PERFORM api.place_order('[{"code":"o-ord","qty":51}]'::jsonb, cust, 'dhaka', 'bkash', 'p3-q', NULL, NULL);
        RAISE EXCEPTION 'FAIL: invalid_qty accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'invalid_qty' THEN RAISE EXCEPTION 'FAIL: qty=%', got; END IF; END;

  -- price drift (stale token)
  BEGIN PERFORM api.place_order(lines2, cust, 'dhaka', 'bkash', 'p3-dr', NULL, 'deadbeef');
        RAISE EXCEPTION 'FAIL: drift accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'price_changed' THEN RAISE EXCEPTION 'FAIL: drift=%', got; END IF; END;

  -- idempotency conflict (same key, different payload)
  BEGIN PERFORM api.place_order('[{"code":"o-ord","qty":3}]'::jsonb, cust, 'dhaka', 'cod', 'p3-idem-1', NULL, NULL);
        RAISE EXCEPTION 'FAIL: conflict accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'idempotency_conflict' THEN RAISE EXCEPTION 'FAIL: conflict=%', got; END IF; END;

  -- unknown product
  BEGIN PERFORM api.place_order('[{"code":"nope","qty":1}]'::jsonb, cust, 'dhaka', 'cod', 'p3-x', NULL, NULL);
        RAISE EXCEPTION 'FAIL: bad product accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'product_not_purchasable' THEN RAISE EXCEPTION 'FAIL: badprod=%', got; END IF; END;
END $$;

-- §P3-custom — custom (made-to-order) server pricing + configurable hold window
INSERT INTO public.products (code, slug, name, category_id, price, sale_price, stock, custom_size, custom_size_charge)
  SELECT 'o-cust', 'o-cust', 'Custom Kurti', id, 2000, 1800, 10, true, 300
  FROM public.product_categories WHERE slug = 'o-cat';

DO $$
DECLARE
  q jsonb; r jsonb; cline jsonb; got text; pid uuid; av_before int; av_after int; hrs numeric;
  cust jsonb := jsonb_build_object('name','Cathy','phone','01700000000','district','Dhaka','address','12 Rd');
BEGIN
  SELECT id INTO pid FROM public.products WHERE code = 'o-cust';

  -- quote: a 'Custom' line is priced base(1800) + custom_size_charge(300) = 2100,
  -- flagged custom, and made-to-order (available is null, not stock-bound).
  q := api.quote_order('[{"code":"o-cust","size":"Custom","qty":1}]'::jsonb, 'dhaka');
  cline := (q->'lines')->0;
  IF (cline->>'unit_price')::int <> 2100 OR (cline->>'line_total')::int <> 2100
     OR NOT (cline->>'custom')::bool OR (cline->>'available') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: custom quote line %', cline; END IF;
  IF (q->>'subtotal')::int <> 2100 THEN RAISE EXCEPTION 'FAIL: custom subtotal %', q; END IF;

  -- place a custom order: succeeds (no out_of_stock), records unit=2100, creates
  -- NO reservation, and never touches ready-size stock.
  av_before := private.available_qty(pid, NULL);
  r := api.place_order('[{"code":"o-cust","size":"Custom","qty":2}]'::jsonb, cust, 'dhaka', 'bkash', 'p3-cust-1', NULL, NULL);
  IF (r->>'status') <> 'pending_payment' OR (r->>'total')::int <> 4200 THEN
    RAISE EXCEPTION 'FAIL: custom place %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id=(r->>'order_id')::uuid
                 AND variant_size='Custom' AND unit_price=2100 AND qty=2 AND line_total=4200) THEN
    RAISE EXCEPTION 'FAIL: custom order_item'; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE order_id=(r->>'order_id')::uuid) THEN
    RAISE EXCEPTION 'FAIL: custom line must not reserve ready stock'; END IF;
  av_after := private.available_qty(pid, NULL);
  IF av_after <> av_before THEN
    RAISE EXCEPTION 'FAIL: custom order moved ready stock % -> %', av_before, av_after; END IF;

  -- guard: 'Custom' on a product without custom_size is not purchasable.
  BEGIN PERFORM api.place_order('[{"code":"o-ord","size":"Custom","qty":1}]'::jsonb, cust, 'dhaka', 'cod', 'p3-badcust', NULL, NULL);
        RAISE EXCEPTION 'FAIL: custom on non-custom product accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'product_not_purchasable' THEN RAISE EXCEPTION 'FAIL: badcust=%', got; END IF; END;

  -- GAP-07: the reservation/hold window honours site_settings.order_hold_hours.
  UPDATE public.site_settings SET order_hold_hours = 48 WHERE id = 1;
  r := api.place_order('[{"code":"o-ord","qty":1}]'::jsonb, cust, 'dhaka', 'cod', 'p3-hold-48', NULL, NULL);
  SELECT round(extract(epoch FROM (reservation_expires_at - now())) / 3600) INTO hrs
    FROM public.orders WHERE id = (r->>'order_id')::uuid;
  IF hrs <> 48 THEN RAISE EXCEPTION 'FAIL: order_hold_hours ignored (got % h, want 48)', hrs; END IF;
  UPDATE public.site_settings SET order_hold_hours = 24 WHERE id = 1;
END $$;

-- ============================================================
-- §P5 — coupons (server discount math, limits, eligibility, race-safe consume)
-- ============================================================
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'o-coup', 'o-coup', 'Couponable', id, 1000, 100
  FROM public.product_categories WHERE slug = 'o-cat';

INSERT INTO public.coupons (code, type, value, min_subtotal) VALUES
  ('SAVE10','percent',10,1000),
  ('FLAT300','fixed',300,0),
  ('FREESHIP','free_shipping',0,0),
  ('MIN5K','fixed',100,5000);
INSERT INTO public.coupons (code, type, value, usage_limit) VALUES ('ONCE','fixed',100,1);
INSERT INTO public.coupons (code, type, value, first_order_only) VALUES ('NEWBIE','fixed',100,true);

DO $$
DECLARE
  q jsonb; r jsonb; got text; n int;
  cust jsonb := jsonb_build_object('name','Coupy','phone','01700000000','district','Dhaka','address','9 Rd');
  lines jsonb := '[{"code":"o-coup","qty":2}]'::jsonb;  -- subtotal 2000, shipping 80
BEGIN
  -- quote echoes an applied percent coupon (200 off → total 1880); code normalised.
  q := api.quote_order(lines, 'dhaka', 'save10');
  IF NOT (q->'coupon'->>'applied')::bool OR (q->>'discount')::int <> 200 OR (q->>'total')::int <> 1880 THEN
    RAISE EXCEPTION 'FAIL: quote percent %', q; END IF;

  -- quote rejects below-min WITHOUT raising (cart stays quotable).
  q := api.quote_order(lines, 'dhaka', 'MIN5K');
  IF (q->'coupon'->>'applied')::bool OR (q->'coupon'->>'reason') <> 'coupon_min_not_met' THEN
    RAISE EXCEPTION 'FAIL: quote min %', q; END IF;

  -- place percent: discount 200, coupon_code stored, usage row + counter bump,
  -- balanced-total invariant holds.
  r := api.place_order(lines, cust, 'dhaka', 'cod', 'p5-pct', NULL, NULL, 'SAVE10');
  IF (r->>'discount')::int <> 200 OR (r->>'total')::int <> 1880 OR (r->>'coupon') <> 'SAVE10' THEN
    RAISE EXCEPTION 'FAIL: place percent %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id=(r->>'order_id')::uuid
                 AND discount=200 AND coupon_code='SAVE10' AND subtotal-discount+shipping_fee=total) THEN
    RAISE EXCEPTION 'FAIL: percent order row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coupon_usages
                 WHERE coupon_code='SAVE10' AND order_id=(r->>'order_id')::uuid AND amount=200) THEN
    RAISE EXCEPTION 'FAIL: percent usage row'; END IF;
  SELECT usage_count INTO n FROM public.coupons WHERE code='SAVE10';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: percent usage_count=% (want 1)', n; END IF;

  -- fixed: 300 off → total 1780.
  r := api.place_order(lines, cust, 'dhaka', 'cod', 'p5-fix', NULL, NULL, 'FLAT300');
  IF (r->>'discount')::int <> 300 OR (r->>'total')::int <> 1780 THEN
    RAISE EXCEPTION 'FAIL: place fixed %', r; END IF;

  -- free_shipping: discount 0, shipping waived to 0, total 2000; usage records the
  -- 80 waived.
  r := api.place_order(lines, cust, 'dhaka', 'cod', 'p5-free', NULL, NULL, 'FREESHIP');
  IF (r->>'discount')::int <> 0 OR (r->>'shipping_fee')::int <> 0 OR (r->>'total')::int <> 2000 THEN
    RAISE EXCEPTION 'FAIL: place free_shipping %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coupon_usages WHERE coupon_code='FREESHIP' AND amount=80) THEN
    RAISE EXCEPTION 'FAIL: free_shipping usage amount'; END IF;

  -- min not met at place → coupon_min_not_met (hard raise).
  BEGIN PERFORM api.place_order(lines, cust, 'dhaka', 'cod', 'p5-min', NULL, NULL, 'MIN5K');
        RAISE EXCEPTION 'FAIL: below-min accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'coupon_min_not_met' THEN RAISE EXCEPTION 'FAIL: min=%', got; END IF; END;

  -- unknown coupon at place → invalid_coupon.
  BEGIN PERFORM api.place_order(lines, cust, 'dhaka', 'cod', 'p5-bad', NULL, NULL, 'NOPE');
        RAISE EXCEPTION 'FAIL: invalid coupon accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'invalid_coupon' THEN RAISE EXCEPTION 'FAIL: invalid=%', got; END IF; END;

  -- first_order_only as a guest → coupon_not_eligible (can't verify history).
  BEGIN PERFORM api.place_order(lines, cust, 'dhaka', 'cod', 'p5-new', NULL, NULL, 'NEWBIE');
        RAISE EXCEPTION 'FAIL: first-order guest accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'coupon_not_eligible' THEN RAISE EXCEPTION 'FAIL: newbie=%', got; END IF; END;

  -- global usage_limit: ONCE (limit 1) — first redeems, second is exhausted.
  r := api.place_order(lines, cust, 'dhaka', 'cod', 'p5-once1', NULL, NULL, 'ONCE');
  IF (r->>'discount')::int <> 100 THEN RAISE EXCEPTION 'FAIL: ONCE first redeem %', r; END IF;
  BEGIN PERFORM api.place_order(lines, cust, 'dhaka', 'cod', 'p5-once2', NULL, NULL, 'ONCE');
        RAISE EXCEPTION 'FAIL: usage_limit exceeded accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'coupon_exhausted' THEN RAISE EXCEPTION 'FAIL: exhausted=%', got; END IF; END;
END $$;

-- §P5-admin — admin coupon RPCs (create/edit/toggle/delete + guards)
-- Seed a staff actor (the from-empty CI DB has none), mirroring pass4_db.test.sql.
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000c1')
  ON CONFLICT DO NOTHING;
INSERT INTO public.staff_profiles (user_id, role, is_active)
  VALUES ('00000000-0000-0000-0000-0000000000c1', 'admin', true) ON CONFLICT DO NOTHING;

DO $$
DECLARE r jsonb; got text; staff uuid := '00000000-0000-0000-0000-0000000000c1';
BEGIN
  r := api.upsert_coupon(staff, '{"code":"admincpn","type":"percent","value":20,"max_discount":400}');
  IF (r->>'created')::bool IS NOT TRUE OR (r->'coupon'->>'code') <> 'ADMINCPN' THEN
    RAISE EXCEPTION 'FAIL: admin create %', r; END IF;
  r := api.upsert_coupon(staff, '{"code":"ADMINCPN","type":"free_shipping","value":0}');
  IF (r->>'created')::bool IS NOT FALSE OR (r->'coupon'->>'type') <> 'free_shipping' THEN
    RAISE EXCEPTION 'FAIL: admin edit %', r; END IF;

  -- coherence: percent > 100 → invalid_coupon_config.
  BEGIN PERFORM api.upsert_coupon(staff, '{"code":"BADPCT","type":"percent","value":150}');
        RAISE EXCEPTION 'FAIL: bad percent accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'invalid_coupon_config' THEN RAISE EXCEPTION 'FAIL: config=%', got; END IF; END;

  r := api.set_coupon_active(staff, 'ADMINCPN', false);
  IF (r->>'active')::bool IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: toggle'; END IF;

  -- a used coupon cannot be deleted (SAVE10 was redeemed above) → coupon_in_use.
  BEGIN PERFORM api.delete_coupon(staff, 'SAVE10');
        RAISE EXCEPTION 'FAIL: used coupon deleted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'coupon_in_use' THEN RAISE EXCEPTION 'FAIL: in_use=%', got; END IF; END;

  -- an unused coupon deletes cleanly.
  IF NOT (api.delete_coupon(staff, 'ADMINCPN')->>'deleted')::bool THEN
    RAISE EXCEPTION 'FAIL: delete unused'; END IF;

  -- non-staff actor is rejected.
  BEGIN PERFORM api.list_coupons(gen_random_uuid());
        RAISE EXCEPTION 'FAIL: non-staff read';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=MESSAGE_TEXT;
    IF got <> 'actor_not_authorized' THEN RAISE EXCEPTION 'FAIL: authz=%', got; END IF; END;
END $$;

-- grants: quote_order is public; place_order + coupon-admin RPCs are service-role only
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'api.quote_order(jsonb,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon cannot call quote_order'; END IF;
  IF has_function_privilege('anon', 'api.place_order(jsonb,jsonb,text,text,text,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can call place_order'; END IF;
  IF has_function_privilege('authenticated', 'api.place_order(jsonb,jsonb,text,text,text,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated can call place_order'; END IF;
  IF has_function_privilege('anon', 'api.list_coupons(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'api.upsert_coupon(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'api.delete_coupon(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: coupon-admin RPC exposed to anon/authenticated'; END IF;
END $$;

ROLLBACK;
