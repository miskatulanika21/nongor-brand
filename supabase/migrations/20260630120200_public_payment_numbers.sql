-- Stage 3 fix pass — expose customer-facing payment receive numbers (GAP-09).
--
-- The bKash/Nagad receive numbers were stored in site_settings (admin-managed)
-- but only projected by api.get_admin_settings — so the public checkout couldn't
-- show the buyer where to send money and fell back to a brand.ts placeholder
-- (and Nagad had no path at all). These numbers are inherently customer-facing
-- (the customer must see them to pay); they are NOT secrets. Project them in
-- api.get_public_settings so checkout reads them from live settings.

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
