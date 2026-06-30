-- Stage 3 fix pass — custom-size server pricing (BUG-02) + configurable hold (GAP-07).
--
-- BUG-02: a custom (made-to-measure) line is sent with size = 'Custom'. The old
-- private.price_lines priced it at the base unit price (custom_size_charge was
-- ignored) AND ran it through ready-size availability — which returns 0 for the
-- 'Custom' pseudo-size, so EVERY custom order failed place_order with
-- out_of_stock. Fix: a 'Custom' line is priced at base + custom_size_charge and
-- treated as MADE-TO-ORDER — not bound by ready-size stock and never reserving a
-- ready unit. A 'Custom' line is only valid when products.custom_size = true.
--
-- GAP-07: place_order hardcoded a 24h reservation/hold window and ignored the
-- operator-configurable site_settings.order_hold_hours. Now it reads it.
--
-- Both quote_order and place_order share private.price_lines, so the quote_token
-- (computed over unit_price) stays consistent across quote → place.

-- ── Price a cart from the DB (single source of truth for quote + place) ──────
CREATE OR REPLACE FUNCTION private.price_lines(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE out jsonb := '[]'::jsonb; el jsonb; prod record; v_size text; v_qty integer;
        v_avail integer; v_img text; v_custom boolean; v_unit integer;
BEGIN
  FOR el IN SELECT value FROM jsonb_array_elements(p_lines) AS value LOOP
    v_size   := NULLIF(el->>'size', '');
    v_qty    := COALESCE((el->>'qty')::int, 0);
    v_custom := (v_size = 'Custom');

    SELECT p.id, p.name, p.code,
           COALESCE(p.sale_price, p.price) AS unit_price,
           p.custom_size,
           COALESCE(p.custom_size_charge, 0) AS custom_charge,
           (p.status = 'active' AND EXISTS (
              SELECT 1 FROM public.product_categories c
              WHERE c.id = p.category_id AND c.is_active)) AS visible
      INTO prod
      FROM public.products p WHERE p.code = el->>'code';

    IF prod.id IS NULL THEN
      out := out || jsonb_build_object('code', el->>'code', 'size', v_size,
        'qty', v_qty, 'found', false, 'visible', false, 'custom', v_custom);
      CONTINUE;
    END IF;

    -- A 'Custom' (made-to-measure) line is only valid for a custom_size product.
    -- Mark not-visible so place_order rejects it as product_not_purchasable.
    IF v_custom AND NOT prod.custom_size THEN
      out := out || jsonb_build_object(
        'product_id', prod.id, 'code', prod.code, 'name', prod.name,
        'size', v_size, 'qty', v_qty, 'found', true, 'visible', false,
        'custom', true);
      CONTINUE;
    END IF;

    -- Custom lines: base + tailoring charge, made-to-order (not stock-bound).
    v_unit := prod.unit_price + CASE WHEN v_custom THEN prod.custom_charge ELSE 0 END;
    IF v_custom THEN
      v_avail := NULL;  -- made-to-order: unlimited, no ready-stock gate
    ELSE
      v_avail := private.available_qty(prod.id, v_size);
    END IF;

    SELECT url INTO v_img FROM public.product_media
      WHERE product_id = prod.id AND is_primary LIMIT 1;

    out := out || jsonb_build_object(
      'product_id', prod.id, 'code', prod.code, 'name', prod.name, 'image', v_img,
      'size', v_size, 'qty', v_qty, 'unit_price', v_unit,
      'line_total', v_unit * v_qty, 'available', v_avail,
      'visible', prod.visible, 'found', true, 'custom', v_custom);
  END LOOP;
  RETURN out;
END;
$$;

-- ── Place order (service-role only) — adds custom handling + configurable hold ─
CREATE OR REPLACE FUNCTION api.place_order(
  p_lines jsonb, p_customer jsonb, p_zone text, p_payment_method text,
  p_idempotency_key text, p_actor uuid DEFAULT NULL, p_quote_token text DEFAULT NULL
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

  v_scope := COALESCE(p_actor::text, 'guest');
  v_req_hash := md5(p_lines::text || '#' || COALESCE(p_customer::text,'') || '#' ||
                    p_zone || '#' || p_payment_method);

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
  shipping := private.compute_shipping(p_zone, subtotal);
  total := subtotal + shipping;

  -- Price-drift detection against the quote token (client total never trusted).
  IF p_quote_token IS NOT NULL THEN
    SELECT string_agg((je->>'code') || '|' || COALESCE(je->>'size','') || '|' ||
                      (je->>'unit_price') || '|' || (je->>'qty'), ';'
             ORDER BY (je->>'code'), COALESCE(je->>'size',''))
      INTO canon FROM jsonb_array_elements(priced) je;
    IF md5(COALESCE(canon,'') || '#' || subtotal) <> p_quote_token THEN
      RAISE EXCEPTION 'price_changed' USING DETAIL = 'total=' || total;
    END IF;
  END IF;

  -- Operator-configurable payment/reservation hold window (default 24h).
  SELECT order_hold_hours INTO v_hold FROM public.site_settings WHERE id = 1;
  v_expires := now() + make_interval(hours => COALESCE(v_hold, 24));

  v_order_no := 'NGR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0');
  v_status := CASE WHEN p_payment_method = 'cod' THEN 'pending_confirmation' ELSE 'pending_payment' END;
  IF p_actor IS NULL THEN
    -- pgcrypto lives in the `extensions` schema; qualify under search_path=''.
    v_guest_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_guest_hash  := encode(extensions.digest(v_guest_token, 'sha256'), 'hex');
  END IF;

  INSERT INTO public.orders (order_no, user_id, guest_token_hash, customer_name, customer_phone,
    customer_email, ship_district, ship_zone, ship_address, ship_area,
    subtotal, discount, shipping_fee, total, payment_method, status, idempotency_key, reservation_expires_at)
  VALUES (v_order_no, p_actor, v_guest_hash,
    p_customer->>'name', p_customer->>'phone', NULLIF(p_customer->>'email',''),
    p_customer->>'district', p_zone, p_customer->>'address', NULLIF(p_customer->>'area',''),
    subtotal, 0, shipping, total, p_payment_method, v_status, p_idempotency_key,
    v_expires)
  RETURNING id INTO v_order_id;

  FOR e IN SELECT value FROM jsonb_array_elements(priced) AS value LOOP
    INSERT INTO public.order_items (order_id, product_id, variant_size, name, image, unit_price, qty, line_total)
    VALUES (v_order_id, (e->>'product_id')::uuid, NULLIF(e->>'size',''), e->>'name', e->>'image',
      (e->>'unit_price')::int, (e->>'qty')::int, (e->>'line_total')::int);
    -- Made-to-order (custom) lines do not hold ready-size stock.
    IF NOT COALESCE((e->>'custom')::bool, false) THEN
      INSERT INTO public.inventory_reservations (order_id, product_id, variant_size, qty, status, expires_at)
      VALUES (v_order_id, (e->>'product_id')::uuid, NULLIF(e->>'size',''), (e->>'qty')::int, 'active',
        v_expires);
    END IF;
  END LOOP;

  INSERT INTO public.payments (order_id, method, amount, status)
  VALUES (v_order_id, p_payment_method, total, 'pending');
  INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
  VALUES (v_order_id, NULL, v_status, p_actor, 'placed');
  UPDATE public.idempotency_keys SET order_id = v_order_id WHERE key = p_idempotency_key;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'order.placed', 'order', v_order_id::text,
    jsonb_build_object('order_no', v_order_no, 'total', total,
      'method', p_payment_method, 'guest', p_actor IS NULL));

  RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'status', v_status,
    'subtotal', subtotal, 'shipping_fee', shipping, 'total', total,
    'guest_token', v_guest_token, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text) TO service_role;
