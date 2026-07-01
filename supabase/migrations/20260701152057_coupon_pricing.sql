-- Stage 3 Pass 5b — real coupons in the pricing RPCs.
--
-- Replaces the hardcoded discount = 0 in quote_order/place_order with real,
-- race-safe coupon validation + discount math against the P5a coupons tables.
-- Design: docs/stage-3-design.md (v2) §4.5. Canonical order of operations:
--   subtotal → coupon discount → shipping on PRE-discount subtotal (pinned rule)
--   → total = subtotal − discount + shipping_fee.
--
-- Validation + math are centralised in two private helpers so quote (display,
-- read-only) and place (authoritative, under the coupon row lock) can NEVER
-- diverge on the rules — the same guarantee price_lines gives for line pricing.
--
-- Race-safety: place_order takes SELECT ... FOR UPDATE on the coupon row before
-- counting usages, so all redemptions of a coupon serialise on that row — the
-- global usage_limit (maintained usage_count) and per_user_limit hold under
-- concurrency without a blocking unique index (§P5a header). Guest per-user
-- limits are inherently unenforceable (a fresh guest token per order = a new
-- scope), so they only bind signed-in customers; first_order_only requires a
-- signed-in actor for the same reason (a guest's history can't be verified).
--
-- Signatures gain optional params (p_coupon_code, and p_actor on quote) with
-- defaults, so pre-P5c app calls that omit them keep working (no coupon). The
-- old overloads are dropped first to avoid PostgREST named-arg ambiguity.
-- quote_token is unchanged — it fingerprints line prices + pre-coupon subtotal,
-- so swapping a coupon between quote and place never trips price_changed; place
-- re-validates the coupon authoritatively regardless.
--
-- Stable error codes (place_order): invalid_coupon, coupon_min_not_met,
-- coupon_exhausted, coupon_not_eligible. quote_order never raises on a bad
-- coupon — it returns { applied:false, reason } so the cart stays quotable.

