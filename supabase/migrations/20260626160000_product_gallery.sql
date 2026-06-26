-- Stage 2 Pass 3f — product gallery management (attach library media to products).
--
-- The product editor had no gallery authoring path; product_media rows could only
-- be set by the seed. api.set_product_media replaces a product's gallery
-- atomically from images the operator picked in the media library.
--
-- Each submitted URL must be EITHER a media-library asset (media_assets.public_url)
-- OR already on this product — so the library picker enforces library-only for new
-- images while preserving legacy/seeded images that predate the library. At most
-- one image may be primary (none → the first becomes primary), matching the
-- `uq_product_media_one_primary` partial unique index.

CREATE OR REPLACE FUNCTION api.set_product_media(p_code text, p_items jsonb, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pid uuid;
  v_count int;
  v_primary_count int;
  v_bad int;
  v_result jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'A gallery array is required';
  END IF;

  SELECT id INTO v_pid FROM public.products WHERE code = p_code;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING DETAIL = 'Product not found';
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count > 12 THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'A gallery can have at most 12 images';
  END IF;

  -- Every URL must be a non-empty, bounded library asset OR already on this product.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(p_items) e
  WHERE COALESCE(e->>'url', '') = ''
     OR char_length(e->>'url') > 1000
     OR NOT (
          EXISTS (SELECT 1 FROM public.media_assets m WHERE m.public_url = e->>'url')
          OR EXISTS (SELECT 1 FROM public.product_media pm WHERE pm.product_id = v_pid AND pm.url = e->>'url')
        );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_media' USING DETAIL = 'Each image must come from the media library';
  END IF;

  SELECT count(*) INTO v_primary_count
  FROM jsonb_array_elements(p_items) e
  WHERE (e->>'is_primary')::boolean IS TRUE;
  IF v_primary_count > 1 THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'Only one image can be primary';
  END IF;

  -- Atomic replace.
  DELETE FROM public.product_media WHERE product_id = v_pid;

  INSERT INTO public.product_media (product_id, url, alt, kind, sort_order, is_primary)
  SELECT
    v_pid,
    e.elem->>'url',
    NULLIF(e.elem->>'alt', ''),
    'image',
    (e.ord - 1)::int,
    CASE
      WHEN v_primary_count = 1 THEN COALESCE((e.elem->>'is_primary')::boolean, false)
      ELSE (e.ord = 1)
    END
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(elem, ord);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'product.media_changed', 'products', p_code,
          jsonb_build_object('count', v_count));

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'url', url, 'alt', alt, 'is_primary', is_primary, 'sort_order', sort_order
    ) ORDER BY sort_order),
    '[]'::jsonb)
  INTO v_result
  FROM public.product_media WHERE product_id = v_pid;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION api.set_product_media(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_product_media(text, jsonb, uuid) TO service_role;
