-- ══════════════════════════════════════════════════════════════════════════════
-- Stage 6 P1 — notification outbox sender (claim primitives)
--
-- The Stage-5 courier layer enqueues customer notifications into
-- public.notification_events on every shipment lifecycle transition, but nothing
-- ever drained the outbox (the sender was deferred until an email provider was
-- connected — Resend, 2026-07-23). This migration adds the claim primitives so a
-- sender (best-effort inline at the courier-webhook enqueue points, plus a cron
-- catch-up) can atomically claim a batch, send email, and mark each row
-- sent/failed — using FOR UPDATE SKIP LOCKED so concurrent drains never
-- double-send the same notification.
-- ══════════════════════════════════════════════════════════════════════════════

-- Claim bookkeeping. `attempts` guards against poison messages; `claimed_at` is a
-- lease so a sender that crashes mid-send releases its rows after a timeout;
-- `last_error` aids observability without exposing PII (never the recipient).
ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

-- Partial index for the drain query (only unsent rows are ever scanned).
CREATE INDEX IF NOT EXISTS idx_notification_events_claimable
  ON public.notification_events (created_at)
  WHERE sent_at IS NULL;

-- Atomically claim up to p_limit unsent notifications and return them joined with
-- the recipient's order info. A row is claimable when it is unsent, under the
-- attempt ceiling, and either never claimed or past its 15-minute lease. The
-- claim increments `attempts` and stamps `claimed_at`; the sender later marks
-- sent_at (success) or clears claimed_at (release for retry) via the service-role
-- client. SECURITY DEFINER + empty search_path per project convention.
CREATE OR REPLACE FUNCTION api.claim_notification_batch(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id             bigint,
  order_id       uuid,
  event_type     text,
  metadata       jsonb,
  attempts       integer,
  order_no       text,
  customer_name  text,
  customer_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT ne.id
      FROM public.notification_events ne
     WHERE ne.sent_at IS NULL
       AND ne.attempts < 5
       AND (ne.claimed_at IS NULL OR ne.claimed_at < now() - interval '15 minutes')
     ORDER BY ne.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  ),
  claimed AS (
    UPDATE public.notification_events ne
       SET claimed_at = now(),
           attempts   = ne.attempts + 1
      FROM claimable c
     WHERE ne.id = c.id
    RETURNING ne.id, ne.order_id, ne.event_type, ne.metadata, ne.attempts
  )
  SELECT c.id, c.order_id, c.event_type, c.metadata, c.attempts,
         o.order_no, o.customer_name, o.customer_email
    FROM claimed c
    JOIN public.orders o ON o.id = c.order_id
   ORDER BY c.id;
END;
$$;

REVOKE ALL   ON FUNCTION api.claim_notification_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.claim_notification_batch(integer) TO service_role;
