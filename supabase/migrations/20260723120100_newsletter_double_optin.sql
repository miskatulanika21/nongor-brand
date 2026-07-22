-- ══════════════════════════════════════════════════════════════════════════════
-- Stage 6 P2 — newsletter consent (double opt-in + unsubscribe)
--
-- Stage-5 shipped a single-opt-in footer form (api.subscribe_newsletter inserted a
-- row as immediately consented). This upgrades it to proper double opt-in with an
-- auditable consent trail and a token-based unsubscribe:
--   subscribe  → status 'pending', issue a one-time confirm_token (email it)
--   confirm    → status 'confirmed' (records confirmed_at)
--   unsubscribe→ status 'unsubscribed' via a stable per-subscriber token
--
-- Existing single-opt-in rows are grandfathered to 'confirmed' (they already gave
-- consent under the prior policy; forcing re-confirmation would silently drop them).
-- Table stays RPC-only (deny-all RLS); the sender runs as service_role.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  ADD COLUMN IF NOT EXISTS confirm_token     text,
  ADD COLUMN IF NOT EXISTS unsubscribe_token text NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN IF NOT EXISTS confirmed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS consent_source    text,
  ADD COLUMN IF NOT EXISTS consent_ip        text;

-- Grandfather pre-existing rows: those that were consented (and not unsubscribed)
-- become 'confirmed'; previously-unsubscribed stay unsubscribed. Runs once — only
-- rows still carrying the freshly-added 'pending' default are touched.
UPDATE public.newsletter_subscribers
   SET status       = CASE WHEN unsubscribed_at IS NOT NULL THEN 'unsubscribed' ELSE 'confirmed' END,
       confirmed_at = COALESCE(confirmed_at,
                        CASE WHEN unsubscribed_at IS NULL THEN consented_at END)
 WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_confirm_token
  ON public.newsletter_subscribers (confirm_token)
  WHERE confirm_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_unsub_token
  ON public.newsletter_subscribers (unsubscribe_token);

-- ── subscribe (double opt-in) ──────────────────────────────────────────────────
-- Signature changes (adds source/ip), so drop the old 2-arg version first.
DROP FUNCTION IF EXISTS api.subscribe_newsletter(text, text);

CREATE OR REPLACE FUNCTION api.subscribe_newsletter(
  p_email    text,
  p_whatsapp text DEFAULT NULL,
  p_source   text DEFAULT 'footer',
  p_ip       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_wa    text := NULLIF(btrim(COALESCE(p_whatsapp, '')), '');
  v_row   public.newsletter_subscribers;
  v_token text;
BEGIN
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_subscription';
  END IF;

  SELECT * INTO v_row FROM public.newsletter_subscribers WHERE email = v_email;

  -- Already confirmed → idempotent no-op (just refresh WhatsApp if newly given).
  IF v_row.id IS NOT NULL AND v_row.status = 'confirmed' THEN
    UPDATE public.newsletter_subscribers
       SET whatsapp = COALESCE(v_wa, whatsapp)
     WHERE id = v_row.id;
    RETURN jsonb_build_object('status', 'confirmed', 'email', v_email);
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '');

  IF v_row.id IS NULL THEN
    INSERT INTO public.newsletter_subscribers
      (email, whatsapp, status, confirm_token, consent_source, consent_ip, consented_at)
    VALUES (v_email, v_wa, 'pending', v_token, p_source, p_ip, now())
    RETURNING * INTO v_row;
  ELSE
    -- pending or unsubscribed → reissue a confirm token and re-request consent.
    UPDATE public.newsletter_subscribers
       SET status          = 'pending',
           confirm_token   = v_token,
           consent_source  = p_source,
           consent_ip      = COALESCE(p_ip, consent_ip),
           consented_at    = now(),
           unsubscribed_at = NULL,
           whatsapp        = COALESCE(v_wa, whatsapp)
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'status', 'pending',
    'confirm_token', v_token,
    'unsubscribe_token', v_row.unsubscribe_token,
    'email', v_email
  );
END;
$$;

REVOKE ALL   ON FUNCTION api.subscribe_newsletter(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.subscribe_newsletter(text, text, text, text) TO service_role;

-- ── confirm ─────────────────────────────────────────────────────────────────────
-- Returns 'confirmed' on first confirmation (caller then sends the welcome email),
-- 'already_confirmed' on a repeat click (idempotent, no second welcome), or
-- 'invalid' for an unknown/unsubscribed token.
CREATE OR REPLACE FUNCTION api.confirm_newsletter(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.newsletter_subscribers;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_row FROM public.newsletter_subscribers WHERE confirm_token = p_token;
  IF v_row.id IS NULL OR v_row.status = 'unsubscribed' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.status = 'confirmed' THEN
    RETURN jsonb_build_object('status', 'already_confirmed', 'email', v_row.email,
                              'unsubscribe_token', v_row.unsubscribe_token);
  END IF;

  UPDATE public.newsletter_subscribers
     SET status = 'confirmed', confirmed_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('status', 'confirmed', 'email', v_row.email,
                            'unsubscribe_token', v_row.unsubscribe_token);
END;
$$;

REVOKE ALL   ON FUNCTION api.confirm_newsletter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.confirm_newsletter(text) TO service_role;

-- ── unsubscribe ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.unsubscribe_newsletter(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.newsletter_subscribers;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_row FROM public.newsletter_subscribers WHERE unsubscribe_token = p_token;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.status <> 'unsubscribed' THEN
    UPDATE public.newsletter_subscribers
       SET status = 'unsubscribed', unsubscribed_at = now()
     WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('status', 'unsubscribed', 'email', v_row.email);
END;
$$;

REVOKE ALL   ON FUNCTION api.unsubscribe_newsletter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.unsubscribe_newsletter(text) TO service_role;
