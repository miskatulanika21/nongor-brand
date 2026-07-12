-- Stage 7 (P3) — readiness probe. Trivial, side-effect-free RPC that proves the
-- app can execute an api.* function through PostgREST (i.e. DB + api schema
-- reachable). Anon-executable: it returns no data, only liveness.
CREATE OR REPLACE FUNCTION api.healthz()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT jsonb_build_object('ok', true); $$;

REVOKE ALL ON FUNCTION api.healthz() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.healthz() TO anon, authenticated, service_role;

COMMENT ON FUNCTION api.healthz() IS
  'Stage 7 readiness probe: returns {ok:true}. No data, no side effects; proves PostgREST + DB + api schema are reachable.';
