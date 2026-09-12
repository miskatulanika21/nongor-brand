-- Public callers must not choose whose coupon/order history is inspected.
-- Keep the service-role path for server-authorized calls from place_order.
-- Insert only the identity guard; preserve deployed pricing logic and grants.
DO $migration$
DECLARE
  definition text;
  anchor constant text := '  priced := private.price_lines(p_lines);';
BEGIN
  definition := pg_get_functiondef('api.quote_order(jsonb,text,text,uuid)'::regprocedure);
  IF position(anchor IN definition) = 0 THEN
    RAISE EXCEPTION 'quote_order pricing anchor changed; review migration before applying';
  END IF;
  definition := replace(definition, anchor,
    E'  IF (SELECT auth.jwt()->>''role'') IS DISTINCT FROM ''service_role'' THEN\n'
    || E'    p_actor := (SELECT auth.uid());\n'
    || E'  END IF;\n' || anchor);
  EXECUTE definition;
END;
$migration$;
