-- Stage 5 Pass 1 — Courier integration: order status additions + shipment schema.
--
-- Adds two new order statuses (courier_booked, delivery_failed), creates the
-- courier/shipment tables, and all RPCs for shipment lifecycle management.
--
-- Design invariant: orders carry BUSINESS statuses; shipments carry COURIER
-- granularity. They sync at significant events only:
--   shipment picked_up  → order shipped
--   shipment delivered   → order delivered
--   shipment failed      → order delivery_failed
--
-- All new tables are RPC-only (deny-all RLS). All functions are SECURITY
-- DEFINER, service-role only, with canonical audit rows.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Extend the order status CHECK to include courier_booked + delivery_failed
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS "orders_status_check1";

-- Find and drop the unnamed CHECK on the status column
DO $$
DECLARE
  _con_name text;
BEGIN
  SELECT conname INTO _con_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
   WHERE c.conrelid = 'public.orders'::regclass
     AND c.contype = 'c'
     AND a.attname = 'status'
   LIMIT 1;
  IF _con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', _con_name);
  END IF;
END;
$$;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending_payment','payment_submitted','payment_rejected',
  'pending_confirmation','confirmed','processing','ready_to_ship',
  'courier_booked',   -- NEW: courier consignment created, awaiting pickup
  'shipped','delivered','completed',
  'delivery_failed',  -- NEW: courier could not deliver
  'cancelled','expired','returned','refund_pending','refund_done'
));

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Update the transition RPC to include the two new statuses
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.transition_order(
  p_order_id         uuid,
  p_to_status        text,
  p_actor            uuid,
  p_reason           text    DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_restock          boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_from  text;
  v_allowed text[];
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles
     WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  v_from := v_order.status;

  IF v_from = p_to_status THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', v_order.status, 'version', v_order.version, 'noop', true);
  END IF;

  v_allowed := CASE v_from
    WHEN 'pending_payment'      THEN ARRAY['payment_submitted','cancelled','expired']
    WHEN 'payment_submitted'    THEN ARRAY['confirmed','payment_rejected','cancelled','expired']
    WHEN 'payment_rejected'     THEN ARRAY['payment_submitted','cancelled','expired']
    WHEN 'pending_confirmation' THEN ARRAY['confirmed','cancelled','expired']
    WHEN 'confirmed'            THEN ARRAY['processing','cancelled']
    WHEN 'processing'           THEN ARRAY['ready_to_ship','cancelled']
    WHEN 'ready_to_ship'        THEN ARRAY['courier_booked','shipped','cancelled']
    WHEN 'courier_booked'       THEN ARRAY['shipped','cancelled']
    WHEN 'shipped'              THEN ARRAY['delivered','delivery_failed']
    WHEN 'delivered'            THEN ARRAY['completed','returned']
    WHEN 'completed'            THEN ARRAY['returned']
    WHEN 'delivery_failed'      THEN ARRAY['shipped','returned']
    WHEN 'returned'             THEN ARRAY['refund_pending']
    WHEN 'refund_pending'       THEN ARRAY['refund_done']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_transition'
      USING DETAIL = v_from || ' -> ' || p_to_status;
  END IF;

  IF p_expected_version IS NOT NULL AND v_order.version <> p_expected_version THEN
    RAISE EXCEPTION 'version_conflict'
      USING DETAIL = 'expected=' || p_expected_version || ' actual=' || v_order.version;
  END IF;

  IF p_to_status = 'confirmed' THEN
    PERFORM private.consume_reservations(p_order_id, p_actor);
    UPDATE public.orders SET confirmed_at = now() WHERE id = p_order_id;
  END IF;

  IF p_to_status IN ('cancelled', 'expired') THEN
    PERFORM private.release_reservations(p_order_id);
  END IF;

  -- Rejected payment is retryable: keep the hold but refresh its window so the
  -- customer can resubmit and the reserved stock isn't lazily freed mid-retry.
  IF p_to_status = 'payment_rejected' THEN
    DECLARE v_new_expiry timestamptz;
    BEGIN
      SELECT now() + make_interval(hours => COALESCE(order_hold_hours, 24))
        INTO v_new_expiry FROM public.site_settings WHERE id = 1;
      UPDATE public.orders SET reservation_expires_at = v_new_expiry WHERE id = p_order_id;
      UPDATE public.inventory_reservations SET expires_at = v_new_expiry
        WHERE order_id = p_order_id AND status = 'active';
    END;
  END IF;

  IF p_to_status = 'returned' AND p_restock THEN
    DECLARE r record; v_code text; v_current integer;
    BEGIN
      FOR r IN
        SELECT oi.product_id, oi.variant_size, oi.qty
          FROM public.order_items oi WHERE oi.order_id = p_order_id
      LOOP
        -- Made-to-order ('Custom') lines never consumed ready stock → never restock.
        CONTINUE WHEN r.variant_size = 'Custom';
        SELECT code INTO v_code FROM public.products WHERE id = r.product_id;
        IF r.variant_size IS NOT NULL THEN
          SELECT quantity INTO v_current FROM public.product_size_stock
           WHERE product_id = r.product_id AND size = r.variant_size;
        ELSE
          SELECT stock INTO v_current FROM public.products WHERE id = r.product_id;
        END IF;
        v_current := COALESCE(v_current, 0);
        PERFORM api.set_inventory(
          p_code     := v_code,
          p_size     := r.variant_size,
          p_quantity := v_current + r.qty,
          p_reason   := 'return',
          p_actor_id := p_actor
        );
      END LOOP;
    END;
  END IF;

  UPDATE public.orders
     SET status     = p_to_status,
         version    = version + 1,
         updated_at = now()
   WHERE id = p_order_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
  VALUES (p_order_id, v_from, p_to_status, p_actor, p_reason);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'order.transition', 'order', p_order_id::text,
    jsonb_build_object('from', v_from, 'to', p_to_status,
      'order_no', v_order.order_no, 'restock', p_restock));

  RETURN jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'status', p_to_status, 'version', v_order.version + 1, 'noop', false);
