-- Stage 5 follow-up (#11) — real contact form. The storefront contact form was a
-- client-only placeholder ("demo form does not send"). This persists submissions
-- to an RPC-only table and gives the admin an inbox to read + triage them.
--
-- submit is service-role only (the app server fn adds CSRF + per-IP rate limit,
-- so anon cannot spam the RPC directly over REST); list/set-status are staff-gated.

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  phone        text        NOT NULL CHECK (char_length(phone) BETWEEN 1 AND 20),
  email        text        CHECK (email IS NULL OR char_length(email) <= 255),
  reason       text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 40),
  order_number text        CHECK (order_number IS NULL OR char_length(order_number) <= 40),
  message      text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  status       text        NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled','archived')),
  handled_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.contact_messages IS
  'Storefront contact-form submissions. RPC-only (deny-all RLS). Read/triaged by staff via api.list_contact_messages / api.set_contact_message_status.';

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
-- deny-all: no policies. Only service-role RPCs read/write.

CREATE INDEX IF NOT EXISTS idx_contact_messages_status
  ON public.contact_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON public.contact_messages (created_at DESC);

REVOKE ALL ON TABLE public.contact_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contact_messages TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- submit_contact_message — public submission (service-role; app gates CSRF+RL)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.submit_contact_message(
  p_name         text,
  p_phone        text,
  p_message      text,
  p_reason       text,
  p_email        text DEFAULT NULL,
  p_order_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.contact_messages (name, phone, email, reason, order_number, message)
  VALUES (
    btrim(p_name),
    btrim(p_phone),
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    btrim(p_reason),
    NULLIF(btrim(COALESCE(p_order_number, '')), ''),
    btrim(p_message)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'invalid_contact';
END;
$$;

REVOKE ALL ON FUNCTION api.submit_contact_message(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.submit_contact_message(text, text, text, text, text, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- list_contact_messages — staff inbox read (filter + paginate + handled_by email)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_contact_messages(
  p_actor  uuid,
  p_status text    DEFAULT NULL,
  p_search text    DEFAULT NULL,
  p_limit  integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.contact_messages cm
  WHERE (p_status IS NULL OR cm.status = p_status)
    AND (v_search IS NULL
      OR cm.name         ILIKE '%' || v_search || '%'
      OR cm.phone        ILIKE '%' || v_search || '%'
      OR COALESCE(cm.email, '')        ILIKE '%' || v_search || '%'
      OR COALESCE(cm.order_number, '') ILIKE '%' || v_search || '%'
      OR cm.message      ILIKE '%' || v_search || '%');

  SELECT COALESCE(jsonb_agg(sub.r ORDER BY sub.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT cm.created_at, jsonb_build_object(
      'id', cm.id, 'name', cm.name, 'phone', cm.phone, 'email', cm.email,
      'reason', cm.reason, 'order_number', cm.order_number, 'message', cm.message,
      'status', cm.status, 'handled_by_email', u.email,
      'handled_at', cm.handled_at, 'created_at', cm.created_at
    ) AS r
    FROM public.contact_messages cm
    LEFT JOIN auth.users u ON u.id = cm.handled_by
    WHERE (p_status IS NULL OR cm.status = p_status)
      AND (v_search IS NULL
        OR cm.name         ILIKE '%' || v_search || '%'
        OR cm.phone        ILIKE '%' || v_search || '%'
        OR COALESCE(cm.email, '')        ILIKE '%' || v_search || '%'
        OR COALESCE(cm.order_number, '') ILIKE '%' || v_search || '%'
        OR cm.message      ILIKE '%' || v_search || '%')
    ORDER BY cm.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION api.list_contact_messages(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_contact_messages(uuid, text, text, integer, integer) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- set_contact_message_status — staff triage (new/handled/archived) + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.set_contact_message_status(
  p_actor  uuid,
  p_id     uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  IF p_status NOT IN ('new','handled','archived') THEN
    RAISE EXCEPTION 'invalid_contact_status';
  END IF;

  UPDATE public.contact_messages SET
    status     = p_status,
    handled_by = CASE WHEN p_status = 'new' THEN NULL ELSE p_actor END,
    handled_at = CASE WHEN p_status = 'new' THEN NULL ELSE now() END
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact_message_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'contact.status_changed', 'contact_message', p_id::text,
    jsonb_build_object('status', p_status));

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

REVOKE ALL ON FUNCTION api.set_contact_message_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_contact_message_status(uuid, uuid, text) TO service_role;
