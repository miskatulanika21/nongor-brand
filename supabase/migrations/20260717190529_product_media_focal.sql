-- ══════════════════════════════════════════════════════════════════════════════
-- Product image focal — Focal Studio Phase 2
--
-- Frames the PRIMARY product image (rendered object-cover as a thumbnail across
-- shop cards, wishlist, search, …) with a focal point + zoom, no re-crop. Gallery
-- rows carry focal too; only the primary's is consumed today. Existing rows
-- backfill to centre / no zoom.
--
-- NOTE: on prod this version was applied together with a follow-up
-- (20260717190727) that corrected the RPC body; the repo folds the correction in
-- here so a fresh replay lands the final, faithful function in one step.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.product_media
  ADD COLUMN IF NOT EXISTS focal_x numeric NOT NULL DEFAULT 0.5 CHECK (focal_x >= 0 AND focal_x <= 1),
  ADD COLUMN IF NOT EXISTS focal_y numeric NOT NULL DEFAULT 0.5 CHECK (focal_y >= 0 AND focal_y <= 1),
  ADD COLUMN IF NOT EXISTS zoom    numeric NOT NULL DEFAULT 1.0 CHECK (zoom >= 1 AND zoom <= 3);

-- set_product_media — ORIGINAL contract (active-staff auth, `gallery_conflict`
-- revision code, alt-length check) with focal added only to the INSERT + echo.
CREATE OR REPLACE FUNCTION api.set_product_media(
  p_code text,
  p_items jsonb,
  p_actor uuid,
  p_expected_revision integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pid uuid;
  v_rev integer;
  v_count int;
  v_primary_count int;
  v_bad int;
  v_dup int;
  v_items jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'A gallery array is required';
  END IF;

  SELECT id, gallery_revision INTO v_pid, v_rev FROM public.products WHERE code = p_code;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING DETAIL = 'Product not found';
  END IF;

  IF p_expected_revision IS NOT NULL AND v_rev <> p_expected_revision THEN
    RAISE EXCEPTION 'gallery_conflict' USING DETAIL = 'The gallery changed in another session';
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count > 12 THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'A gallery can have at most 12 images';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e WHERE char_length(e->>'alt') > 300
  ) THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'Alt text is too long (max 300)';
  END IF;

  SELECT count(*) INTO v_dup FROM (
    SELECT e->>'url' AS u FROM jsonb_array_elements(p_items) e GROUP BY e->>'url' HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'duplicate_media' USING DETAIL = 'An image may appear only once in a gallery';
  END IF;

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

  DELETE FROM public.product_media WHERE product_id = v_pid;

  INSERT INTO public.product_media (product_id, url, alt, kind, sort_order, is_primary, focal_x, focal_y, zoom)
  SELECT
    v_pid,
    e.elem->>'url',
    NULLIF(e.elem->>'alt', ''),
    'image',
    (e.ord - 1)::int,
    CASE
      WHEN v_primary_count = 1 THEN COALESCE((e.elem->>'is_primary')::boolean, false)
      ELSE (e.ord = 1)
    END,
    LEAST(1, GREATEST(0, COALESCE((e.elem->>'focal_x')::numeric, 0.5))),
    LEAST(1, GREATEST(0, COALESCE((e.elem->>'focal_y')::numeric, 0.5))),
    LEAST(3, GREATEST(1, COALESCE((e.elem->>'zoom')::numeric, 1)))
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(elem, ord);

  UPDATE public.products SET gallery_revision = gallery_revision + 1
  WHERE id = v_pid RETURNING gallery_revision INTO v_rev;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'product.media_changed', 'products', p_code,
          jsonb_build_object('count', v_count, 'revision', v_rev));

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'url', url, 'alt', alt, 'is_primary', is_primary, 'sort_order', sort_order,
      'focal_x', focal_x, 'focal_y', focal_y, 'zoom', zoom
    ) ORDER BY sort_order),
    '[]'::jsonb)
  INTO v_items
  FROM public.product_media WHERE product_id = v_pid;

  RETURN jsonb_build_object('revision', v_rev, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION api.set_product_media(text, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_product_media(text, jsonb, uuid, integer) TO service_role;
