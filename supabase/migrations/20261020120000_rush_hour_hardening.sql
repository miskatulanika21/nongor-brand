-- Rush-hour hardening for the checkout write path.
--
-- 1. lock_timeout on api.place_order
--    place_order locks every product row in the cart (sorted, FOR UPDATE) and
--    the coupon row. During a flash sale on one product every buyer serializes
--    on that row. Each holder is short, but without a lock timeout a stalled
--    holder makes the whole queue wait silently until the role's
--    statement_timeout, tying up PostgREST connections for everyone else.
--    A bounded wait fails fast with SQLSTATE 55P03 instead; the server maps it
--    to the retryable `busy_retry` code, and because the whole transaction
--    (including the idempotency_keys insert) rolls back, the shopper's retry
--    with the SAME idempotency key is safe.
--
-- 2. idempotency_keys retention
--    Keys only need to outlive client retries (seconds to minutes). The order
--    itself keeps its own idempotency_key column, so pruning keys older than
--    30 days loses nothing and keeps the serialization-point index small.
--
-- 3. cron.job_run_details retention
--    pg_cron logs every run and never prunes. expire-reservations alone runs
--    every 5 minutes; in production the log held 33k rows (Jun 26 → Oct 20)
--    and its inserts were the second-largest consumer of database time in
--    pg_stat_statements. Keep 7 days of history (Supabase's recommended
--    pattern) — enough to debug a failing job, nothing more.

ALTER FUNCTION api.place_order(jsonb, jsonb, text, text, text, uuid, text, text, text)
  SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.prune_idempotency_keys()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.idempotency_keys
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION private.prune_idempotency_keys() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'prune-idempotency-keys', '17 3 * * *',
    'SELECT private.prune_idempotency_keys();'
  );
  RAISE NOTICE 'pg_cron: scheduled prune-idempotency-keys daily at 03:17 UTC';
  PERFORM cron.schedule(
    'prune-cron-run-details', '27 3 * * *',
    $job$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$job$
  );
  RAISE NOTICE 'pg_cron: scheduled prune-cron-run-details daily at 03:27 UTC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (%) — schedule the retention jobs manually.', SQLERRM;
END;
$$;
