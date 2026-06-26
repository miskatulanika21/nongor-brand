-- F-05 — Guard in-use media deletion.
--
-- BUG: api.delete_media removed the media_assets row unconditionally. Because
-- removeMedia() then best-effort deletes the Storage object, deleting an asset
-- that is still attached to a product gallery left product_media rows pointing at
-- a removed object — broken <img> on the storefront. list_media already surfaces a
-- usage_count, but nothing enforced it on delete.
--
-- FIX: reject the delete with a stable `media_in_use` code when any product_media
-- row references this asset's public_url (the same join list_media uses). The row
-- is read (and locked FOR UPDATE to serialize concurrent deletes) BEFORE any
-- mutation, so a rejected delete touches neither the catalogue nor Storage.
--
-- Residual (documented, narrow): an admin attaching this URL to a gallery in a
-- separate transaction concurrent with a delete is not serialized here, because
-- api.set_product_media validates the asset's existence but does not lock the
-- media_assets row. Worst case under that rare race is a single dangling URL —
-- the same outcome the old code produced on EVERY in-use delete. A future pass can
-- make set_product_media take a FOR SHARE lock on referenced assets to close it.

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

  DELETE FROM public.media_assets WHERE id = p_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'media.deleted', 'media_assets', p_id::text,
          jsonb_build_object('path', v_path));

  RETURN v_path;
END;
$$;

REVOKE ALL ON FUNCTION api.delete_media(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_media(uuid, uuid) TO service_role;