END;
$$;

-- Grants unchanged (already service_role only from the original migration).

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Update admin_order_stats to count courier_booked in courier_pending
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.admin_order_stats(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'total_orders', count(*),
    'today_orders', count(*) FILTER (
      WHERE (placed_at AT TIME ZONE 'Asia/Dhaka')::date
          = (now()      AT TIME ZONE 'Asia/Dhaka')::date),
    'pending_payments', count(*) FILTER (WHERE status = 'payment_submitted'),
    'pending_confirmation', count(*) FILTER (WHERE status = 'pending_confirmation'),
    'courier_pending', count(*) FILTER (WHERE status IN ('confirmed','processing','ready_to_ship','courier_booked')),
    'delivered_revenue', COALESCE(sum(total) FILTER (WHERE status IN ('delivered','completed')), 0),
    'custom_pending', (
      SELECT count(DISTINCT oi.order_id)
        FROM public.order_items oi
        JOIN public.orders o2 ON o2.id = oi.order_id
       WHERE oi.custom_measurements IS NOT NULL
         AND o2.status NOT IN ('delivered','completed','cancelled','expired','returned','refund_pending','refund_done'))
  ) INTO v FROM public.orders;
  RETURN v;
END; $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. courier_providers — registry of enabled courier partners (NO secrets)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.courier_providers (
  id                    text PRIMARY KEY,
  display_name          text NOT NULL,
  enabled               boolean NOT NULL DEFAULT true,
  tracking_url_template text,
  default_weight_kg     numeric(4,2) NOT NULL DEFAULT 0.5,
  default_service_type  text,
  sandbox_enabled       boolean NOT NULL DEFAULT false,
  config                jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.courier_providers IS
  'Courier partner registry. config JSONB is NON-SECRET only (store_id, display prefs). All API secrets stay in env vars.';

ALTER TABLE public.courier_providers ENABLE ROW LEVEL SECURITY;
-- deny-all: NO policies. Only service-role RPCs read/write.

INSERT INTO public.courier_providers (id, display_name, tracking_url_template, default_service_type)
VALUES
  ('steadfast', 'SteadFast', 'https://steadfast.com.bd/t/{code}', 'normal'),
  ('pathao',    'Pathao',    'https://merchant.pathao.com/tracking?consignment_id={code}', '48'),
  ('manual',    'Manual',    NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. shipments — one row per courier booking attempt
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shipments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid        NOT NULL REFERENCES public.orders(id),
  provider                text        NOT NULL REFERENCES public.courier_providers(id),
  shipment_kind           text        NOT NULL DEFAULT 'forward'
                          CHECK (shipment_kind IN ('forward','return','exchange')),

  -- 3-phase booking lifecycle
  booking_status          text        NOT NULL DEFAULT 'pending'
                          CHECK (booking_status IN ('pending','success','failed')),
  booking_request_hash    text,
  booking_error           text,
  attempt_no              integer     NOT NULL DEFAULT 1,
  pending_expires_at      timestamptz DEFAULT (now() + interval '10 minutes'),

  -- Courier response
  consignment_id          text,
  tracking_code           text,
  courier_status          text,

  -- COD & reconciliation
  payment_collection_mode text        NOT NULL DEFAULT 'prepaid'
                          CHECK (payment_collection_mode IN ('prepaid','cod','partial_cod')),
  cod_amount              numeric(12,2) NOT NULL DEFAULT 0,
  courier_fee             numeric(12,2),
  return_fee              numeric(12,2),
  cod_collected_at        timestamptz,
  cod_settled_at          timestamptz,
  settlement_reference    text,
  net_receivable          numeric(12,2),

  -- Lifecycle timestamps
  created_by              uuid        REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  booked_at               timestamptz,     -- NULL until booking success
  updated_at              timestamptz NOT NULL DEFAULT now(),
  cancelled_at            timestamptz,

  -- Return/exchange linkage (exchange is RESERVED; no UI/API until exchange flow exists)
  parent_shipment_id      uuid        REFERENCES public.shipments(id),
  return_reason           text,
  exchange_order_id       uuid        REFERENCES public.orders(id)
);
COMMENT ON TABLE public.shipments IS
  'One row per courier booking attempt. booking_status tracks the 3-phase lifecycle: pending → success/failed. booked_at is set only on success.';

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- Double-booking guard: only ONE active forward shipment per order.
-- 'failed' and 'cancelled' shipments don't block retries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_forward_shipment
  ON public.shipments (order_id)
  WHERE shipment_kind = 'forward'
    AND cancelled_at IS NULL
    AND booking_status != 'failed';

CREATE INDEX IF NOT EXISTS idx_shipments_order       ON public.shipments (order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_consignment ON public.shipments (consignment_id)
  WHERE consignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_stale        ON public.shipments (pending_expires_at)
  WHERE booking_status = 'pending';

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. shipment_events — append-only courier status log
-- ══════════════════════════════════════════════════════════════════════════════
-- raw_payload stores response body only — NEVER request auth headers.
-- Admin-only; customer DTOs never include it.

CREATE TABLE IF NOT EXISTS public.shipment_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id  uuid        NOT NULL REFERENCES public.shipments(id),
  status       text        NOT NULL,
  raw_payload  jsonb,
  source       text        NOT NULL CHECK (source IN ('webhook','poll','manual','booking')),
  received_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON public.shipment_events (shipment_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. webhook_events — raw payload log with idempotency
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     text        NOT NULL,
  event_id     text        NOT NULL,
  payload      jsonb       NOT NULL,
  processed    boolean     NOT NULL DEFAULT false,
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. notification_events — outbox for customer notifications (Stage 5 writes,
--    future notification sender consumes)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notification_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     uuid        NOT NULL REFERENCES public.orders(id),
  event_type   text        NOT NULL CHECK (event_type IN (
    'shipment_booked','shipment_picked_up','shipment_in_transit',
    'shipment_delivered','shipment_failed','shipment_returned'
  )),
  channel      text,
  sent_at      timestamptz,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notification_events_order  ON public.notification_events (order_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_unsent ON public.notification_events (sent_at)
  WHERE sent_at IS NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. RPC: create_shipment_attempt
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.create_shipment_attempt(
  p_actor           uuid,
  p_order_id        uuid,
  p_provider        text,
  p_collection_mode text,
  p_cod_amount      numeric,
  p_request_hash    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order   record;
  v_ship_id uuid;
  v_attempt integer;
BEGIN
  -- Actor must be active staff
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  -- Provider must exist and be enabled
  IF NOT EXISTS (SELECT 1 FROM public.courier_providers WHERE id = p_provider AND enabled) THEN
    RAISE EXCEPTION 'invalid_provider';
  END IF;

  -- Order must be in a bookable status
  SELECT id, status, order_no INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF v_order.status NOT IN ('ready_to_ship', 'delivery_failed') THEN
    RAISE EXCEPTION 'invalid_transition'
      USING DETAIL = 'Cannot book courier for order in status: ' || v_order.status;
  END IF;

  -- Count previous attempts for this order+provider
  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_attempt
    FROM public.shipments
   WHERE order_id = p_order_id AND provider = p_provider;

  -- Insert pending attempt. The unique index uq_active_forward_shipment will
  -- reject this if there's already an active forward shipment (pending or success).
  INSERT INTO public.shipments (
    order_id, provider, shipment_kind,
    booking_status, booking_request_hash, attempt_no,
    payment_collection_mode, cod_amount,
    created_by
  ) VALUES (
    p_order_id, p_provider, 'forward',
    'pending', p_request_hash, v_attempt,
    p_collection_mode, p_cod_amount,
    p_actor
  )
  RETURNING id INTO v_ship_id;

  RETURN jsonb_build_object('shipment_id', v_ship_id, 'attempt_no', v_attempt);
END;
$$;

REVOKE ALL ON FUNCTION api.create_shipment_attempt(uuid, uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.create_shipment_attempt(uuid, uuid, text, text, numeric, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. RPC: mark_shipment_booking_success
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.mark_shipment_booking_success(
  p_shipment_id    uuid,
  p_consignment_id text,
  p_tracking_code  text,
  p_raw_response   jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship   record;
  v_order  record;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;
  IF v_ship.booking_status != 'pending' THEN
    RAISE EXCEPTION 'invalid_booking_state'
      USING DETAIL = 'Expected pending, got ' || v_ship.booking_status;
  END IF;

  -- Update shipment to success
  UPDATE public.shipments SET
    booking_status   = 'success',
    consignment_id   = p_consignment_id,
    tracking_code    = p_tracking_code,
    courier_status   = 'booked',
    booked_at        = now(),
    updated_at       = now()
  WHERE id = p_shipment_id;

  -- Record initial booking event
  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, 'booked', p_raw_response, 'booking');

  -- Transition order to courier_booked (only if ready_to_ship or delivery_failed)
  SELECT * INTO v_order FROM public.orders WHERE id = v_ship.order_id FOR UPDATE;
  IF v_order.status IN ('ready_to_ship', 'delivery_failed') THEN
    UPDATE public.orders SET
      status     = 'courier_booked',
      version    = version + 1,
      updated_at = now()
    WHERE id = v_ship.order_id;

    INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    VALUES (v_ship.order_id, v_order.status, 'courier_booked', v_ship.created_by,
      'Courier booked via ' || v_ship.provider);
  END IF;

  -- Audit
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (v_ship.created_by, 'shipment.booked', 'shipment', p_shipment_id::text,
    jsonb_build_object(
      'order_id', v_ship.order_id,
      'provider', v_ship.provider,
      'consignment_id', p_consignment_id,
      'tracking_code', p_tracking_code,
      'cod_amount', v_ship.cod_amount));

  -- Notification outbox
  INSERT INTO public.notification_events (order_id, event_type, metadata)
  VALUES (v_ship.order_id, 'shipment_booked', jsonb_build_object(
    'provider', v_ship.provider,
    'tracking_code', p_tracking_code,
    'consignment_id', p_consignment_id));
END;
$$;

REVOKE ALL ON FUNCTION api.mark_shipment_booking_success(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.mark_shipment_booking_success(uuid, text, text, jsonb) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. RPC: fail_shipment_booking
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.fail_shipment_booking(
  p_shipment_id uuid,
  p_error       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.shipments SET
    booking_status = 'failed',
    booking_error  = p_error,
    updated_at     = now()
  WHERE id = p_shipment_id AND booking_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_not_found'
      USING DETAIL = 'Shipment not found or not in pending state';
  END IF;

  -- Record failure event
  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, 'booking_failed', jsonb_build_object('error', p_error), 'booking');
END;
$$;

REVOKE ALL ON FUNCTION api.fail_shipment_booking(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.fail_shipment_booking(uuid, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 12. RPC: resolve_stale_attempt — admin recovery for stuck pending bookings
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.resolve_stale_attempt(
  p_actor       uuid,
  p_shipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;
  IF v_ship.booking_status != 'pending' THEN
    RAISE EXCEPTION 'invalid_booking_state'
      USING DETAIL = 'Not in pending state';
  END IF;
  IF v_ship.pending_expires_at > now() THEN
    RAISE EXCEPTION 'booking_not_stale'
      USING DETAIL = 'Attempt has not expired yet; expires at ' || v_ship.pending_expires_at;
  END IF;

  UPDATE public.shipments SET
    booking_status = 'failed',
    booking_error  = 'Resolved as stale by admin',
    updated_at     = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, 'stale_resolved', jsonb_build_object('resolved_by', p_actor), 'manual');
END;
$$;

REVOKE ALL ON FUNCTION api.resolve_stale_attempt(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.resolve_stale_attempt(uuid, uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 13. RPC: update_shipment_status — webhook/poll status updates
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.update_shipment_status(
  p_shipment_id uuid,
  p_status      text,
  p_raw_payload jsonb DEFAULT NULL,
  p_source      text  DEFAULT 'webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship       record;
  v_order      record;
  v_new_order_status text := NULL;
  v_notif_type text := NULL;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  -- Append event (always, even if order doesn't transition)
  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, p_status, p_raw_payload, p_source);

  -- Update shipment courier_status
  UPDATE public.shipments SET
    courier_status = p_status,
    updated_at     = now()
  WHERE id = p_shipment_id;

  -- Map significant courier statuses to order transitions
  v_new_order_status := CASE p_status
    WHEN 'picked_up'            THEN 'shipped'
    WHEN 'delivered'            THEN 'delivered'
    WHEN 'failed'               THEN 'delivery_failed'
    WHEN 'returned_to_merchant' THEN NULL  -- admin decides
    ELSE NULL
  END;

  v_notif_type := CASE p_status
    WHEN 'picked_up'            THEN 'shipment_picked_up'
    WHEN 'in_transit'           THEN 'shipment_in_transit'
    WHEN 'delivered'            THEN 'shipment_delivered'
    WHEN 'failed'               THEN 'shipment_failed'
    WHEN 'returned_to_merchant' THEN 'shipment_returned'
    ELSE NULL
  END;

  -- Conditionally transition the order
  IF v_new_order_status IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_ship.order_id FOR UPDATE;
    IF v_order IS NOT NULL THEN
      -- Only transition if the order is in a state that allows it
      DECLARE v_allowed text[];
      BEGIN
        v_allowed := CASE v_order.status
          WHEN 'courier_booked'  THEN ARRAY['shipped','cancelled']
          WHEN 'shipped'         THEN ARRAY['delivered','delivery_failed']
          ELSE ARRAY[]::text[]
        END;
        IF v_new_order_status = ANY(v_allowed) THEN
          UPDATE public.orders SET
            status     = v_new_order_status,
            version    = version + 1,
            updated_at = now()
          WHERE id = v_ship.order_id;

          INSERT INTO public.order_status_history (order_id, from_status, to_status, actor_id, reason)
          VALUES (v_ship.order_id, v_order.status, v_new_order_status, NULL,
            'Courier status: ' || p_status || ' (via ' || p_source || ')');
        END IF;
      END;
    END IF;
  END IF;

  -- Notification outbox
  IF v_notif_type IS NOT NULL THEN
    INSERT INTO public.notification_events (order_id, event_type, metadata)
    VALUES (v_ship.order_id, v_notif_type, jsonb_build_object(
      'provider', v_ship.provider,
      'courier_status', p_status,
      'tracking_code', v_ship.tracking_code));
  END IF;

  RETURN jsonb_build_object(
    'shipment_id', p_shipment_id,
    'courier_status', p_status,
    'order_transitioned', v_new_order_status IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION api.update_shipment_status(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.update_shipment_status(uuid, text, jsonb, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 14. RPC: cancel_shipment
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.cancel_shipment(
  p_actor       uuid,
  p_shipment_id uuid,
  p_reason      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;
  IF v_ship.cancelled_at IS NOT NULL THEN
    RETURN; -- already cancelled, idempotent
  END IF;

  UPDATE public.shipments SET
    cancelled_at = now(),
    updated_at   = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.shipment_events (shipment_id, status, raw_payload, source)
  VALUES (p_shipment_id, 'cancelled', jsonb_build_object('reason', p_reason, 'actor', p_actor), 'manual');

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'shipment.cancelled', 'shipment', p_shipment_id::text,
    jsonb_build_object('order_id', v_ship.order_id, 'provider', v_ship.provider, 'reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION api.cancel_shipment(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.cancel_shipment(uuid, uuid, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 15. RPC: list_shipments — returns shipments + events for an order
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_shipments(
  p_actor    uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(s) ORDER BY s.created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      sh.id, sh.order_id, sh.provider, sh.shipment_kind,
      sh.booking_status, sh.booking_error, sh.attempt_no,
      sh.pending_expires_at,
      sh.consignment_id, sh.tracking_code, sh.courier_status,
      sh.payment_collection_mode, sh.cod_amount,
      sh.courier_fee, sh.return_fee,
      sh.cod_collected_at, sh.cod_settled_at,
      sh.settlement_reference, sh.net_receivable,
      sh.created_by, sh.created_at, sh.booked_at,
      sh.updated_at, sh.cancelled_at,
      sh.parent_shipment_id, sh.return_reason,
      cp.display_name AS provider_name,
      cp.tracking_url_template,
      (
        SELECT COALESCE(jsonb_agg(row_to_jsonb(e) ORDER BY e.received_at), '[]'::jsonb)
        FROM public.shipment_events e WHERE e.shipment_id = sh.id
      ) AS events
    FROM public.shipments sh
    JOIN public.courier_providers cp ON cp.id = sh.provider
    WHERE sh.order_id = p_order_id
  ) s;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION api.list_shipments(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_shipments(uuid, uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 16. RPC: list_courier_providers
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_courier_providers(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'display_name', display_name,
      'enabled', enabled,
      'tracking_url_template', tracking_url_template,
      'default_weight_kg', default_weight_kg,
      'default_service_type', default_service_type,
      'sandbox_enabled', sandbox_enabled
    ) ORDER BY display_name), '[]'::jsonb)
    FROM public.courier_providers
    WHERE enabled = true
  );
END;
$$;

REVOKE ALL ON FUNCTION api.list_courier_providers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_courier_providers(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 17. RPC: record_webhook_event (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.record_webhook_event(
  p_provider text,
  p_event_id text,
  p_payload  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.webhook_events (provider, event_id, payload)
  VALUES (p_provider, p_event_id, p_payload)
  ON CONFLICT (provider, event_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('is_new', v_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION api.record_webhook_event(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.record_webhook_event(text, text, jsonb) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 18. RPC: update_shipment_reconciliation
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.update_shipment_reconciliation(
  p_actor              uuid,
  p_shipment_id        uuid,
  p_courier_fee        numeric DEFAULT NULL,
  p_return_fee         numeric DEFAULT NULL,
  p_cod_collected_at   timestamptz DEFAULT NULL,
  p_cod_settled_at     timestamptz DEFAULT NULL,
  p_settlement_ref     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ship record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF v_ship IS NULL THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  UPDATE public.shipments SET
    courier_fee          = COALESCE(p_courier_fee, courier_fee),
    return_fee           = COALESCE(p_return_fee, return_fee),
    cod_collected_at     = COALESCE(p_cod_collected_at, cod_collected_at),
    cod_settled_at       = COALESCE(p_cod_settled_at, cod_settled_at),
    settlement_reference = COALESCE(p_settlement_ref, settlement_reference),
    net_receivable       = cod_amount - COALESCE(p_courier_fee, courier_fee, 0) - COALESCE(p_return_fee, return_fee, 0),
    updated_at           = now()
  WHERE id = p_shipment_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'shipment.reconciled', 'shipment', p_shipment_id::text,
    jsonb_build_object(
      'order_id', v_ship.order_id,
      'courier_fee', p_courier_fee,
      'return_fee', p_return_fee,
      'cod_collected_at', p_cod_collected_at,
      'cod_settled_at', p_cod_settled_at,
      'settlement_ref', p_settlement_ref));
END;
$$;

REVOKE ALL ON FUNCTION api.update_shipment_reconciliation(uuid, uuid, numeric, numeric, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.update_shipment_reconciliation(uuid, uuid, numeric, numeric, timestamptz, timestamptz, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 19. Grant posture: revoke all direct table access from anon/authenticated
-- ══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON TABLE public.courier_providers     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.shipments             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.shipment_events       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.webhook_events        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_events   FROM PUBLIC, anon, authenticated;

-- service_role gets full access for RPC internals
GRANT ALL ON TABLE public.courier_providers     TO service_role;
GRANT ALL ON TABLE public.shipments             TO service_role;
GRANT ALL ON TABLE public.shipment_events       TO service_role;
GRANT ALL ON TABLE public.webhook_events        TO service_role;
GRANT ALL ON TABLE public.notification_events   TO service_role;
