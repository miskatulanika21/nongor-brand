-- Stage 6 P3 — homepage banners (CMS-driven hero).
--
-- The storefront hero (HeroSection) was hardcoded; the admin Banners screen was
-- a hidden "Coming soon" placeholder. This adds a real `banners` table:
-- RPC-only deny-all (same posture as site_settings/coupons/contact), a public
-- read for the storefront (the highest-sorted currently-active banner drives
-- the hero; the app keeps a static fallback for zero rows), and staff CRUD
-- gated app-side by `content.manage` with SQL-side active-staff re-checks and
-- canonical audit rows.
--
-- Also extends api.delete_media's in-use guard (F-05 pattern): deleting a
-- media-library image that a banner references is rejected with `media_in_use`,
-- exactly like product-gallery references.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. banners table — RPC-only deny-all
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.banners (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  eyebrow       text        CHECK (eyebrow IS NULL OR char_length(eyebrow) <= 80),
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  subtitle      text        CHECK (subtitle IS NULL OR char_length(subtitle) <= 300),
  cta_label     text        CHECK (cta_label IS NULL OR char_length(cta_label) <= 60),
  -- internal storefront path only (never an external URL)
  cta_to        text        CHECK (cta_to IS NULL OR (char_length(cta_to) <= 300 AND cta_to LIKE '/%')),
  image_url     text        NOT NULL CHECK (char_length(image_url) BETWEEN 1 AND 1000),
  image_alt     text        CHECK (image_alt IS NULL OR char_length(image_alt) <= 300),
  -- optional caption card overlaid on the hero image; hidden when title is null
  card_title    text        CHECK (card_title IS NULL OR char_length(card_title) <= 120),
  card_subtitle text        CHECK (card_subtitle IS NULL OR char_length(card_subtitle) <= 160),
  sort_order    integer     NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
  is_active     boolean     NOT NULL DEFAULT false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT banners_window_valid CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT banners_cta_coherent CHECK ((cta_label IS NULL) = (cta_to IS NULL))
);
COMMENT ON TABLE public.banners IS
  'Homepage hero banners. RPC-only (deny-all RLS). Public read via api.get_active_banners; staff CRUD via api.upsert_banner/set_banner_active/delete_banner (app gates content.manage). The lowest sort_order among currently-active banners drives the hero.';

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
-- deny-all: no policies. Only service-role RPCs read/write.

CREATE INDEX IF NOT EXISTS idx_banners_active ON public.banners (sort_order, created_at DESC)
  WHERE is_active;

REVOKE ALL ON TABLE public.banners FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.banners TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. get_active_banners — public storefront read (no staff ids leaked)
-- ══════════════════════════════════════════════════════════════════════════════

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
      'card_title', b.card_title, 'card_subtitle', b.card_subtitle
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

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. list_banners — staff read (all rows + computed live flag)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_banners(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(sub.r ORDER BY sub.sort_order, sub.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT b.sort_order, b.created_at,
      to_jsonb(b) || jsonb_build_object(
        'live', b.is_active
          AND (b.starts_at IS NULL OR b.starts_at <= now())
          AND (b.ends_at   IS NULL OR b.ends_at   >  now())
      ) AS r
    FROM public.banners b
  ) sub;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.list_banners(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_banners(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. upsert_banner — create/edit (image must be in the media library) + audit
-- ══════════════════════════════════════════════════════════════════════════════

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
      card_title, card_subtitle, sort_order, is_active, starts_at, ends_at, updated_by
    ) VALUES (
      v_eyebrow, v_title, v_subtitle, v_cta_label, v_cta_to, v_image_url, v_image_alt,
      v_card_title, v_card_subtitle, v_sort_order, v_is_active, v_starts_at, v_ends_at, p_actor
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

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. set_banner_active — enable/disable + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.set_banner_active(p_actor uuid, p_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.banners%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  UPDATE public.banners SET
    is_active  = p_active,
    updated_at = now(),
    updated_by = p_actor
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'banner_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'banner.status_changed', 'banner', p_id::text,
    jsonb_build_object('title', v_row.title, 'is_active', p_active));

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION api.set_banner_active(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_banner_active(uuid, uuid, boolean) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. delete_banner — hard delete + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.delete_banner(p_actor uuid, p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  DELETE FROM public.banners WHERE id = p_id RETURNING title INTO v_title;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'banner_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'banner.deleted', 'banner', p_id::text,
    jsonb_build_object('title', v_title));
END;
$$;

REVOKE ALL ON FUNCTION api.delete_banner(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_banner(uuid, uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. delete_media — extend the F-05 in-use guard to banner references
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.delete_media(p_id uuid, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_path text; v_url text;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;

  -- Read + lock the asset before any mutation.
  SELECT storage_path, public_url INTO v_path, v_url
  FROM public.media_assets WHERE id = p_id
  FOR UPDATE;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'media_not_found' USING DETAIL = 'Media asset not found';
  END IF;

  -- Refuse to orphan a product gallery image (same join as api.list_media).
  IF EXISTS (SELECT 1 FROM public.product_media WHERE url = v_url) THEN
    RAISE EXCEPTION 'media_in_use'
      USING DETAIL = 'This image is attached to one or more product galleries';
  END IF;

  -- Refuse to orphan a homepage banner image (Stage 6).
  IF EXISTS (SELECT 1 FROM public.banners WHERE image_url = v_url) THEN
    RAISE EXCEPTION 'media_in_use'
      USING DETAIL = 'This image is used by one or more homepage banners';
  END IF;

  DELETE FROM public.media_assets WHERE id = p_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'media.deleted', 'media_assets', p_id::text,
          jsonb_build_object('path', v_path));

  RETURN v_path;
END;
$$;

REVOKE ALL ON FUNCTION api.delete_media(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_media(uuid, uuid) TO service_role;
