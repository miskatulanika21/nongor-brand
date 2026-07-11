-- Stage 6 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty).
--
-- §pages covers the P4 policies CMS (api.get_site_page / list_site_pages /
-- get_site_page_admin / save_site_page_draft / publish_site_page /
-- discard_site_page_draft / list_site_page_revisions /
-- restore_site_page_revision):
--   * grant posture: public read anon-callable; staff RPCs service-role only;
--     both tables deny-all
--   * seed integrity: the 4 pages + initial revisions exist from the migration
--   * draft lifecycle: draft invisible publicly, publish goes live + revision,
--     prune to 20, restore loads a revision into the draft, discard clears it
--   * bounds (invalid_page), unknown slug (page_not_found), publish without a
--     draft (no_draft_to_publish), non-staff rejection, page.* audit rows
--
-- §reports covers the P6 read-only aggregates (api.report_sales_summary /
-- report_top_products / report_coupon_usage / report_courier_performance /
-- report_cod_reconciliation):
--   * grant posture: service-role only
--   * fixture orders across statuses → totals/series/status breakdown honour
--     the confirmed/delivered definitions and the [from, to) range
--   * top products exclude non-confirmed orders; coupon ledger aggregates;
--     courier delivered counts + avg time-to-deliver from the history log;
--     COD expected/collected/settled/outstanding + fees
--   * non-staff rejection
--
-- §banners covers the P3 banner schema + RPCs (api.get_active_banners /
-- list_banners / upsert_banner / set_banner_active / delete_banner) and the
-- extended api.delete_media in-use guard:
--   * grant posture: public read is anon-callable; CRUD is service-role only;
--     the table itself is deny-all (no direct anon/authenticated privileges)
--   * upsert: create + update + banner_not_found; media-library-only images
--     (image_not_in_library); CHECK coherence surfaced as invalid_banner
--   * public read: active + schedule-window filtering, sort ordering, and no
--     updated_by leak
--   * set_banner_active toggling with the computed `live` flag in list_banners
--   * delete_media refuses to orphan a banner image (media_in_use), allows the
--     delete once the banner is gone
--   * every mutation writes its canonical banner.* audit row in-transaction
--
-- Conventions (same as pass2/pass3/pass4/stage4/stage5): expected-SUCCESS runs
-- plainly; expected-FAILURE flips a flag inside a sub-block and RAISE 'FAIL:'
-- if the call did NOT raise (or raised the wrong code); value checks RAISE
-- 'FAIL:' on a violated invariant.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'owner6@test.local'),  -- owner
  ('00000000-0000-0000-0000-0000000000c6', 'cust6@test.local');   -- non-staff

INSERT INTO public.staff_profiles (user_id, role, is_active, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'owner', true, 'Owner Six');

INSERT INTO public.media_assets (id, storage_path, public_url, file_name, content_type, size_bytes) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'test/banner-a.webp',
   'https://test.local/storage/v1/object/public/product-media/test/banner-a.webp',
   'banner-a.webp', 'image/webp', 100),
  ('00000000-0000-0000-0000-0000000000d2', 'test/banner-b.webp',
   'https://test.local/storage/v1/object/public/product-media/test/banner-b.webp',
   'banner-b.webp', 'image/webp', 100);

