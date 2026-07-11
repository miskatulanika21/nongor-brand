-- Stage 5 polish (deferred P3 items from the review remediation).
--
--  A2 — enforce the stored booking request hash. create_shipment_attempt stored
--       p_request_hash but never read it, so the idempotency the app implied did
--       not exist; the only guard was the unique index (a raw `double_booking`).
--       Now a duplicate submit of the SAME intent (same hash, e.g. a double-click
--       within the app's one-minute hash bucket) gets the distinct, friendlier
--       `booking_in_progress`, while a genuinely different second attempt keeps
--       `double_booking`. The partial unique index remains the concurrency
--       backstop for two simultaneous inserts.
-- #12 — newsletter capture. The footer form was a localStorage demo; this adds a
--       real `newsletter_subscribers` table (RPC-only deny-all) + an idempotent
--       subscribe RPC (service-role; the app server fn adds CSRF + per-IP rate
--       limit). Consent management / unsubscribe flow lands with Stage 6 — this
--       records `consented_at` and reserves `unsubscribed_at` for it.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. create_shipment_attempt — request-hash aware duplicate detection (A2)
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
  v_order    record;
  v_existing record;
  v_ship_id  uuid;
  v_attempt  integer;
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF v_order.status NOT IN ('ready_to_ship', 'delivery_failed') THEN
    RAISE EXCEPTION 'invalid_transition'
      USING DETAIL = 'Cannot book courier for order in status: ' || v_order.status;
  END IF;

  -- Duplicate detection (A2): an active forward shipment already exists?
  --   same request hash + still pending → the SAME submit racing itself
  --     (double-click / retry) → booking_in_progress (do not start another).
  --   anything else → double_booking (a genuine second attempt).
  SELECT id, booking_request_hash, booking_status INTO v_existing
    FROM public.shipments
   WHERE order_id = p_order_id
     AND shipment_kind = 'forward'
     AND cancelled_at IS NULL
     AND booking_status != 'failed'
   LIMIT 1;
  IF FOUND THEN
    IF p_request_hash IS NOT NULL
       AND v_existing.booking_request_hash = p_request_hash
       AND v_existing.booking_status = 'pending' THEN
      RAISE EXCEPTION 'booking_in_progress';
    END IF;
    RAISE EXCEPTION 'double_booking';
  END IF;

  -- Count previous attempts for this order+provider
  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_attempt
    FROM public.shipments
   WHERE order_id = p_order_id AND provider = p_provider;

  -- Insert pending attempt. The unique index uq_active_forward_shipment remains
  -- the backstop for two INSERTs racing past the check above.
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

-- Grants unchanged (service_role only, from the Stage-5 schema migration).

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. newsletter_subscribers + subscribe RPC (#12)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL UNIQUE
                  CHECK (char_length(email) BETWEEN 3 AND 255 AND position('@' in email) > 1),
  whatsapp        text        CHECK (whatsapp IS NULL OR char_length(whatsapp) <= 20),
  consented_at    timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.newsletter_subscribers IS
  'Footer newsletter opt-ins. RPC-only (deny-all RLS). Consent management + unsubscribe flow are Stage 6; until then this only records opt-ins.';

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
-- deny-all: no policies. Only service-role RPCs read/write.

REVOKE ALL ON TABLE public.newsletter_subscribers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.newsletter_subscribers TO service_role;

CREATE OR REPLACE FUNCTION api.subscribe_newsletter(
  p_email    text,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Idempotent re-subscribe: refresh consent, clear a past unsubscribe, and
  -- keep an existing whatsapp when the new submit omits it.
  INSERT INTO public.newsletter_subscribers (email, whatsapp)
  VALUES (lower(btrim(p_email)), NULLIF(btrim(COALESCE(p_whatsapp, '')), ''))
  ON CONFLICT (email) DO UPDATE SET
    consented_at    = now(),
    unsubscribed_at = NULL,
    whatsapp        = COALESCE(EXCLUDED.whatsapp, public.newsletter_subscribers.whatsapp)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'invalid_subscription';
END;
$$;

REVOKE ALL ON FUNCTION api.subscribe_newsletter(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.subscribe_newsletter(text, text) TO service_role;