-- ── Eligibility → reason code (NULL = eligible). Shared by quote + place. ──────
-- Takes the coupon row + the usage counts the caller read (unlocked in quote,
-- locked in place) so the rule set is identical on both paths.
CREATE OR REPLACE FUNCTION private.coupon_reason(
  c public.coupons, p_subtotal integer, p_actor uuid,
  p_used_user integer, p_had_prior_order boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  -- Not found / inactive / outside window → one opaque reason (do not leak
  -- "expired" vs "unknown", per §4).
  IF c.code IS NULL OR NOT c.active THEN RETURN 'invalid_coupon'; END IF;
  IF c.starts_at IS NOT NULL AND now() <  c.starts_at THEN RETURN 'invalid_coupon'; END IF;
  IF c.ends_at   IS NOT NULL AND now() >= c.ends_at   THEN RETURN 'invalid_coupon'; END IF;

  IF p_subtotal < c.min_subtotal THEN RETURN 'coupon_min_not_met'; END IF;

  IF c.usage_limit IS NOT NULL AND c.usage_count >= c.usage_limit THEN
    RETURN 'coupon_exhausted'; END IF;
  IF c.per_user_limit IS NOT NULL AND p_used_user >= c.per_user_limit THEN
    RETURN 'coupon_exhausted'; END IF;

  -- first_order_only: only signed-in customers with no prior order qualify.
  IF c.first_order_only AND (p_actor IS NULL OR p_had_prior_order) THEN
    RETURN 'coupon_not_eligible'; END IF;

  RETURN NULL;
END;
$$;

-- ── Discount math (pure). Returns final discount, final shipping, saved amount. ─
-- percent/fixed reduce the subtotal (capped at subtotal and max_discount);
-- free_shipping waives the shipping fee and reports the waived amount.
CREATE OR REPLACE FUNCTION private.coupon_amount(
  c public.coupons, p_subtotal integer, p_shipping integer
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE d integer; sh integer := p_shipping; amt integer;
BEGIN
  IF c.type = 'percent' THEN
    -- integer round-half-up (round() on numeric rounds half away from zero).
    d := round((p_subtotal::numeric * c.value) / 100.0)::integer;
    IF c.max_discount IS NOT NULL THEN d := LEAST(d, c.max_discount); END IF;
    d := LEAST(d, p_subtotal);
    amt := d;
  ELSIF c.type = 'fixed' THEN
    d := c.value;
    IF c.max_discount IS NOT NULL THEN d := LEAST(d, c.max_discount); END IF;
    d := LEAST(d, p_subtotal);
    amt := d;
  ELSE  -- free_shipping
    d := 0;
    sh := 0;
    amt := p_shipping;  -- what was waived (may be 0 if already free)
  END IF;
  RETURN jsonb_build_object('discount', d, 'shipping_fee', sh, 'amount', amt);
END;
$$;

-- ── Public quote — now coupon-aware (display only; never raises on coupon) ─────
DROP FUNCTION IF EXISTS api.quote_order(jsonb, text);
CREATE OR REPLACE FUNCTION api.quote_order(
  p_lines jsonb, p_zone text, p_coupon_code text DEFAULT NULL, p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  priced jsonb; subtotal integer; shipping integer; canon text;
  v_code text; v_coupon public.coupons; v_reason text; v_amt jsonb;
  v_discount integer := 0; v_ship_final integer; v_coupon_out jsonb := NULL;
  v_used_user integer := 0; v_had_prior boolean := false;
BEGIN
  IF p_zone NOT IN ('dhaka','major','outside') THEN
    RAISE EXCEPTION 'invalid_address' USING DETAIL = 'unknown delivery zone';
  END IF;

  priced := private.price_lines(p_lines);

  SELECT COALESCE(SUM((e->>'line_total')::int), 0) INTO subtotal
    FROM jsonb_array_elements(priced) e WHERE (e->>'visible')::bool;

  shipping     := private.compute_shipping(p_zone, subtotal);
  v_ship_final := shipping;

  v_code := NULLIF(upper(btrim(COALESCE(p_coupon_code, ''))), '');
  IF v_code IS NOT NULL THEN
    SELECT * INTO v_coupon FROM public.coupons WHERE code = v_code;
    IF v_coupon.code IS NULL THEN
      v_reason := 'invalid_coupon';
    ELSE
      IF p_actor IS NOT NULL THEN
        SELECT count(*) INTO v_used_user
          FROM public.coupon_usages WHERE coupon_code = v_code AND scope = p_actor::text;
        SELECT EXISTS(SELECT 1 FROM public.orders WHERE user_id = p_actor) INTO v_had_prior;
      END IF;
      v_reason := private.coupon_reason(v_coupon, subtotal, p_actor, v_used_user, v_had_prior);
    END IF;

    IF v_reason IS NULL THEN
      v_amt        := private.coupon_amount(v_coupon, subtotal, shipping);
      v_discount   := (v_amt->>'discount')::int;
      v_ship_final := (v_amt->>'shipping_fee')::int;
      v_coupon_out := jsonb_build_object(
        'code', v_code, 'applied', true, 'type', v_coupon.type,
        'discount', v_discount, 'shipping_waived', shipping - v_ship_final,
        'amount', (v_amt->>'amount')::int, 'description', v_coupon.description);
    ELSE
      v_coupon_out := jsonb_build_object('code', v_code, 'applied', false, 'reason', v_reason);
    END IF;
  END IF;

  -- quote_token: line prices + PRE-coupon subtotal (coupon excluded by design).
  SELECT string_agg((e->>'code') || '|' || COALESCE(e->>'size','') || '|' ||
                    (e->>'unit_price') || '|' || (e->>'qty'), ';'
           ORDER BY (e->>'code'), COALESCE(e->>'size',''))
    INTO canon FROM jsonb_array_elements(priced) e WHERE (e->>'visible')::bool;

  RETURN jsonb_build_object(
    'lines', priced, 'subtotal', subtotal, 'discount', v_discount,
    'shipping_fee', v_ship_final, 'total', subtotal - v_discount + v_ship_final,
    'coupon', v_coupon_out,
    'quote_token', md5(COALESCE(canon,'') || '#' || subtotal), 'zone', p_zone);
END;
$$;

REVOKE ALL ON FUNCTION api.quote_order(jsonb, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.quote_order(jsonb, text, text, uuid) TO anon, authenticated, service_role;

-- ── Place order — coupon validated + consumed under the coupon row lock ───────
DROP FUNCTION IF EXISTS api.place_order(jsonb, jsonb, text, text, text, uuid, text);
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
  v_scope text; v_req_hash text; v_existing record;
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
      SELECT id, order_no, status INTO v_order_id, v_order_no, v_status
        FROM public.orders WHERE id = v_existing.order_id;
      RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no,
        'status', v_status, 'replayed', true);
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