-- ============================================================
-- §banners-1 — grant posture
-- ============================================================
DO $$
DECLARE r text;
BEGIN
  -- public read: anon + authenticated + service_role may EXECUTE
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT has_function_privilege(r, 'api.get_active_banners()', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % must hold EXECUTE on api.get_active_banners', r;
    END IF;
  END LOOP;

  -- CRUD: service_role only
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r, 'api.list_banners(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on api.list_banners', r;
    END IF;
    IF has_function_privilege(r, 'api.upsert_banner(uuid,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on api.upsert_banner', r;
    END IF;
    IF has_function_privilege(r, 'api.set_banner_active(uuid,uuid,boolean)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on api.set_banner_active', r;
    END IF;
    IF has_function_privilege(r, 'api.delete_banner(uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on api.delete_banner', r;
    END IF;
    -- deny-all table: no direct privileges at all
    IF has_table_privilege(r, 'public.banners', 'SELECT')
       OR has_table_privilege(r, 'public.banners', 'INSERT')
       OR has_table_privilege(r, 'public.banners', 'UPDATE')
       OR has_table_privilege(r, 'public.banners', 'DELETE') THEN
      RAISE EXCEPTION 'FAIL: % should hold no direct privilege on public.banners', r;
    END IF;
  END LOOP;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.banners'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS must be enabled on public.banners';
  END IF;
END $$;

-- ============================================================
-- §banners-2 — create/update via upsert_banner (+ audit, + guards)
-- ============================================================
DO $$
DECLARE
  v jsonb; v_id uuid; v_raised boolean;
BEGIN
  -- create
  v := api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
    'title', 'Eid Edit', 'subtitle', 'Festive', 'eyebrow', 'New',
    'cta_label', 'Shop', 'cta_to', '/shop',
    'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-a.webp',
    'sort_order', 10, 'is_active', true));
  IF NOT (v->>'created')::boolean THEN RAISE EXCEPTION 'FAIL: expected created=true'; END IF;
  v_id := (v->'banner'->>'id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'banner.created' AND target_id = v_id::text) THEN
    RAISE EXCEPTION 'FAIL: banner.created audit row missing';
  END IF;

  -- update by id
  v := api.upsert_banner('00000000-0000-0000-0000-0000000000b1',
    (v->'banner') || jsonb_build_object('title', 'Eid Edit v2'));
  IF (v->>'created')::boolean THEN RAISE EXCEPTION 'FAIL: expected created=false on update'; END IF;
  IF (v->'banner'->>'title') <> 'Eid Edit v2' THEN
    RAISE EXCEPTION 'FAIL: update did not persist title';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'banner.updated' AND target_id = v_id::text) THEN
    RAISE EXCEPTION 'FAIL: banner.updated audit row missing';
  END IF;

  -- unknown id → banner_not_found
  v_raised := false;
  BEGIN
    PERFORM api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
      'id', '00000000-0000-0000-0000-00000000ffff', 'title', 'x',
      'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-a.webp'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'banner_not_found' THEN
      RAISE EXCEPTION 'FAIL: expected banner_not_found, got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: unknown id upsert did not raise'; END IF;

  -- image outside the media library → image_not_in_library
  v_raised := false;
  BEGIN
    PERFORM api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
      'title', 'x', 'image_url', 'https://evil.example/hotlink.webp'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'image_not_in_library' THEN
      RAISE EXCEPTION 'FAIL: expected image_not_in_library, got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: non-library image accepted'; END IF;

  -- CTA label without destination → invalid_banner (banners_cta_coherent)
  v_raised := false;
  BEGIN
    PERFORM api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
      'title', 'x', 'cta_label', 'Shop',
      'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-a.webp'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'invalid_banner' THEN
      RAISE EXCEPTION 'FAIL: expected invalid_banner (cta), got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: cta incoherence accepted'; END IF;

  -- external CTA destination → invalid_banner (cta_to LIKE ''/%'')
  v_raised := false;
  BEGIN
    PERFORM api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
      'title', 'x', 'cta_label', 'Shop', 'cta_to', 'https://evil.example',
      'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-a.webp'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'invalid_banner' THEN
      RAISE EXCEPTION 'FAIL: expected invalid_banner (external cta), got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: external cta destination accepted'; END IF;
END $$;

-- ============================================================
-- §banners-3 — public read: window filtering, ordering, no leak
-- ============================================================
DO $$
DECLARE
  v jsonb; v_hero uuid; v_future uuid; v_expired uuid;
BEGIN
  -- a second live banner that must SORT FIRST (lower sort_order than Eid Edit's 10)
  v_hero := (api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
    'title', 'Hero First', 'sort_order', 1, 'is_active', true,
    'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-b.webp'
  ))->'banner'->>'id')::uuid;

  -- future-scheduled: active but starts tomorrow → not publicly visible
  v_future := (api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
    'title', 'Future', 'sort_order', 0, 'is_active', true,
    'starts_at', (now() + interval '1 day')::text,
    'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-b.webp'
  ))->'banner'->>'id')::uuid;

  -- expired: active but ended an hour ago → not publicly visible
  v_expired := (api.upsert_banner('00000000-0000-0000-0000-0000000000b1', jsonb_build_object(
    'title', 'Expired', 'sort_order', 0, 'is_active', true,
    'ends_at', (now() - interval '1 hour')::text,
    'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-b.webp'
  ))->'banner'->>'id')::uuid;

  v := api.get_active_banners();

  IF jsonb_array_length(v) <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 publicly visible banners, got %', jsonb_array_length(v);
  END IF;
  IF (v->0->>'title') <> 'Hero First' THEN
    RAISE EXCEPTION 'FAIL: lowest sort_order must lead, got %', v->0->>'title';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
             WHERE (e->>'id')::uuid IN (v_future, v_expired)) THEN
    RAISE EXCEPTION 'FAIL: out-of-window banner publicly visible';
  END IF;
  IF (SELECT bool_or(e ? 'updated_by') FROM jsonb_array_elements(v) e) THEN
    RAISE EXCEPTION 'FAIL: public payload leaks updated_by';
  END IF;

  -- list_banners sees all four, with the computed live flag
  v := api.list_banners('00000000-0000-0000-0000-0000000000b1');
  IF jsonb_array_length(v) <> 4 THEN
    RAISE EXCEPTION 'FAIL: staff list expected 4 banners, got %', jsonb_array_length(v);
  END IF;
  IF (SELECT (e->>'live')::boolean FROM jsonb_array_elements(v) e
      WHERE (e->>'id')::uuid = v_future) THEN
    RAISE EXCEPTION 'FAIL: future-scheduled banner reported live';
  END IF;
