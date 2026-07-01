-- Stage 3 Pass 4g — custom-order measurements server capture (fulfilment).
--
-- Made-to-measure ('Custom') lines record size='Custom' + the tailoring charge,
-- but the actual body measurements lived only in the buyer's localStorage — the
-- workshop could not see them. This closes that gap: place_order threads an
-- optional per-line `measures` object into order_items.custom_measurements, and
-- the read RPCs project it so admin + customer detail (and guest track, the only
-- channel a guest custom buyer has) can render the measurements table.
--
-- Measurements are FULFILMENT data, not pricing data: they are excluded from
-- private.price_lines and from the quote_token canon, so quote → place never
-- drifts on them. `measures` rides inside p_lines per line (no new RPC arg).

-- ── Column (nullable; shape-guarded) ─────────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS custom_measurements jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_custom_measurements_shape'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_custom_measurements_shape
      CHECK (custom_measurements IS NULL
             OR (jsonb_typeof(custom_measurements) = 'object'
                 AND custom_measurements <> '{}'::jsonb
                 AND pg_column_size(custom_measurements) <= 8192));
  END IF;
END $$;

-- ── Place order — thread per-line measures into order_items ───────────────────
-- Recreated from 20260630120000 (custom pricing + configurable hold); the ONLY
-- change is the order_items insert loop capturing custom_measurements.
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
  v_idx integer; v_measures jsonb;
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

-- ── Read RPCs project custom_measurements ─────────────────────────────────────
-- Admin detail (workshop visibility).
CREATE OR REPLACE FUNCTION api.get_order_detail(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'order', row_to_json(o.*),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'product_id', oi.product_id, 'variant_size', oi.variant_size, 'name', oi.name, 'image', oi.image, 'unit_price', oi.unit_price, 'qty', oi.qty, 'line_total', oi.line_total, 'custom_measurements', oi.custom_measurements) ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'payment', (SELECT row_to_json(p.*) FROM public.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1),
    'screenshots', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ps.id, 'storage_path', ps.storage_path, 'created_at', ps.created_at)), '[]'::jsonb) FROM public.payment_screenshots ps JOIN public.payments pay ON pay.id = ps.payment_id WHERE pay.order_id = o.id),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'actor_id', h.actor_id, 'reason', h.reason, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb) FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o WHERE o.id = p_order_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.get_order_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_order_detail(uuid, uuid) TO service_role;

-- Customer's own order (signed-in).
CREATE OR REPLACE FUNCTION api.get_my_order(p_order_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'subtotal', o.subtotal, 'discount', o.discount, 'shipping_fee', o.shipping_fee,
      'total', o.total, 'payment_method', o.payment_method, 'placed_at', o.placed_at,
      'ship_district', o.ship_district, 'ship_zone', o.ship_zone,
      'ship_address', o.ship_address, 'ship_area', o.ship_area),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', oi.name, 'image', oi.image, 'unit_price', oi.unit_price,
      'qty', oi.qty, 'line_total', oi.line_total, 'variant_size', oi.variant_size,
      'custom_measurements', oi.custom_measurements)
      ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'payment', (SELECT jsonb_build_object('method', p.method, 'status', p.status, 'trx_id', p.trx_id)
      FROM public.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'to_status', h.to_status, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb)
      FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o WHERE o.id = p_order_id AND o.user_id = p_actor;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.get_my_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_my_order(uuid, uuid) TO service_role;

-- Guest tracking (capability-gated by the 32-byte token) — the only channel a
-- guest custom buyer has to review the measurements they submitted.
CREATE OR REPLACE FUNCTION api.track_order(p_order_no text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'order_no', o.order_no, 'status', o.status, 'total', o.total,
      'payment_method', o.payment_method, 'placed_at', o.placed_at),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', oi.name, 'image', oi.image, 'qty', oi.qty,
      'unit_price', oi.unit_price, 'variant_size', oi.variant_size,
      'custom_measurements', oi.custom_measurements)
      ORDER BY oi.created_at), '[]'::jsonb) FROM public.order_items oi WHERE oi.order_id = o.id),
    'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'to_status', h.to_status, 'created_at', h.created_at) ORDER BY h.created_at), '[]'::jsonb)
      FROM public.order_status_history h WHERE h.order_id = o.id)
  ) INTO v_result FROM public.orders o
  WHERE o.order_no = p_order_no AND o.guest_token_hash IS NOT NULL AND o.guest_token_hash = p_token_hash;
  IF v_result IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION api.track_order(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.track_order(text, text) TO service_role;
