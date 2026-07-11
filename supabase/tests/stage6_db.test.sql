-- Stage 6 DB integration test — runs against the EPHEMERAL local Supabase DB in
-- CI (all migrations applied from empty).
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

ROLLBACK;
