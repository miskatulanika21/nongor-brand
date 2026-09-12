-- Isolated regression: copies the deployed quote into pg_temp, tests the guard,
-- rolls back the coupon fixture. Never replaces a deployed function or orders.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE quote_audit_init (id integer);
DO $test$
DECLARE
  definition text := pg_get_functiondef('api.quote_order(jsonb,text,text,uuid)'::regprocedure);
  anchor text := '  priced := private.price_lines(p_lines);';
BEGIN
  IF position(anchor IN definition) = 0 THEN RAISE EXCEPTION 'quote anchor changed'; END IF;
  definition := replace(definition, 'FUNCTION api.quote_order(', 'FUNCTION pg_temp.quote_order(');
  definition := replace(definition, anchor,
    E'  IF (SELECT auth.jwt()->>''role'') IS DISTINCT FROM ''service_role'' THEN\n'
    || E'    p_actor := (SELECT auth.uid());\n'
    || E'  END IF;\n' || anchor);
  EXECUTE definition;
END;
$test$;
INSERT INTO public.coupons (code,type,value,first_order_only)
VALUES ('QA-ACTOR-ROLLBACK-20260911','fixed',1,true);
DO $test$
DECLARE
  actor uuid := 'eaa578b3-42c4-447e-a4ef-900087d81909';
  result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  result := pg_temp.quote_order('[]','dhaka','QA-ACTOR-ROLLBACK-20260911',actor);
  IF result #>> '{coupon,reason}' IS DISTINCT FROM 'coupon_not_eligible' THEN
    RAISE EXCEPTION 'anonymous caller spoofed actor: %',result;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',actor)::text,true);
  result := pg_temp.quote_order('[]','dhaka','QA-ACTOR-ROLLBACK-20260911',NULL);
  IF result #>> '{coupon,applied}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'verified identity was not used: %',result;
  END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  result := pg_temp.quote_order('[]','dhaka','QA-ACTOR-ROLLBACK-20260911',actor);
  IF result #>> '{coupon,applied}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'server actor path changed: %',result;
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'PASS: anonymous spoof rejected, verified identity used, service actor preserved; fixture rolled back' AS result;
