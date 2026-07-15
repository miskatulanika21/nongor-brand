-- Stage 7 (order-workflow #1 + #2) — client-held guest tracking token.
--
-- ── Why the previous replay design (20260713090000) was unsafe ───────────────
-- That version had the SERVER mint the guest tracking token and, on every
-- idempotent replay, ROTATE guest_token_hash to a brand-new value. That is
-- broken in several ways:
--   • Concurrent retries each mint a token but only the last stored hash wins,
--     so every earlier retry receives a token that no longer verifies.
--   • A later retry silently invalidates a tracking link the customer already
--     saved or shared.
--   • The replay branch never bound the stored idempotency scope to the current
--     actor.
--   • If an account deletion had de-associated an order to guest ownership, an
--     old idempotency key could regenerate guest access to it.
--
-- ── The correct model: the client owns the credential ────────────────────────
-- The raw guest token is now generated ON THE CLIENT, persisted there (keyed to
-- the placement attempt), and only its SHA-256 hash is ever sent to the server.
-- Consequences:
--   • The raw token NEVER leaves the browser and is NEVER stored in plaintext —
--     strictly stronger than before (the old design transmitted it in the
--     response). Hashing is unchanged (sha256 hex).
--   • Replays return the receipt with NO token and perform NO rotation, so a
--     saved/shared link stays valid forever and concurrent retries are safe. The
--     client still holds its own token, so a lost-response retry can still track.
--   • Replays are bound to the original scope (the authenticated user id, or the
--     shared literal 'guest' whose only guard is possession of the unguessable
--     idempotency key). A signed-in replay under a different user id is rejected.
--   • guest_token_hash is stored ONLY for genuine guest orders (p_actor IS NULL).
--     A signed-in order never carries one, so account deletion (which nulls
--     user_id) leaves nothing to regenerate — access revocation is preserved.
--
-- The signature gains a trailing p_guest_token_hash. We DROP the old 8-arg
-- function first so no ambiguous overload remains; grants are re-applied.

DROP FUNCTION IF EXISTS api.place_order(jsonb, jsonb, text, text, text, uuid, text, text);

CREATE FUNCTION api.place_order(
  p_lines jsonb, p_customer jsonb, p_zone text, p_payment_method text,
  p_idempotency_key text, p_actor uuid DEFAULT NULL, p_quote_token text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL, p_guest_token_hash text DEFAULT NULL
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
  v_guest_hash text; pidlist uuid[]; v_hold integer; v_expires timestamptz;
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

  -- Guest orders carry a client-generated token; a signed-in order never stores
  -- one (it is tracked through the account), so a hash sent by a signed-in client
  -- is dropped — a later account deletion then leaves nothing to regenerate. The
  -- REQUIREMENT that a guest actually supplied a well-formed hash is enforced just
  -- before the order is created (below), so a bad cart still reports its own error.
  v_guest_hash := CASE WHEN p_actor IS NULL THEN p_guest_token_hash ELSE NULL END;

  v_code := NULLIF(upper(btrim(COALESCE(p_coupon_code, ''))), '');
  v_scope := COALESCE(p_actor::text, 'guest');
  -- Coupon is part of the request identity: a replay with a different coupon is
  -- an idempotency_conflict, not a silent second pricing. The token hash is NOT
  -- part of identity — a legitimate retry reuses the same persisted token.
  v_req_hash := md5(p_lines::text || '#' || COALESCE(p_customer::text,'') || '#' ||
                    p_zone || '#' || p_payment_method || '#' || COALESCE(v_code,''));

  -- Race-safe idempotency: the unique key is the serialization point.
  INSERT INTO public.idempotency_keys (key, scope, request_hash)
  VALUES (p_idempotency_key, v_scope, v_req_hash)
  ON CONFLICT (key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_existing FROM public.idempotency_keys WHERE key = p_idempotency_key;
    -- Bind the replay to the original actor/scope: a signed-in retry must come
    -- from the same user. (Guests share the literal 'guest' scope; their only
    -- guard is possession of the unguessable key, which reaching here requires.)
    IF v_existing.scope <> v_scope THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    IF v_existing.request_hash <> v_req_hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    IF v_existing.order_id IS NOT NULL THEN
      -- Replay: return the FULL placement contract read back from the order.
      -- NO token is issued and NO hash is rotated — the client still holds the
      -- token it generated for the original attempt, so its tracking link (and
      -- any it already shared) keeps working. This is safe under concurrency.
      SELECT o.order_no, o.status, o.subtotal, o.discount, o.shipping_fee,
             o.total, o.coupon_code, o.user_id
        INTO v_order_no, v_status, subtotal, v_discount, v_ship_final,
             total, v_code, v_existing_user
        FROM public.orders o WHERE o.id = v_existing.order_id;
      v_order_id := v_existing.order_id;

      RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no,
        'status', v_status, 'subtotal', subtotal, 'discount', v_discount,
        'shipping_fee', v_ship_final, 'total', total, 'coupon', v_code,
        'guest_token', NULL, 'replayed', true);
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

  -- Guest coupon-usage scope is the client token hash (unique per attempt); a
  -- signed-in buyer scopes by user id. No server-side token generation happens.
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

  -- A guest placement MUST carry a well-formed client token hash (sha256 hex),
  -- else the order would be untrackable. Enforced here — after cart/pricing/coupon
  -- validation — so a bad cart or coupon surfaces its own error first.
  IF p_actor IS NULL AND (v_guest_hash IS NULL OR v_guest_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'guest_token_required';
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

  -- guest_token is intentionally NULL in the response: the client already holds
  -- the raw token it generated. The server never sees or returns it.
  RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'status', v_status,
    'subtotal', subtotal, 'discount', v_discount, 'shipping_fee', v_ship_final, 'total', total,
    'coupon', v_code, 'guest_token', NULL, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text, text, text) TO service_role;
