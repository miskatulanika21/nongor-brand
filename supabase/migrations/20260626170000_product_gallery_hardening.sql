-- Stage 2 Pass 3f hardening — gallery integrity + optimistic concurrency.
--
-- Closes the gaps found reviewing the initial product-gallery work:
--   G-01/G-05: a product could hold the same image twice and alt text was
--              unbounded at the database level.
--   G-04:      api.set_product_media was last-write-wins, so two admins editing
--              the same gallery could silently clobber each other.
--
-- This migration:
--   1. De-duplicates existing product_media rows per (product_id, url) — keeping
--      the primary (else lowest sort_order) copy — so the new unique index can be
--      created. Duplicate rows are exact image repeats (same url/alt), so no
--      distinct image is lost.
--   2. Adds a (product_id, url) unique index and an alt-length CHECK.
--   3. Adds products.gallery_revision and rebuilds api.set_product_media to take
--      an expected revision (optimistic concurrency → gallery_conflict), reject
--      duplicate urls (duplicate_media), and return { revision, items }.

-- ── 1. Deterministic de-duplication of existing rows ────────────────────────
DELETE FROM public.product_media pm
USING (
  SELECT id, row_number() OVER (
    PARTITION BY product_id, url
    ORDER BY is_primary DESC, sort_order ASC, id ASC
  ) AS rn
  FROM public.product_media
) ranked
WHERE pm.id = ranked.id AND ranked.rn > 1;

-- ── 2. Integrity constraints ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_media_product_url
  ON public.product_media (product_id, url);

ALTER TABLE public.product_media
  DROP CONSTRAINT IF EXISTS product_media_alt_len_check;
ALTER TABLE public.product_media
  ADD CONSTRAINT product_media_alt_len_check
  CHECK (alt IS NULL OR char_length(alt) <= 300);

-- ── 3. Gallery revision for optimistic concurrency ──────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gallery_revision integer NOT NULL DEFAULT 0;

-- The signature changes (adds p_expected_revision), so drop the 3-arg version
-- to avoid an ambiguous overload, then recreate.
DROP FUNCTION IF EXISTS api.set_product_media(text, jsonb, uuid);

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

  -- Optimistic concurrency: a stale editor's expected revision will not match.
  IF p_expected_revision IS NOT NULL AND v_rev <> p_expected_revision THEN
    RAISE EXCEPTION 'gallery_conflict' USING DETAIL = 'The gallery changed in another session';
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count > 12 THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'A gallery can have at most 12 images';
  END IF;

  -- Alt text is bounded (matches the product_media_alt_len_check constraint).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e WHERE char_length(e->>'alt') > 300
  ) THEN
    RAISE EXCEPTION 'invalid_gallery' USING DETAIL = 'Alt text is too long (max 300)';
  END IF;

  -- An image may appear only once in a gallery.
  SELECT count(*) INTO v_dup FROM (
    SELECT e->>'url' AS u FROM jsonb_array_elements(p_items) e GROUP BY e->>'url' HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'duplicate_media' USING DETAIL = 'An image may appear only once in a gallery';
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

  -- Bump the revision (does not touch stock, so the stock write-guard is inert).
  UPDATE public.products SET gallery_revision = gallery_revision + 1
  WHERE id = v_pid RETURNING gallery_revision INTO v_rev;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'product.media_changed', 'products', p_code,
          jsonb_build_object('count', v_count, 'revision', v_rev));

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'url', url, 'alt', alt, 'is_primary', is_primary, 'sort_order', sort_order
    ) ORDER BY sort_order),
    '[]'::jsonb)
  INTO v_items
  FROM public.product_media WHERE product_id = v_pid;

  RETURN jsonb_build_object('revision', v_rev, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION api.set_product_media(text, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_product_media(text, jsonb, uuid, integer) TO service_role;
