\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-0000000000ca');
INSERT INTO public.staff_profiles(user_id,role,is_active)
VALUES ('00000000-0000-0000-0000-0000000000ca','owner',true);
INSERT INTO public.product_categories(slug,name) VALUES ('cancel-qa','Cancellation QA');
INSERT INTO public.products(code,slug,name,category_id,price,stock)
SELECT code,code,code,id,100,20 FROM public.product_categories
CROSS JOIN (VALUES ('cancel-ready'),('cancel-one-size')) codes(code) WHERE slug='cancel-qa';
INSERT INTO public.product_size_stock(product_id,size,quantity)
SELECT id,'M',20 FROM public.products WHERE code='cancel-ready';
DO $$
DECLARE
  stage text; result jsonb; oid uuid; stock integer; variant_stock integer;
  actor uuid := '00000000-0000-0000-0000-0000000000ca';
BEGIN
  FOREACH stage IN ARRAY ARRAY['pending_confirmation','confirmed','processing','ready_to_ship'] LOOP
    result := api.place_order(
      '[{"code":"cancel-ready","size":"M","qty":2},{"code":"cancel-one-size","qty":2}]',
      '{"name":"Cancellation QA","phone":"01711111111","district":"Dhaka","address":"Local test only"}',
      'dhaka','cod','cancel-qa-'||stage,NULL,NULL,
      p_guest_token_hash => encode(extensions.digest(stage,'sha256'),'hex'));
    oid := (result->>'order_id')::uuid;
    IF stage <> 'pending_confirmation' THEN PERFORM api.confirm_cod(oid,actor); END IF;
    IF stage IN ('processing','ready_to_ship') THEN PERFORM api.transition_order(oid,'processing',actor); END IF;
    IF stage = 'ready_to_ship' THEN PERFORM api.transition_order(oid,'ready_to_ship',actor); END IF;
    PERFORM api.cancel_order(oid,actor,'QA cancellation');
    PERFORM api.cancel_order(oid,actor,'QA repeat must be a no-op');
    SELECT p.stock INTO stock FROM public.products p WHERE code='cancel-one-size';
    SELECT s.quantity INTO variant_stock FROM public.product_size_stock s
      JOIN public.products p ON p.id=s.product_id WHERE p.code='cancel-ready' AND s.size='M';
    IF stock <> 20 OR variant_stock <> 20 THEN
      RAISE EXCEPTION 'FAIL: cancellation from % left stock % and variant stock %',stage,stock,variant_stock;
    END IF;
  END LOOP;
END $$;
ROLLBACK;
