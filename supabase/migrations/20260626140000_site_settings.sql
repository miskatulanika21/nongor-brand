-- Stage 2 Pass 3d — DB-backed site settings.
--
-- The admin Settings page and the storefront announcement bar were mock/static.
-- This introduces a single-row `public.site_settings` table and three api.*
-- RPCs: a public read (NO payment secrets) for the storefront, an admin read
-- (full row, incl. payment) and a guarded write that audits every change.
--
-- The table is RPC-only: RLS is enabled with NO policies (deny-all), the same
-- posture as the inventory tables — every read/write goes through a SECURITY
-- DEFINER api.* function with an explicit grant. Bounds are enforced by table
-- CHECK constraints (the isomorphic zod schema mirrors them for UX messages; a
-- raw out-of-bounds call surfaces as a 23514 → mapped to `invalid_settings`).

-- ── Table (single row, id = 1) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_settings (
  id                       smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- store
  store_name               text        NOT NULL DEFAULT 'Nongorr'
                                        CHECK (char_length(store_name) BETWEEN 1 AND 80),
  tagline                  text        CHECK (tagline IS NULL OR char_length(tagline) <= 160),
  -- announcement bar
  announcement_enabled     boolean     NOT NULL DEFAULT true,
  announcement_text        text        CHECK (announcement_text IS NULL OR char_length(announcement_text) <= 200),
  announcement_link        text        CHECK (announcement_link IS NULL OR char_length(announcement_link) <= 300),
  -- delivery
  free_delivery_threshold  integer     NOT NULL DEFAULT 3000 CHECK (free_delivery_threshold >= 0),
  delivery_fee_dhaka       integer     NOT NULL DEFAULT 80   CHECK (delivery_fee_dhaka  >= 0),
  delivery_fee_major       integer     NOT NULL DEFAULT 100  CHECK (delivery_fee_major  >= 0),
  delivery_fee_outside     integer     NOT NULL DEFAULT 130  CHECK (delivery_fee_outside >= 0),
  -- contact (public)
  contact_email            text        CHECK (contact_email IS NULL OR char_length(contact_email) <= 160),
  contact_phone            text        CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  whatsapp                 text        CHECK (whatsapp IS NULL OR char_length(whatsapp) <= 40),
  instagram                text        CHECK (instagram IS NULL OR char_length(instagram) <= 300),
  facebook                 text        CHECK (facebook IS NULL OR char_length(facebook) <= 300),
  tiktok                   text        CHECK (tiktok IS NULL OR char_length(tiktok) <= 300),
  -- policies
  return_window_days       integer     NOT NULL DEFAULT 7  CHECK (return_window_days BETWEEN 0 AND 365),
  order_hold_hours         integer     NOT NULL DEFAULT 24 CHECK (order_hold_hours BETWEEN 0 AND 720),
  -- payment (ADMIN-ONLY — never returned by the public read)
  bkash_number             text        CHECK (bkash_number IS NULL OR char_length(bkash_number) <= 40),
  nagad_number             text        CHECK (nagad_number IS NULL OR char_length(nagad_number) <= 40),
  payment_instructions     text        CHECK (payment_instructions IS NULL OR char_length(payment_instructions) <= 500),
  -- audit trail
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Seed the single row (idempotent).
INSERT INTO public.site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RPC-only: deny-all RLS (no policies); every access goes through api.* below.
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- ── Public read (no payment secrets) ────────────────────────────────────────
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
    'order_hold_hours', s.order_hold_hours
  )
  FROM public.site_settings s WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION api.get_public_settings() FROM public;
GRANT EXECUTE ON FUNCTION api.get_public_settings() TO anon, authenticated, service_role;

-- ── Admin read (full row, incl. payment) — service-role + active staff ──────
CREATE OR REPLACE FUNCTION api.get_admin_settings(p_actor uuid)
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

  SELECT to_jsonb(s.*) INTO v FROM public.site_settings s WHERE s.id = 1;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION api.get_admin_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_admin_settings(uuid) TO service_role;

-- ── Write — service-role + active staff, CASE-presence patch, audited ───────
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

  -- Only keys present in the patch are changed; a present-but-null value clears
  -- nullable columns. Bounds are enforced by the table CHECK constraints.
  UPDATE public.site_settings SET
    store_name              = CASE WHEN p_patch ? 'store_name'              THEN (p_patch->>'store_name')              ELSE store_name END,
    tagline                 = CASE WHEN p_patch ? 'tagline'                 THEN (p_patch->>'tagline')                 ELSE tagline END,
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
    updated_at              = now(),
    updated_by              = p_actor
  WHERE id = 1;

  -- Canonical audit row in the same transaction (records which keys changed).
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
