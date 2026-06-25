-- Stage 2 Pass 3e — Storage-backed media library.
--
-- The admin media library was mock (assets fabricated from the PRODUCTS array +
-- ephemeral object URLs). This introduces a real Storage bucket and a
-- `media_assets` catalogue with audited admin RPCs.
--
-- Upload path (in the app): a service-role server fn mints a SIGNED UPLOAD URL,
-- the browser PUTs the file straight to Storage, then a second server fn calls
-- api.register_media to record the row. Deletes go through service-role (object
-- removal) + api.delete_media (row + audit). The bucket is PUBLIC-read so the
-- storefront <img> works with no per-render signing; there are deliberately NO
-- storage RLS write policies (writes are authorised by the signed token / the
-- service role only).

-- ── Public bucket (image-only, 5 MB) ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-media', 'product-media', true, 5242880,
  ARRAY['image/png','image/jpeg','image/webp','image/avif','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Catalogue table (RPC-only: deny-all RLS) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_assets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path  text        NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 1 AND 400),
  public_url    text        NOT NULL CHECK (char_length(public_url) BETWEEN 1 AND 1000),
  file_name     text        NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 260),
  content_type  text        NOT NULL CHECK (content_type LIKE 'image/%'),
  size_bytes    integer     NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 5242880),
  width         integer     CHECK (width IS NULL OR width >= 0),
  height        integer     CHECK (height IS NULL OR height >= 0),
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

-- ── Register an uploaded object (idempotent on storage_path) ─────────────────
CREATE OR REPLACE FUNCTION api.register_media(
  p_path text, p_url text, p_file_name text, p_content_type text,
  p_size_bytes integer, p_width integer, p_height integer, p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;
  IF p_content_type IS NULL OR p_content_type NOT LIKE 'image/%' THEN
    RAISE EXCEPTION 'invalid_media_type' USING DETAIL = 'Only image uploads are allowed';
  END IF;

  INSERT INTO public.media_assets
    (storage_path, public_url, file_name, content_type, size_bytes, width, height, created_by)
  VALUES (p_path, p_url, p_file_name, p_content_type, p_size_bytes, p_width, p_height, p_actor)
  ON CONFLICT (storage_path) DO UPDATE SET
    public_url = EXCLUDED.public_url,
    file_name = EXCLUDED.file_name,
    content_type = EXCLUDED.content_type,
    size_bytes = EXCLUDED.size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height
  RETURNING to_jsonb(media_assets.*) INTO v;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'media.uploaded', 'media_assets', v->>'id',
          jsonb_build_object('path', p_path, 'size_bytes', p_size_bytes));

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION api.register_media(text, text, text, text, integer, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.register_media(text, text, text, text, integer, integer, integer, uuid)
  TO service_role;

-- ── Delete a media row (returns storage_path so the repo can drop the object) ─
CREATE OR REPLACE FUNCTION api.delete_media(p_id uuid, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_path text;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;

  DELETE FROM public.media_assets WHERE id = p_id RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'media_not_found' USING DETAIL = 'Media asset not found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'media.deleted', 'media_assets', p_id::text,
          jsonb_build_object('path', v_path));

  RETURN v_path;
END;
$$;

REVOKE ALL ON FUNCTION api.delete_media(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_media(uuid, uuid) TO service_role;

-- ── List media (newest first) with a real product-usage count ───────────────
CREATE OR REPLACE FUNCTION api.list_media(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(m) || jsonb_build_object('usage_count', u.cnt) ORDER BY m.created_at DESC),
    '[]'::jsonb)
  INTO v
  FROM public.media_assets m
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS cnt FROM public.product_media pm WHERE pm.url = m.public_url
  ) u ON true;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION api.list_media(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_media(uuid) TO service_role;
