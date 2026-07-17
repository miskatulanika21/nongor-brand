-- ══════════════════════════════════════════════════════════════════════════════
-- Banner focal point — non-destructive framing (Focal Studio, Phase 1)
--
-- A banner photo is not a universal aspect ratio, but the hero crops it with
-- `object-fit: cover` at TWO shapes (4:5 desktop card + full-width mobile). A
-- single stored focal point (the part that must always stay in frame) lets the
-- browser keep that point framed at every breakpoint via `object-position`,
-- with NO re-cropped file: the original image is reused, and re-framing is
-- instant and reversible.
--
-- focal_x / focal_y are normalized 0..1 (0,0 = top-left; 0.5,0.5 = centre, the
-- old default behaviour). Existing rows backfill to centre, so nothing shifts.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS focal_x numeric NOT NULL DEFAULT 0.5
    CHECK (focal_x >= 0 AND focal_x <= 1),
  ADD COLUMN IF NOT EXISTS focal_y numeric NOT NULL DEFAULT 0.5
    CHECK (focal_y >= 0 AND focal_y <= 1);

-- ── get_active_banners: public storefront read — add focal_x/focal_y ─────────
-- (Explicit jsonb_build_object, so the new fields must be listed by hand.)
CREATE OR REPLACE FUNCTION api.get_active_banners()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(sub.r ORDER BY sub.sort_order, sub.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT b.sort_order, b.created_at, jsonb_build_object(
      'id', b.id, 'eyebrow', b.eyebrow, 'title', b.title, 'subtitle', b.subtitle,
      'cta_label', b.cta_label, 'cta_to', b.cta_to,
      'image_url', b.image_url, 'image_alt', b.image_alt,
      'card_title', b.card_title, 'card_subtitle', b.card_subtitle,
      'focal_x', b.focal_x, 'focal_y', b.focal_y
    ) AS r
    FROM public.banners b
    WHERE b.is_active
      AND (b.starts_at IS NULL OR b.starts_at <= now())
      AND (b.ends_at   IS NULL OR b.ends_at   >  now())
    ORDER BY b.sort_order, b.created_at DESC
    LIMIT 10
  ) sub;
$$;

REVOKE ALL ON FUNCTION api.get_active_banners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_active_banners() TO anon, authenticated, service_role;

-- list_banners uses `to_jsonb(b)`, so focal_x/focal_y flow through with no change.

-- ── upsert_banner: accept + clamp focal_x/focal_y on create and edit ─────────
CREATE OR REPLACE FUNCTION api.upsert_banner(p_actor uuid, p_banner jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id            uuid;
  v_created       boolean := false;
  v_row           public.banners%ROWTYPE;
  v_eyebrow       text := NULLIF(btrim(COALESCE(p_banner->>'eyebrow', '')), '');
  v_title         text := btrim(COALESCE(p_banner->>'title', ''));
  v_subtitle      text := NULLIF(btrim(COALESCE(p_banner->>'subtitle', '')), '');
  v_cta_label     text := NULLIF(btrim(COALESCE(p_banner->>'cta_label', '')), '');
  v_cta_to        text := NULLIF(btrim(COALESCE(p_banner->>'cta_to', '')), '');
  v_image_url     text := btrim(COALESCE(p_banner->>'image_url', ''));
  v_image_alt     text := NULLIF(btrim(COALESCE(p_banner->>'image_alt', '')), '');
  v_card_title    text := NULLIF(btrim(COALESCE(p_banner->>'card_title', '')), '');
  v_card_subtitle text := NULLIF(btrim(COALESCE(p_banner->>'card_subtitle', '')), '');
  v_sort_order    integer := COALESCE((p_banner->>'sort_order')::integer, 0);
  v_is_active     boolean := COALESCE((p_banner->>'is_active')::boolean, false);
  v_starts_at     timestamptz := NULLIF(btrim(COALESCE(p_banner->>'starts_at', '')), '')::timestamptz;
  v_ends_at       timestamptz := NULLIF(btrim(COALESCE(p_banner->>'ends_at', '')), '')::timestamptz;
  -- Clamp defensively (the CHECK would reject out-of-range; clamping is friendlier).
  v_focal_x       numeric := LEAST(1, GREATEST(0, COALESCE((p_banner->>'focal_x')::numeric, 0.5)));
  v_focal_y       numeric := LEAST(1, GREATEST(0, COALESCE((p_banner->>'focal_y')::numeric, 0.5)));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  v_id := NULLIF(btrim(COALESCE(p_banner->>'id', '')), '')::uuid;

  -- The image must come from the media library (same rule as product galleries),
  -- so deletion protection (media_in_use) can hold the other direction.
  IF NOT EXISTS (SELECT 1 FROM public.media_assets WHERE public_url = v_image_url) THEN
    RAISE EXCEPTION 'image_not_in_library';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.banners (
      eyebrow, title, subtitle, cta_label, cta_to, image_url, image_alt,
      card_title, card_subtitle, sort_order, is_active, starts_at, ends_at,
      focal_x, focal_y, updated_by
    ) VALUES (
      v_eyebrow, v_title, v_subtitle, v_cta_label, v_cta_to, v_image_url, v_image_alt,
      v_card_title, v_card_subtitle, v_sort_order, v_is_active, v_starts_at, v_ends_at,
      v_focal_x, v_focal_y, p_actor
    )
    RETURNING * INTO v_row;
    v_created := true;
  ELSE
    UPDATE public.banners SET
      eyebrow       = v_eyebrow,
      title         = v_title,
      subtitle      = v_subtitle,
      cta_label     = v_cta_label,
      cta_to        = v_cta_to,
      image_url     = v_image_url,
      image_alt     = v_image_alt,
      card_title    = v_card_title,
      card_subtitle = v_card_subtitle,
      sort_order    = v_sort_order,
      is_active     = v_is_active,
      starts_at     = v_starts_at,
      ends_at       = v_ends_at,
      focal_x       = v_focal_x,
      focal_y       = v_focal_y,
      updated_at    = now(),
      updated_by    = p_actor
    WHERE id = v_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'banner_not_found';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor,
    CASE WHEN v_created THEN 'banner.created' ELSE 'banner.updated' END,
    'banner', v_row.id::text,
    jsonb_build_object('title', v_row.title, 'is_active', v_row.is_active,
                       'sort_order', v_row.sort_order));

  RETURN jsonb_build_object('banner', to_jsonb(v_row), 'created', v_created);
EXCEPTION
  WHEN check_violation OR not_null_violation OR invalid_text_representation
    OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'invalid_banner';
END;
$$;

REVOKE ALL ON FUNCTION api.upsert_banner(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.upsert_banner(uuid, jsonb) TO service_role;
