-- Stage 6 P4 — policies CMS (site_pages).
--
-- The admin Policies screen had a dead "Edit" button over static routes. This
-- makes the four Prose-shaped policy pages (delivery / payment / cookie /
-- authenticity) genuinely CMS-editable: markdown body + hero fields, a draft
-- working copy, publish with revision history (pruned to 20), and restore.
-- The four designed pages (return/terms/privacy/custom-size) intentionally
-- stay in code — their rich layouts are not markdown-expressible.
--
-- Posture: RPC-only deny-all (site_settings/banners pattern). Public read is
-- anon-granted and returns published fields only; staff CRUD is service-role
-- only (app gates `policies.manage`) with SQL-side active-staff re-checks and
-- canonical page.* audit rows. Slugs are a fixed, code-registered set (the
-- storefront routes are static files), enforced by CHECK.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. site_pages — one row per CMS-editable page (seeded below)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.site_pages (
  slug         text        PRIMARY KEY CHECK (slug IN
                 ('delivery-policy','payment-policy','cookie-policy','authenticity-policy')),
  eyebrow      text        CHECK (eyebrow IS NULL OR char_length(eyebrow) <= 80),
  title        text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description  text        CHECK (description IS NULL OR char_length(description) <= 300),
  body_md      text        NOT NULL CHECK (char_length(body_md) BETWEEN 1 AND 100000),
  -- unpublished working copy: {eyebrow,title,description,body_md} or NULL
  draft        jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.site_pages IS
  'CMS-editable storefront policy pages (markdown). RPC-only (deny-all RLS). Public read via api.get_site_page; staff draft/publish/restore via api.*_site_page* (app gates policies.manage). Designed pages (return/terms/privacy/custom-size) live in code, not here.';

ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;
-- deny-all: no policies. Only service-role RPCs read/write.

REVOKE ALL ON TABLE public.site_pages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.site_pages TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. site_page_revisions — one row per publish, pruned to the latest 20
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.site_page_revisions (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         text        NOT NULL REFERENCES public.site_pages(slug) ON DELETE CASCADE,
  eyebrow      text,
  title        text        NOT NULL,
  description  text,
  body_md      text        NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.site_page_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_site_page_revisions_slug
  ON public.site_page_revisions (slug, id DESC);

REVOKE ALL ON TABLE public.site_page_revisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.site_page_revisions TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. get_site_page — public storefront read (published fields only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.get_site_page(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'slug', p.slug, 'eyebrow', p.eyebrow, 'title', p.title,
    'description', p.description, 'body_md', p.body_md,
    'published_at', p.published_at)
  FROM public.site_pages p
  WHERE p.slug = p_slug;
$$;

REVOKE ALL ON FUNCTION api.get_site_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_site_page(text) TO anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. list_site_pages — staff overview (draft flag, no bodies)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_site_pages(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'title', p.title, 'eyebrow', p.eyebrow,
    'has_draft', p.draft IS NOT NULL,
    'published_at', p.published_at, 'updated_at', p.updated_at,
    'revision_count', (SELECT count(*) FROM public.site_page_revisions r WHERE r.slug = p.slug)
  ) ORDER BY p.slug), '[]'::jsonb) INTO v_rows
  FROM public.site_pages p;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.list_site_pages(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_site_pages(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. get_site_page_admin — full row incl. draft for the editor
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.get_site_page_admin(p_actor uuid, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT to_jsonb(p) INTO v FROM public.site_pages p WHERE p.slug = p_slug;
  IF v IS NULL THEN
    RAISE EXCEPTION 'page_not_found';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION api.get_site_page_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_site_page_admin(uuid, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. save_site_page_draft — store/replace the working copy + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.save_site_page_draft(p_actor uuid, p_slug text, p_draft jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eyebrow     text := NULLIF(btrim(COALESCE(p_draft->>'eyebrow', '')), '');
  v_title       text := btrim(COALESCE(p_draft->>'title', ''));
  v_description text := NULLIF(btrim(COALESCE(p_draft->>'description', '')), '');
  v_body        text := COALESCE(p_draft->>'body_md', '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  IF char_length(v_title) NOT BETWEEN 1 AND 160
     OR (v_eyebrow IS NOT NULL AND char_length(v_eyebrow) > 80)
     OR (v_description IS NOT NULL AND char_length(v_description) > 300)
     OR char_length(v_body) NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'invalid_page';
  END IF;

  UPDATE public.site_pages SET
    draft = jsonb_build_object(
      'eyebrow', v_eyebrow, 'title', v_title,
      'description', v_description, 'body_md', v_body),
    updated_at = now(),
    updated_by = p_actor
  WHERE slug = p_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'page.draft_saved', 'site_page', p_slug,
    jsonb_build_object('title', v_title));

  RETURN jsonb_build_object('slug', p_slug, 'has_draft', true);
END;
$$;

REVOKE ALL ON FUNCTION api.save_site_page_draft(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.save_site_page_draft(uuid, text, jsonb) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. publish_site_page — draft → published + revision (pruned to 20) + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.publish_site_page(p_actor uuid, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_page public.site_pages%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT * INTO v_page FROM public.site_pages WHERE slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found';
  END IF;
  IF v_page.draft IS NULL THEN
    RAISE EXCEPTION 'no_draft_to_publish';
  END IF;

  UPDATE public.site_pages SET
    eyebrow      = NULLIF(btrim(COALESCE(v_page.draft->>'eyebrow', '')), ''),
    title        = btrim(v_page.draft->>'title'),
    description  = NULLIF(btrim(COALESCE(v_page.draft->>'description', '')), ''),
    body_md      = v_page.draft->>'body_md',
    draft        = NULL,
    published_at = now(),
    updated_at   = now(),
    updated_by   = p_actor
  WHERE slug = p_slug
  RETURNING * INTO v_page;

  INSERT INTO public.site_page_revisions (slug, eyebrow, title, description, body_md, published_by)
  VALUES (p_slug, v_page.eyebrow, v_page.title, v_page.description, v_page.body_md, p_actor);

  -- Keep the latest 20 revisions per page.
  DELETE FROM public.site_page_revisions
  WHERE slug = p_slug
    AND id NOT IN (
      SELECT id FROM public.site_page_revisions
      WHERE slug = p_slug ORDER BY id DESC LIMIT 20);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'page.published', 'site_page', p_slug,
    jsonb_build_object('title', v_page.title));

  RETURN jsonb_build_object('slug', p_slug, 'published_at', v_page.published_at);
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_page';
END;
$$;

REVOKE ALL ON FUNCTION api.publish_site_page(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.publish_site_page(uuid, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. discard_site_page_draft — drop the working copy + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.discard_site_page_draft(p_actor uuid, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  UPDATE public.site_pages SET
    draft = NULL, updated_at = now(), updated_by = p_actor
  WHERE slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'page.draft_discarded', 'site_page', p_slug, '{}'::jsonb);

  RETURN jsonb_build_object('slug', p_slug, 'has_draft', false);
END;
$$;

REVOKE ALL ON FUNCTION api.discard_site_page_draft(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.discard_site_page_draft(uuid, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. list_site_page_revisions — history for the admin (incl. bodies, ≤20 rows)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_site_page_revisions(p_actor uuid, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'eyebrow', r.eyebrow, 'title', r.title,
    'description', r.description, 'body_md', r.body_md,
    'published_at', r.published_at, 'published_by_email', u.email
  ) ORDER BY r.id DESC), '[]'::jsonb) INTO v_rows
  FROM public.site_page_revisions r
  LEFT JOIN auth.users u ON u.id = r.published_by
  WHERE r.slug = p_slug;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.list_site_page_revisions(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_site_page_revisions(uuid, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. restore_site_page_revision — revision → draft (not straight to live) + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.restore_site_page_revision(p_actor uuid, p_slug text, p_revision_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_rev public.site_page_revisions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT * INTO v_rev FROM public.site_page_revisions
  WHERE id = p_revision_id AND slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision_not_found';
  END IF;

  UPDATE public.site_pages SET
    draft = jsonb_build_object(
      'eyebrow', v_rev.eyebrow, 'title', v_rev.title,
      'description', v_rev.description, 'body_md', v_rev.body_md),
    updated_at = now(),
    updated_by = p_actor
  WHERE slug = p_slug;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'page.draft_saved', 'site_page', p_slug,
    jsonb_build_object('title', v_rev.title, 'restored_from_revision', p_revision_id));

  RETURN jsonb_build_object('slug', p_slug, 'has_draft', true);
END;
$$;

REVOKE ALL ON FUNCTION api.restore_site_page_revision(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.restore_site_page_revision(uuid, text, bigint) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. Seed — today's storefront copy, published as revision 1 (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.site_pages (slug, eyebrow, title, description, body_md) VALUES
('delivery-policy', 'Shipping', 'Delivery Policy',
 'Delivery charges, estimates and courier information for orders across Bangladesh.',
$md$## Delivery charges

- Inside Dhaka: ৳80
- Major cities: ৳100
- Outside Dhaka: ৳130
- **Free delivery** when your eligible subtotal reaches ৳3000

## Delivery estimates

These are estimates, not guarantees, and can vary by destination and courier availability.

- Inside Dhaka: usually 1–3 working days
- Outside Dhaka: usually 3–5 working days

Custom-size and handmade items may require additional preparation time before dispatch.

## Courier & tracking

Courier and tracking information will be shared when the parcel is assigned and booked.

## Need help?

For delivery questions, see our [FAQ](/faq) or [contact us](/contact).$md$),

('payment-policy', 'Payment', 'Payment Policy',
 'How payment and verification currently work for Nongorr orders.',
$md$**Current payment verification is manual.**

## How payment works

- Payment uses the Nongorr bKash payment number shown during checkout.
- After sending payment, you enter the TrxID (transaction ID) at checkout.
- A payment screenshot is optional supporting information.
- Your payment is then reviewed manually before the order is confirmed.
- Submitting an order does not mean the payment is instantly verified.

## Wrong amount or payment issues

- If you sent the wrong amount, contact support before doing anything else.
- Do not send a second payment until our team instructs you, so duplicate payments can be avoided.

## Keep your details safe

Pay only to the Nongorr payment number shown during checkout, and keep your TrxID for manual verification.

## Need help?

For payment questions, see our [FAQ](/faq) or [contact us](/contact). You can also [chat on WhatsApp](https://wa.me/8801616510037?text=Hi%20Nongorr!%20I%20have%20a%20payment%20question.).$md$),

('cookie-policy', 'Privacy', 'Cookie & Local Storage Policy',
 'A concise, honest summary of the browser storage Nongorr currently uses.',
$md$## Types of browser storage

- **Cookies** — small files a site or external platform can set in your browser.
- **localStorage** — browser storage that persists until cleared.
- **sessionStorage** — browser storage that lasts for the current tab/session.

## What the current site may store locally

To make the shopping experience work, the current frontend may store browser-local information for:

- Cart contents
- Wishlist
- Checkout preferences
- Local mock orders
- Account UI profile
- Saved addresses
- Measurement profiles
- Dismissed announcement state
- Recently viewed items
- Newsletter demo preference, if used

## What this means

- This local data is stored in your browser on this device.
- It is not automatically synchronized across your devices.
- Clearing your browser storage may remove it.
- Current analytics and advertising tracking are not connected, unless that changes later.

## External links

If you follow a link to an external platform (for example WhatsApp, Facebook or Instagram), that platform may set its own cookies under its own policies.

## Need help?

See our [FAQ](/faq) or [contact us](/contact) with any questions.$md$),

('authenticity-policy', 'Authenticity', 'Cosmetics Authenticity Policy',
 'Our commitment and the checks we aim to make before dispatching cosmetics.',
$md$## Our commitment

Nongorr aims to source cosmetics through trusted suppliers and review available packaging, batch and expiry information. The information available can vary by product and supplier.

## What we aim to check before dispatch

- Packaging and seal condition.
- Batch or lot information where available.
- Expiry or PAO (period-after-opening) information where available.
- Supplier or importer records where available.
- General product condition before the parcel is sent.

## Checking your product on arrival

- Inspect the outer packaging and seals before opening.
- Check batch and expiry markings against the product where shown.
- Keep your invoice or order ID until you are satisfied.

## If you have an authenticity concern

- Stop using the product.
- Retain the packaging and any visible batch/expiry details.
- Keep your order ID.
- Take clear photos of the product, packaging and markings.
- [Contact support](/contact) so the concern can be reviewed.

## Need help?

See our [FAQ](/faq) or [chat on WhatsApp](https://wa.me/8801616510037?text=Hi%20Nongorr!%20I%20have%20an%20authenticity%20concern.).$md$)
ON CONFLICT (slug) DO NOTHING;

-- Initial revision per seeded page (idempotent: only when none exists yet).
INSERT INTO public.site_page_revisions (slug, eyebrow, title, description, body_md)
SELECT p.slug, p.eyebrow, p.title, p.description, p.body_md
FROM public.site_pages p
WHERE NOT EXISTS (SELECT 1 FROM public.site_page_revisions r WHERE r.slug = p.slug);