END $$;

-- ============================================================
-- §banners-4 — toggle, delete, media in-use guard, authorization
-- ============================================================
DO $$
DECLARE
  v jsonb; v_id uuid; v_raised boolean;
BEGIN
  SELECT id INTO v_id FROM public.banners WHERE title = 'Hero First';

  -- disable → not live, audit row
  v := api.set_banner_active('00000000-0000-0000-0000-0000000000b1', v_id, false);
  IF (v->>'is_active')::boolean THEN RAISE EXCEPTION 'FAIL: toggle off did not persist'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'banner.status_changed' AND target_id = v_id::text) THEN
    RAISE EXCEPTION 'FAIL: banner.status_changed audit row missing';
  END IF;

  -- delete_media refuses while ANY banner still references asset b (3 rows do)
  v_raised := false;
  BEGIN
    PERFORM api.delete_media('00000000-0000-0000-0000-0000000000d2',
                             '00000000-0000-0000-0000-0000000000b1');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'media_in_use' THEN
      RAISE EXCEPTION 'FAIL: expected media_in_use, got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: delete_media orphaned a banner image'; END IF;

  -- remove every banner on asset b, then the media delete succeeds
  DELETE FROM public.banners
  WHERE image_url = 'https://test.local/storage/v1/object/public/product-media/test/banner-b.webp'
    AND id <> v_id;
  PERFORM api.delete_banner('00000000-0000-0000-0000-0000000000b1', v_id);
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'banner.deleted' AND target_id = v_id::text) THEN
    RAISE EXCEPTION 'FAIL: banner.deleted audit row missing';
  END IF;
  PERFORM api.delete_media('00000000-0000-0000-0000-0000000000d2',
                           '00000000-0000-0000-0000-0000000000b1');

  -- delete of a missing banner → banner_not_found
  v_raised := false;
  BEGIN
    PERFORM api.delete_banner('00000000-0000-0000-0000-0000000000b1', v_id);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'banner_not_found' THEN
      RAISE EXCEPTION 'FAIL: expected banner_not_found, got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: double delete did not raise'; END IF;

  -- non-staff actors are rejected on every staff RPC
  v_raised := false;
  BEGIN
    PERFORM api.list_banners('00000000-0000-0000-0000-0000000000c6');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'actor_not_authorized' THEN
      RAISE EXCEPTION 'FAIL: expected actor_not_authorized, got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: non-staff read allowed'; END IF;

  v_raised := false;
  BEGIN
    PERFORM api.upsert_banner('00000000-0000-0000-0000-0000000000c6', jsonb_build_object(
      'title', 'x',
      'image_url', 'https://test.local/storage/v1/object/public/product-media/test/banner-a.webp'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'actor_not_authorized' THEN
      RAISE EXCEPTION 'FAIL: expected actor_not_authorized, got %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: non-staff write allowed'; END IF;
END $$;

-- ============================================================
-- §pages-1 — grant posture + seed integrity
-- ============================================================
DO $$
DECLARE r text; v jsonb; v_count int;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT has_function_privilege(r, 'api.get_site_page(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % must hold EXECUTE on api.get_site_page', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r, 'api.list_site_pages(uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'api.save_site_page_draft(uuid,text,jsonb)', 'EXECUTE')
       OR has_function_privilege(r, 'api.publish_site_page(uuid,text)', 'EXECUTE')
       OR has_function_privilege(r, 'api.discard_site_page_draft(uuid,text)', 'EXECUTE')
       OR has_function_privilege(r, 'api.list_site_page_revisions(uuid,text)', 'EXECUTE')
       OR has_function_privilege(r, 'api.restore_site_page_revision(uuid,text,bigint)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on staff page RPCs', r;
    END IF;
    IF has_table_privilege(r, 'public.site_pages', 'SELECT')
       OR has_table_privilege(r, 'public.site_page_revisions', 'SELECT') THEN
      RAISE EXCEPTION 'FAIL: % should hold no direct privilege on page tables', r;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_pages'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_page_revisions'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS must be enabled on both page tables';
  END IF;

  -- migration seed: 4 pages, each with an initial revision
  SELECT count(*) INTO v_count FROM public.site_pages;
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL: expected 4 seeded pages, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.site_page_revisions;
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL: expected 4 initial revisions, got %', v_count; END IF;

  v := api.get_site_page('delivery-policy');
  IF v->>'title' <> 'Delivery Policy' OR v->>'body_md' NOT LIKE '%## Delivery charges%' THEN
    RAISE EXCEPTION 'FAIL: seeded public read wrong';
  END IF;
  IF v ? 'draft' OR v ? 'updated_by' THEN
    RAISE EXCEPTION 'FAIL: public read leaks draft/updated_by';
  END IF;
  IF api.get_site_page('return-policy') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: non-CMS slug should return NULL';
  END IF;
END $$;

-- ============================================================
-- §pages-2 — draft → publish → revision → restore → discard (+ audits)
-- ============================================================
DO $$
DECLARE v jsonb; v_count int; v_rev_id bigint; v_raised boolean;
BEGIN
  -- publish without a draft is refused
  v_raised := false;
  BEGIN
    PERFORM api.publish_site_page('00000000-0000-0000-0000-0000000000b1', 'delivery-policy');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'no_draft_to_publish' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: publish without draft allowed'; END IF;

  -- save a draft; the public read must keep serving the published copy
  PERFORM api.save_site_page_draft('00000000-0000-0000-0000-0000000000b1', 'delivery-policy',
    jsonb_build_object('eyebrow', 'Shipping', 'title', 'Delivery Policy v2',
                       'description', 'desc', 'body_md', '## New body'));
  IF (api.get_site_page('delivery-policy'))->>'title' <> 'Delivery Policy' THEN
    RAISE EXCEPTION 'FAIL: draft leaked to public read';
  END IF;
  SELECT (e->>'has_draft')::boolean INTO v_raised
  FROM jsonb_array_elements(api.list_site_pages('00000000-0000-0000-0000-0000000000b1')) e
  WHERE e->>'slug' = 'delivery-policy';
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: draft flag not set in list'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'page.draft_saved' AND target_id = 'delivery-policy') THEN
    RAISE EXCEPTION 'FAIL: page.draft_saved audit missing';
  END IF;

  -- publish: live + second revision + draft cleared + audit
  PERFORM api.publish_site_page('00000000-0000-0000-0000-0000000000b1', 'delivery-policy');
  IF (api.get_site_page('delivery-policy'))->>'title' <> 'Delivery Policy v2' THEN
    RAISE EXCEPTION 'FAIL: publish did not go live';
  END IF;
  SELECT count(*) INTO v_count FROM public.site_page_revisions WHERE slug = 'delivery-policy';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 revisions, got %', v_count; END IF;
  IF (SELECT draft FROM public.site_pages WHERE slug = 'delivery-policy') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: draft not cleared on publish';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'page.published' AND target_id = 'delivery-policy') THEN
    RAISE EXCEPTION 'FAIL: page.published audit missing';
  END IF;

  -- restore revision 1 into the draft (not straight to live)
  SELECT min(id) INTO v_rev_id FROM public.site_page_revisions WHERE slug = 'delivery-policy';
  PERFORM api.restore_site_page_revision('00000000-0000-0000-0000-0000000000b1',
                                         'delivery-policy', v_rev_id);
  IF (SELECT draft->>'title' FROM public.site_pages WHERE slug = 'delivery-policy')
     <> 'Delivery Policy' THEN
    RAISE EXCEPTION 'FAIL: restore did not load revision into draft';
  END IF;
  IF (api.get_site_page('delivery-policy'))->>'title' <> 'Delivery Policy v2' THEN
    RAISE EXCEPTION 'FAIL: restore must not change the live page';
  END IF;

  -- discard clears the draft + audit
  PERFORM api.discard_site_page_draft('00000000-0000-0000-0000-0000000000b1', 'delivery-policy');
  IF (SELECT draft FROM public.site_pages WHERE slug = 'delivery-policy') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: discard did not clear draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                 WHERE action = 'page.draft_discarded' AND target_id = 'delivery-policy') THEN
    RAISE EXCEPTION 'FAIL: page.draft_discarded audit missing';
  END IF;
END $$;

-- ============================================================
-- §pages-3 — revision prune to 20 across many publishes
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  FOR i IN 1..21 LOOP
    PERFORM api.save_site_page_draft('00000000-0000-0000-0000-0000000000b1', 'payment-policy',
      jsonb_build_object('title', 'Payment Policy ' || i, 'body_md', '## body ' || i));
    PERFORM api.publish_site_page('00000000-0000-0000-0000-0000000000b1', 'payment-policy');
  END LOOP;
  SELECT count(*) INTO v_count FROM public.site_page_revisions WHERE slug = 'payment-policy';
  IF v_count <> 20 THEN RAISE EXCEPTION 'FAIL: prune expected 20 revisions, got %', v_count; END IF;
END $$;

-- ============================================================
-- §pages-4 — bounds + unknown slug + authorization
-- ============================================================
DO $$
DECLARE v_raised boolean;
BEGIN
  -- empty body rejected
  v_raised := false;
  BEGIN
    PERFORM api.save_site_page_draft('00000000-0000-0000-0000-0000000000b1', 'delivery-policy',
      jsonb_build_object('title', 'x', 'body_md', ''));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'invalid_page' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: empty body accepted'; END IF;

  -- unknown slug rejected
  v_raised := false;
  BEGIN
    PERFORM api.save_site_page_draft('00000000-0000-0000-0000-0000000000b1', 'not-a-page',
      jsonb_build_object('title', 'x', 'body_md', 'y'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'page_not_found' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: unknown slug accepted'; END IF;

  -- non-staff rejected
  v_raised := false;
  BEGIN
    PERFORM api.list_site_pages('00000000-0000-0000-0000-0000000000c6');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'actor_not_authorized' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: non-staff page read allowed'; END IF;
END $$;

-- ============================================================
-- §reports-0 — fixtures (category/product, orders across statuses,
--              coupon redemption, COD shipment + delivery history)
-- ============================================================
INSERT INTO public.product_categories (slug, name, sort_order) VALUES ('rpt-cat', 'Report Cat', 90);
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'rpt-prod', 'rpt-prod', 'Report Product', id, 1000, 50
  FROM public.product_categories WHERE slug = 'rpt-cat';

INSERT INTO public.orders (order_no, guest_token_hash, customer_name, customer_phone,
  ship_district, ship_zone, ship_address, subtotal, discount, shipping_fee, total,
  payment_method, status, idempotency_key) VALUES
  ('NGR-RPT-1', repeat('1',64), 'C', '01700000001', 'Dhaka','dhaka','Rd', 2000, 200, 80, 1880, 'bkash', 'delivered', 'idem-rpt1'),
  ('NGR-RPT-2', repeat('2',64), 'C', '01700000002', 'Dhaka','dhaka','Rd', 1000, 0, 80, 1080, 'cod', 'confirmed', 'idem-rpt2'),
  ('NGR-RPT-3', repeat('3',64), 'C', '01700000003', 'Dhaka','dhaka','Rd', 500, 0, 80, 580, 'cod', 'cancelled', 'idem-rpt3'),
  ('NGR-RPT-4', repeat('4',64), 'C', '01700000004', 'Dhaka','dhaka','Rd', 700, 0, 80, 780, 'bkash', 'pending_payment', 'idem-rpt4');

INSERT INTO public.order_items (order_id, product_id, name, unit_price, qty, line_total)
SELECT o.id, p.id, 'Report Product', v.unit_price, v.qty, v.unit_price * v.qty
FROM (VALUES ('NGR-RPT-1', 1000, 2), ('NGR-RPT-2', 1000, 1), ('NGR-RPT-3', 500, 1))
  AS v(order_no, unit_price, qty)
JOIN public.orders o ON o.order_no = v.order_no
JOIN public.products p ON p.code = 'rpt-prod';

INSERT INTO public.coupons (code, type, value, min_subtotal, active) VALUES ('RPTTEST', 'fixed', 200, 0, false);
INSERT INTO public.coupon_usages (coupon_code, order_id, scope, amount)
SELECT 'RPTTEST', id, repeat('1',64), 200 FROM public.orders WHERE order_no = 'NGR-RPT-1';

-- successful COD shipment, delivered 5h after booking, collected but unsettled
INSERT INTO public.shipments (order_id, provider, booking_status, payment_collection_mode,
  cod_amount, courier_fee, booked_at, cod_collected_at)
SELECT id, 'steadfast', 'success', 'cod', 1880, 120, now() - interval '6 hours', now() - interval '30 minutes'
FROM public.orders WHERE order_no = 'NGR-RPT-1';
INSERT INTO public.order_status_history (order_id, from_status, to_status, reason, created_at)
SELECT id, 'shipped', 'delivered', 'report test', now() - interval '1 hour'
FROM public.orders WHERE order_no = 'NGR-RPT-1';

-- ============================================================
-- §reports-1 — grant posture: service-role only
-- ============================================================
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r, 'api.report_sales_summary(uuid,timestamptz,timestamptz)', 'EXECUTE')
       OR has_function_privilege(r, 'api.report_top_products(uuid,timestamptz,timestamptz,integer)', 'EXECUTE')
       OR has_function_privilege(r, 'api.report_coupon_usage(uuid,timestamptz,timestamptz)', 'EXECUTE')
       OR has_function_privilege(r, 'api.report_courier_performance(uuid,timestamptz,timestamptz)', 'EXECUTE')
       OR has_function_privilege(r, 'api.report_cod_reconciliation(uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % should not hold EXECUTE on report RPCs', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'api.report_sales_summary(uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role must hold EXECUTE on report RPCs';
  END IF;
END $$;

-- ============================================================
-- §reports-2 — aggregates honour the definitions and the range
-- ============================================================
DO $$
DECLARE v jsonb; v_raised boolean;
BEGIN
  v := api.report_sales_summary('00000000-0000-0000-0000-0000000000b1',
        now() - interval '1 day', now() + interval '1 day');
  IF (v->'totals'->>'orders_count')::int <> 4 THEN
    RAISE EXCEPTION 'FAIL: orders_count %', v->'totals'->>'orders_count'; END IF;
  IF (v->'totals'->>'confirmed_count')::int <> 2
     OR (v->'totals'->>'confirmed_revenue')::int <> 2960 THEN
    RAISE EXCEPTION 'FAIL: confirmed %/% ', v->'totals'->>'confirmed_count', v->'totals'->>'confirmed_revenue'; END IF;
  IF (v->'totals'->>'delivered_revenue')::int <> 1880
     OR (v->'totals'->>'cancelled_count')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: delivered/cancelled totals'; END IF;
  IF (v->'totals'->>'aov')::int <> 1480 THEN
    RAISE EXCEPTION 'FAIL: aov %', v->'totals'->>'aov'; END IF;
  IF jsonb_array_length(v->'by_day') < 1 OR jsonb_array_length(v->'by_status') <> 4 THEN
    RAISE EXCEPTION 'FAIL: by_day/by_status shape'; END IF;

  -- an empty range returns zeros, not NULLs
  v := api.report_sales_summary('00000000-0000-0000-0000-0000000000b1',
        now() - interval '10 years', now() - interval '9 years');
  IF (v->'totals'->>'orders_count')::int <> 0 OR (v->'totals'->>'confirmed_revenue')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: empty range not zeroed'; END IF;

  -- top products: confirmed set only (2000 + 1000; the cancelled 500 excluded)
  v := api.report_top_products('00000000-0000-0000-0000-0000000000b1',
        now() - interval '1 day', now() + interval '1 day', 10);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
    WHERE e->>'name' = 'Report Product' AND (e->>'revenue')::int = 3000
      AND (e->>'units')::int = 3 AND (e->>'orders')::int = 2) THEN
    RAISE EXCEPTION 'FAIL: top products: %', v; END IF;

  -- coupon ledger
  v := api.report_coupon_usage('00000000-0000-0000-0000-0000000000b1',
        now() - interval '1 day', now() + interval '1 day');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
    WHERE e->>'coupon_code' = 'RPTTEST' AND (e->>'uses')::int = 1
      AND (e->>'discount_total')::int = 200 AND (e->>'live_uses')::int = 1) THEN
    RAISE EXCEPTION 'FAIL: coupon usage: %', v; END IF;

  -- courier performance: 1 booked+delivered on steadfast, ~5h to deliver
  v := api.report_courier_performance('00000000-0000-0000-0000-0000000000b1',
        now() - interval '1 day', now() + interval '1 day');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
    WHERE e->>'provider' = 'steadfast' AND (e->>'booked')::int = 1
      AND (e->>'delivered')::int = 1
      AND (e->>'avg_hours_to_deliver')::int BETWEEN 4 AND 6) THEN
    RAISE EXCEPTION 'FAIL: courier performance: %', v; END IF;

  -- COD reconciliation: expected=collected=outstanding=1880, fee 120, settled 0
  v := api.report_cod_reconciliation('00000000-0000-0000-0000-0000000000b1',
        now() - interval '1 day', now() + interval '1 day');
  IF (v->'totals'->>'cod_expected')::numeric <> 1880
     OR (v->'totals'->>'cod_collected')::numeric <> 1880
     OR (v->'totals'->>'cod_settled')::numeric <> 0
     OR (v->'totals'->>'cod_outstanding')::numeric <> 1880
     OR (v->'totals'->>'courier_fees')::numeric <> 120 THEN
    RAISE EXCEPTION 'FAIL: cod totals: %', v->'totals'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'by_provider') e
    WHERE e->>'provider' = 'steadfast' AND (e->>'cod_shipments')::int = 1) THEN
    RAISE EXCEPTION 'FAIL: cod by_provider'; END IF;

  -- non-staff rejected
  v_raised := false;
  BEGIN
    PERFORM api.report_sales_summary('00000000-0000-0000-0000-0000000000c6',
      now() - interval '1 day', now());
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM <> 'actor_not_authorized' THEN RAISE; END IF;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: non-staff report read allowed'; END IF;
END $$;

ROLLBACK;
