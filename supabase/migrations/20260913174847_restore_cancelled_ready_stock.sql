-- Confirmation consumes ready stock; cancelling before courier booking must
-- restore it. Pending orders only release reservations; custom sizes never
-- consume ready stock. Courier-booked cancellations still require inspection
-- and an explicit inventory adjustment because the parcel may have left us.
DO $migration$
DECLARE
  definition text;
  anchor text;
  anchors text[] := ARRAY[
    'IF p_to_status = ''returned'' AND p_restock THEN',
    'FROM public.order_items oi WHERE oi.order_id = p_order_id',
    'SELECT code INTO v_code FROM public.products WHERE id = r.product_id;',
    'p_reason   := ''return'','
  ];
BEGIN
  SELECT pg_get_functiondef('api.transition_order(uuid,text,uuid,text,integer,boolean)'::regprocedure)
    INTO definition;
  -- Refuse a partially applied patch if the installed function has drifted.
  FOREACH anchor IN ARRAY anchors LOOP
    IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
      RAISE EXCEPTION 'Unexpected transition_order definition: anchor must occur exactly once: %', anchor;
    END IF;
  END LOOP;
  definition := replace(definition,
    'IF p_to_status = ''returned'' AND p_restock THEN',
    'IF (p_to_status = ''returned'' AND p_restock)
       OR (p_to_status = ''cancelled'' AND v_from IN (''confirmed'', ''processing'', ''ready_to_ship'')) THEN');
  definition := replace(definition,
    'FROM public.order_items oi WHERE oi.order_id = p_order_id',
    'FROM public.order_items oi WHERE oi.order_id = p_order_id ORDER BY oi.product_id, COALESCE(oi.variant_size, '''')');
  -- Lock the product before reading stock, matching set_inventory's lock order.
  definition := replace(definition,
    'SELECT code INTO v_code FROM public.products WHERE id = r.product_id;',
    'SELECT code INTO v_code FROM public.products WHERE id = r.product_id FOR UPDATE;');
  definition := replace(definition,
    'p_reason   := ''return'',',
    'p_reason   := CASE WHEN p_to_status = ''cancelled'' THEN ''order_cancelled'' ELSE ''return'' END,');
  EXECUTE definition;
END;
$migration$;
