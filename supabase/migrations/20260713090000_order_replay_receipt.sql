-- Stage 7 (order-workflow #2) — idempotent-replay recovery contract.
--
-- Problem: the previous api.place_order replay branch (coupon_pricing.sql)
-- returned only { order_id, order_no, status, replayed }. A guest double-submit
-- or network retry therefore reached /order-success WITHOUT the raw guest
-- tracking token (the DB stores only its sha256 hash) and without totals — so
-- the customer could lose the ONLY credential that lets them track/claim their
-- order, and the success summary showed a 0 total.
--
-- Fix: the replay branch now returns the SAME contract as a fresh placement
-- (subtotal/discount/shipping/total/coupon) read back from the order, and for a
-- GUEST order it re-issues a fresh capability token (rotating guest_token_hash)
-- so a retry always yields a working tracking link. This does not weaken token
-- hashing (only the hash is ever stored) and cannot expose another customer's
-- order: reaching the replay branch requires possession of the client's random
-- idempotency key, and the lookup is by that key alone.
--
-- Everything else in place_order is unchanged (reproduced verbatim for the
-- required CREATE OR REPLACE). Signature is identical, so grants are unchanged.

CREATE OR REPLACE FUNCTION api.place_order(
  p_lines jsonb, p_customer jsonb, p_zone text, p_payment_method text,
  p_idempotency_key text, p_actor uuid DEFAULT NULL, p_quote_token text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scope text; v_req_hash text; v_existing record; v_existing_user uuid;
  priced jsonb; e jsonb; subtotal integer; shipping integer; total integer;
  canon text; v_order_id uuid; v_order_no text; v_status text;
  v_guest_token text; v_guest_hash text; pidlist uuid[]; v_hold integer; v_expires timestamptz;
  v_idx integer; v_measures jsonb;
  v_code text; v_coupon public.coupons; v_reason text; v_amt jsonb;
  v_discount integer := 0; v_ship_final integer; v_used_user integer := 0;
  v_had_prior boolean := false; v_usage_scope text; v_coupon_amount integer := 0;
BEGIN
  IF p_payment_method NOT IN ('cod','bkash','nagad') THEN
    RAISE EXCEPTION 'invalid_payment_method'; END IF;
  IF p_zone NOT IN ('dhaka','major','outside') THEN
    RAISE EXCEPTION 'invalid_address'; END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'empty_cart'; END IF;
  IF COALESCE(p_customer->>'name','') = '' OR COALESCE(p_customer->>'phone','') = ''
     OR COALESCE(p_customer->>'district','') = '' OR COALESCE(p_customer->>'address','') = '' THEN
    RAISE EXCEPTION 'invalid_address' USING DETAIL = 'missing customer fields';
  END IF;

  v_code := NULLIF(upper(btrim(COALESCE(p_coupon_code, ''))), '');
  v_scope := COALESCE(p_actor::text, 'guest');
  -- Coupon is part of the request identity: a replay with a different coupon is
  -- an idempotency_conflict, not a silent second pricing.
  v_req_hash := md5(p_lines::text || '#' || COALESCE(p_customer::text,'') || '#' ||
                    p_zone || '#' || p_payment_method || '#' || COALESCE(v_code,''));

  -- Race-safe idempotency: the unique key is the serialization point.
  INSERT INTO public.idempotency_keys (key, scope, request_hash)
  VALUES (p_idempotency_key, v_scope, v_req_hash)
  ON CONFLICT (key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_existing FROM public.idempotency_keys WHERE key = p_idempotency_key;
    IF v_existing.request_hash <> v_req_hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    IF v_existing.order_id IS NOT NULL THEN
      -- Replay: return the FULL placement contract so a retry never loses the
      -- totals or the tracking credential (#2).
      SELECT o.order_no, o.status, o.subtotal, o.discount, o.shipping_fee,
             o.total, o.coupon_code, o.user_id
        INTO v_order_no, v_status, subtotal, v_discount, v_ship_final,
             total, v_code, v_existing_user
        FROM public.orders o WHERE o.id = v_existing.order_id;
      v_order_id := v_existing.order_id;

      -- The raw guest token is unrecoverable (only its hash is stored). For a
      -- guest order, re-issue a fresh capability so the retry still gets a
      -- working tracking link. Safe: reaching here requires the client's random
      -- idempotency key, and this only ever touches that key's own order.
      IF v_existing_user IS NULL THEN
        v_guest_token := encode(extensions.gen_random_bytes(32), 'hex');
        v_guest_hash  := encode(extensions.digest(v_guest_token, 'sha256'), 'hex');
        UPDATE public.orders SET guest_token_hash = v_guest_hash WHERE id = v_order_id;
      ELSE
        v_guest_token := NULL;
      END IF;

      RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no,
        'status', v_status, 'subtotal', subtotal, 'discount', v_discount,
        'shipping_fee', v_ship_final, 'total', total, 'coupon', v_code,
        'guest_token', v_guest_token, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING DETAIL = 'in-flight';
  END IF;

  -- Deterministic lock order (sorted by id) → deadlock-free multi-product orders.
  SELECT array_agg(DISTINCT p.id) INTO pidlist
    FROM jsonb_array_elements(p_lines) l JOIN public.products p ON p.code = l->>'code';
  IF pidlist IS NULL THEN RAISE EXCEPTION 'product_not_purchasable'; END IF;
  PERFORM id FROM public.products WHERE id = ANY(pidlist) ORDER BY id FOR UPDATE;

  -- Price + validate (server prices; oversell guard under the product locks).
  -- Custom (made-to-order) lines carry available = null and skip the stock gate.
  priced := private.price_lines(p_lines);
  FOR e IN SELECT value FROM jsonb_array_elements(priced) AS value LOOP
    IF NOT COALESCE((e->>'found')::bool, false) OR NOT COALESCE((e->>'visible')::bool, false) THEN
      RAISE EXCEPTION 'product_not_purchasable' USING DETAIL = e->>'code'; END IF;
    IF (e->>'qty')::int < 1 OR (e->>'qty')::int > 50 THEN
      RAISE EXCEPTION 'invalid_qty' USING DETAIL = e->>'code'; END IF;
    IF NOT COALESCE((e->>'custom')::bool, false)
       AND (e->>'available')::int < (e->>'qty')::int THEN
      RAISE EXCEPTION 'out_of_stock' USING DETAIL = (e->>'code') || ' available=' || (e->>'available'); END IF;
  END LOOP;

  SELECT COALESCE(SUM((je->>'line_total')::int), 0) INTO subtotal FROM jsonb_array_elements(priced) je;
  shipping     := private.compute_shipping(p_zone, subtotal);
  v_ship_final := shipping;

  -- Price-drift detection against the quote token (client total never trusted).
  IF p_quote_token IS NOT NULL THEN
    SELECT string_agg((je->>'code') || '|' || COALESCE(je->>'size','') || '|' ||
                      (je->>'unit_price') || '|' || (je->>'qty'), ';'
             ORDER BY (je->>'code'), COALESCE(je->>'size',''))
      INTO canon FROM jsonb_array_elements(priced) je;
    IF md5(COALESCE(canon,'') || '#' || subtotal) <> p_quote_token THEN
      RAISE EXCEPTION 'price_changed' USING DETAIL = 'total=' || (subtotal + shipping);
    END IF;
  END IF;

  -- Guest token (needed as the coupon-usage scope for guests) — no side effects.
  IF p_actor IS NULL THEN
    v_guest_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_guest_hash  := encode(extensions.digest(v_guest_token, 'sha256'), 'hex');
  END IF;
  v_usage_scope := COALESCE(p_actor::text, v_guest_hash);

  -- ── Coupon: lock the row, validate authoritatively, compute discount ────────
  IF v_code IS NOT NULL THEN
    SELECT * INTO v_coupon FROM public.coupons WHERE code = v_code FOR UPDATE;
    IF v_coupon.code IS NULL THEN
      RAISE EXCEPTION 'invalid_coupon' USING DETAIL = v_code;
    END IF;
    IF p_actor IS NOT NULL THEN
      SELECT count(*) INTO v_used_user
        FROM public.coupon_usages WHERE coupon_code = v_code AND scope = p_actor::text;
      SELECT EXISTS(SELECT 1 FROM public.orders WHERE user_id = p_actor) INTO v_had_prior;
    END IF;
    v_reason := private.coupon_reason(v_coupon, subtotal, p_actor, v_used_user, v_had_prior);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION '%', v_reason USING DETAIL = 'coupon ' || v_code;
    END IF;
    v_amt          := private.coupon_amount(v_coupon, subtotal, shipping);
    v_discount     := (v_amt->>'discount')::int;
    v_ship_final   := (v_amt->>'shipping_fee')::int;
    v_coupon_amount := (v_amt->>'amount')::int;
  END IF;

  total := subtotal - v_discount + v_ship_final;

  -- Operator-configurable payment/reservation hold window (default 24h).
  SELECT order_hold_hours INTO v_hold FROM public.site_settings WHERE id = 1;
  v_expires := now() + make_interval(hours => COALESCE(v_hold, 24));

  v_order_no := 'NGR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0');
  v_status := CASE WHEN p_payment_method = 'cod' THEN 'pending_confirmation' ELSE 'pending_payment' END;

  INSERT INTO public.orders (order_no, user_id, guest_token_hash, customer_name, customer_phone,
    customer_email, ship_district, ship_zone, ship_address, ship_area,
    subtotal, discount, shipping_fee, total, payment_method, status, coupon_code,
    idempotency_key, reservation_expires_at)
  VALUES (v_order_no, p_actor, v_guest_hash,
    p_customer->>'name', p_customer->>'phone', NULLIF(p_customer->>'email',''),
    p_customer->>'district', p_zone, p_customer->>'address', NULLIF(p_customer->>'area',''),
    subtotal, v_discount, v_ship_final, total, p_payment_method, v_status, v_code,
    p_idempotency_key, v_expires)
  RETURNING id INTO v_order_id;

  -- priced preserves p_lines order 1:1, so v_idx maps each priced line back to
  -- its input line to recover the optional per-line `measures` (fulfilment only).
  v_idx := 0;
  FOR e IN SELECT value FROM jsonb_array_elements(priced) AS value LOOP
    v_measures := p_lines -> v_idx -> 'measures';
    IF v_measures IS NULL OR jsonb_typeof(v_measures) <> 'object' OR v_measures = '{}'::jsonb THEN
      v_measures := NULL;
    END IF;
    INSERT INTO public.order_items (order_id, product_id, variant_size, name, image, unit_price, qty, line_total, custom_measurements)
    VALUES (v_order_id, (e->>'product_id')::uuid, NULLIF(e->>'size',''), e->>'name', e->>'image',
      (e->>'unit_price')::int, (e->>'qty')::int, (e->>'line_total')::int, v_measures);
    -- Made-to-order (custom) lines do not hold ready-size stock.
    IF NOT COALESCE((e->>'custom')::bool, false) THEN
      INSERT INTO public.inventory_reservations (order_id, product_id, variant_size, qty, status, expires_at)
      VALUES (v_order_id, (e->>'product_id')::uuid, NULLIF(e->>'size',''), (e->>'qty')::int, 'active',
        v_expires);
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  -- Consume the coupon under the row lock still held: one usage row per order +
  -- bump the maintained global counter. Both are race-safe on the coupon lock.
  IF v_code IS NOT NULL THEN
    INSERT INTO public.coupon_usages (coupon_code, order_id, scope, amount)
    VALUES (v_code, v_order_id, v_usage_scope, v_coupon_amount);
    UPDATE public.coupons SET usage_count = usage_count + 1 WHERE code = v_code;
  END IF;

  INSERT INTO public.payments (order_id, method, amount, status)
  VALUES (v_order_id, p_payment_method, total, 'pending');
  INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
  VALUES (v_order_id, NULL, v_status, p_actor, 'placed');
  UPDATE public.idempotency_keys SET order_id = v_order_id WHERE key = p_idempotency_key;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'order.placed', 'order', v_order_id::text,
    jsonb_build_object('order_no', v_order_no, 'total', total,
      'method', p_payment_method, 'guest', p_actor IS NULL,
      'coupon', v_code, 'discount', v_discount));

  RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'status', v_status,
    'subtotal', subtotal, 'discount', v_discount, 'shipping_fee', v_ship_final, 'total', total,
    'coupon', v_code, 'guest_token', v_guest_token, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text, text) TO service_role;
