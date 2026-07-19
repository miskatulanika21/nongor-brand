-- Owner-editable brand logo for the About page.
--
-- The About page rendered a build-time asset import, so changing the mark
-- shown there meant a code change and a deploy. This adds a single nullable
-- `logo_url` to the settings row, pointed at a media-library asset.
--
-- Deliberately ONE global column, not an about-specific one: the header and
-- footer lockups (components/Logo.tsx) compose the mark with a wordmark and
-- are intentionally staying in code, but if they ever adopt an owner-set logo
-- they read this same column — no second migration, no divergent fields.
--
-- NULL means "use the bundled asset". The storefront treats this column as an
-- override, never a requirement, so an unset logo costs no network request and
-- clearing it restores the shipped mark.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS logo_url text
    CHECK (logo_url IS NULL OR char_length(logo_url) <= 500);

-- ── Public read ─────────────────────────────────────────────────────────────
-- Rebuilt faithfully from the live definition; the ONLY change is the added
-- 'logo_url' key. The logo is public by nature (it renders to every visitor),
-- so it belongs in the public projection alongside store_name.
CREATE OR REPLACE FUNCTION api.get_public_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'store_name', s.store_name,
    'tagline', s.tagline,
    'logo_url', s.logo_url,
    'announcement_enabled', s.announcement_enabled,
    'announcement_text', s.announcement_text,
    'announcement_link', s.announcement_link,
    'free_delivery_threshold', s.free_delivery_threshold,
    'delivery_fee_dhaka', s.delivery_fee_dhaka,
    'delivery_fee_major', s.delivery_fee_major,
    'delivery_fee_outside', s.delivery_fee_outside,
    'contact_email', s.contact_email,
    'contact_phone', s.contact_phone,
    'whatsapp', s.whatsapp,
    'instagram', s.instagram,
    'facebook', s.facebook,
    'tiktok', s.tiktok,
    'return_window_days', s.return_window_days,
    'order_hold_hours', s.order_hold_hours,
    'cod_enabled', s.cod_enabled,
    'payment_methods_enabled', s.payment_methods_enabled,
    'bkash_number', s.bkash_number,
    'nagad_number', s.nagad_number
  )
  FROM public.site_settings s WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION api.get_public_settings() FROM public;
GRANT EXECUTE ON FUNCTION api.get_public_settings() TO anon, authenticated, service_role;

-- ── Guarded write ───────────────────────────────────────────────────────────
-- Rebuilt faithfully from the live definition; the ONLY change is the added
-- logo_url assignment. Same key-presence semantics as every other column:
-- absent key = leave untouched, JSON null = clear back to the bundled asset.
CREATE OR REPLACE FUNCTION api.save_settings(p_patch jsonb, p_actor uuid)
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
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_settings' USING DETAIL = 'A settings object is required';
  END IF;

  UPDATE public.site_settings SET
    store_name              = CASE WHEN p_patch ? 'store_name'              THEN (p_patch->>'store_name')              ELSE store_name END,
    tagline                 = CASE WHEN p_patch ? 'tagline'                 THEN (p_patch->>'tagline')                 ELSE tagline END,
    logo_url                = CASE WHEN p_patch ? 'logo_url'                THEN (p_patch->>'logo_url')                ELSE logo_url END,
    announcement_enabled    = CASE WHEN p_patch ? 'announcement_enabled'    THEN (p_patch->>'announcement_enabled')::boolean ELSE announcement_enabled END,
    announcement_text       = CASE WHEN p_patch ? 'announcement_text'       THEN (p_patch->>'announcement_text')       ELSE announcement_text END,
    announcement_link       = CASE WHEN p_patch ? 'announcement_link'       THEN (p_patch->>'announcement_link')       ELSE announcement_link END,
    free_delivery_threshold = CASE WHEN p_patch ? 'free_delivery_threshold' THEN (p_patch->>'free_delivery_threshold')::integer ELSE free_delivery_threshold END,
    delivery_fee_dhaka      = CASE WHEN p_patch ? 'delivery_fee_dhaka'      THEN (p_patch->>'delivery_fee_dhaka')::integer  ELSE delivery_fee_dhaka END,
    delivery_fee_major      = CASE WHEN p_patch ? 'delivery_fee_major'      THEN (p_patch->>'delivery_fee_major')::integer  ELSE delivery_fee_major END,
    delivery_fee_outside    = CASE WHEN p_patch ? 'delivery_fee_outside'    THEN (p_patch->>'delivery_fee_outside')::integer ELSE delivery_fee_outside END,
    contact_email           = CASE WHEN p_patch ? 'contact_email'           THEN (p_patch->>'contact_email')           ELSE contact_email END,
    contact_phone           = CASE WHEN p_patch ? 'contact_phone'           THEN (p_patch->>'contact_phone')           ELSE contact_phone END,
    whatsapp                = CASE WHEN p_patch ? 'whatsapp'                 THEN (p_patch->>'whatsapp')                ELSE whatsapp END,
    instagram               = CASE WHEN p_patch ? 'instagram'               THEN (p_patch->>'instagram')               ELSE instagram END,
    facebook                = CASE WHEN p_patch ? 'facebook'                THEN (p_patch->>'facebook')                ELSE facebook END,
    tiktok                  = CASE WHEN p_patch ? 'tiktok'                  THEN (p_patch->>'tiktok')                  ELSE tiktok END,
    return_window_days      = CASE WHEN p_patch ? 'return_window_days'      THEN (p_patch->>'return_window_days')::integer ELSE return_window_days END,
    order_hold_hours        = CASE WHEN p_patch ? 'order_hold_hours'        THEN (p_patch->>'order_hold_hours')::integer   ELSE order_hold_hours END,
    bkash_number            = CASE WHEN p_patch ? 'bkash_number'            THEN (p_patch->>'bkash_number')            ELSE bkash_number END,
    nagad_number            = CASE WHEN p_patch ? 'nagad_number'            THEN (p_patch->>'nagad_number')            ELSE nagad_number END,
    payment_instructions    = CASE WHEN p_patch ? 'payment_instructions'    THEN (p_patch->>'payment_instructions')    ELSE payment_instructions END,
    cod_enabled             = CASE WHEN p_patch ? 'cod_enabled'             THEN (p_patch->>'cod_enabled')::boolean    ELSE cod_enabled END,
    payment_methods_enabled = CASE WHEN p_patch ? 'payment_methods_enabled'
                                   THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'payment_methods_enabled'))
                                   ELSE payment_methods_enabled END,
    updated_at              = now(),
    updated_by              = p_actor
  WHERE id = 1;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'settings.updated', 'site_settings', '1',
          jsonb_build_object('keys',
            (SELECT jsonb_agg(k.key ORDER BY k.key) FROM jsonb_object_keys(p_patch) AS k(key))));

  SELECT to_jsonb(s.*) INTO v FROM public.site_settings s WHERE s.id = 1;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION api.save_settings(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.save_settings(jsonb, uuid) TO service_role;

-- api.get_admin_settings needs no change: it returns to_jsonb(s.*), so the new
-- column appears in the admin projection automatically.
