-- Stage 6 P5 — persisted size charts (structured, admin-editable).
--
-- The admin Size Settings screen was a hidden "Coming soon" placeholder (its
-- old fields never saved), while the storefront size guide rendered three
-- HARDCODED chart arrays (kurti / three-piece / girls) — real tables whose
-- numbers also power the size starting-point helper, but only editable by a
-- developer. This moves those charts into an RPC-only table (seeded
-- byte-identical), so operators fix a measurement in the admin grid instead
-- of asking for a deploy. The custom-measurement ILLUSTRATION stays a static
-- image (instructional graphic, not data); saree keeps its prose section.
--
-- Model: one row per chart. `columns` is the ordered list of measurement
-- column names; each row is {label, values[], popular} with values aligned to
-- columns (validated in the RPC). `label_header` names the first column
-- ("Size" / "Age"); `helper_column` names the column the storefront
-- starting-point helper compares against (NULL = chart excluded from helper).
--
-- Posture: RPC-only deny-all; public read anon-granted (active charts only);
-- staff CRUD service-role only (app gates `sizes.manage`) with SQL-side
-- active-staff re-checks and canonical size_chart.* audit rows.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. size_charts — one row per chart (columns + rows as validated jsonb)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.size_charts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  unit          text        NOT NULL DEFAULT 'in' CHECK (unit IN ('in','cm')),
  label_header  text        NOT NULL DEFAULT 'Size' CHECK (char_length(label_header) BETWEEN 1 AND 40),
  helper_column text        CHECK (helper_column IS NULL OR char_length(helper_column) <= 40),
  note          text        CHECK (note IS NULL OR char_length(note) <= 300),
  columns       jsonb       NOT NULL,
  rows          jsonb       NOT NULL DEFAULT '[]',
  sort_order    integer     NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
  is_active     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.size_charts IS
  'Storefront size charts (Stage 6 P5). RPC-only (deny-all RLS). Public read via api.get_size_charts (active only); staff CRUD via api.upsert_size_chart/set_size_chart_active/delete_size_chart (app gates sizes.manage). columns = ordered measurement names; rows = [{label, values[], popular}] aligned to columns (validated in the RPC).';

ALTER TABLE public.size_charts ENABLE ROW LEVEL SECURITY;
-- deny-all: no policies. Only service-role RPCs read/write.

REVOKE ALL ON TABLE public.size_charts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.size_charts TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. get_size_charts — public storefront read (active charts, no staff ids)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.get_size_charts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'unit', c.unit,
    'label_header', c.label_header, 'helper_column', c.helper_column,
    'note', c.note, 'columns', c.columns, 'rows', c.rows
  ) ORDER BY c.sort_order, c.name), '[]'::jsonb)
  FROM public.size_charts c
  WHERE c.is_active;
$$;

REVOKE ALL ON FUNCTION api.get_size_charts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_size_charts() TO anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. list_size_charts — staff read (all charts)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_size_charts(p_actor uuid)
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

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.sort_order, c.name), '[]'::jsonb) INTO v_rows
  FROM public.size_charts c;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.list_size_charts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_size_charts(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. upsert_size_chart — create/edit with deep structural validation + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.upsert_size_chart(p_actor uuid, p_chart jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id            uuid;
  v_created       boolean := false;
  v_row           public.size_charts%ROWTYPE;
  v_slug          text := lower(btrim(COALESCE(p_chart->>'slug', '')));
  v_name          text := btrim(COALESCE(p_chart->>'name', ''));
  v_unit          text := COALESCE(NULLIF(btrim(COALESCE(p_chart->>'unit', '')), ''), 'in');
  v_label_header  text := COALESCE(NULLIF(btrim(COALESCE(p_chart->>'label_header', '')), ''), 'Size');
  v_helper_column text := NULLIF(btrim(COALESCE(p_chart->>'helper_column', '')), '');
  v_note          text := NULLIF(btrim(COALESCE(p_chart->>'note', '')), '');
  v_columns       jsonb := COALESCE(p_chart->'columns', '[]'::jsonb);
  v_rows          jsonb := COALESCE(p_chart->'rows', '[]'::jsonb);
  v_sort          integer := COALESCE((p_chart->>'sort_order')::integer, 0);
  v_active        boolean := COALESCE((p_chart->>'is_active')::boolean, false);
  v_col           jsonb;
  v_r             jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  v_id := NULLIF(btrim(COALESCE(p_chart->>'id', '')), '')::uuid;

  -- ── Deep structural validation (stable code: invalid_size_chart) ──────────
  IF jsonb_typeof(v_columns) <> 'array'
     OR jsonb_array_length(v_columns) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'invalid_size_chart';
  END IF;
  FOR v_col IN SELECT * FROM jsonb_array_elements(v_columns) LOOP
    IF jsonb_typeof(v_col) <> 'string'
       OR char_length(v_col #>> '{}') NOT BETWEEN 1 AND 40 THEN
      RAISE EXCEPTION 'invalid_size_chart';
    END IF;
  END LOOP;

  IF jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) > 30 THEN
    RAISE EXCEPTION 'invalid_size_chart';
  END IF;
  FOR v_r IN SELECT * FROM jsonb_array_elements(v_rows) LOOP
    IF jsonb_typeof(v_r) <> 'object'
       OR char_length(COALESCE(v_r->>'label', '')) NOT BETWEEN 1 AND 40
       OR jsonb_typeof(v_r->'values') <> 'array'
       OR jsonb_array_length(v_r->'values') <> jsonb_array_length(v_columns) THEN
      RAISE EXCEPTION 'invalid_size_chart';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'values') val
               WHERE jsonb_typeof(val) <> 'string' OR char_length(val #>> '{}') > 20) THEN
      RAISE EXCEPTION 'invalid_size_chart';
    END IF;
  END LOOP;

  -- Normalize rows to exactly {label, values, popular}.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', btrim(r->>'label'),
    'values', r->'values',
    'popular', COALESCE((r->>'popular')::boolean, false))), '[]'::jsonb)
  INTO v_rows
  FROM jsonb_array_elements(v_rows) r;

  -- The helper column must be one of the chart's columns.
  IF v_helper_column IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_columns) col WHERE col = v_helper_column
  ) THEN
    RAISE EXCEPTION 'invalid_size_chart';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.size_charts (
      slug, name, unit, label_header, helper_column, note,
      columns, rows, sort_order, is_active, updated_by
    ) VALUES (
      v_slug, v_name, v_unit, v_label_header, v_helper_column, v_note,
      v_columns, v_rows, v_sort, v_active, p_actor
    )
    RETURNING * INTO v_row;
    v_created := true;
  ELSE
    UPDATE public.size_charts SET
      slug          = v_slug,
      name          = v_name,
      unit          = v_unit,
      label_header  = v_label_header,
      helper_column = v_helper_column,
      note          = v_note,
      columns       = v_columns,
      rows          = v_rows,
      sort_order    = v_sort,
      is_active     = v_active,
      updated_at    = now(),
      updated_by    = p_actor
    WHERE id = v_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'size_chart_not_found';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor,
    CASE WHEN v_created THEN 'size_chart.created' ELSE 'size_chart.updated' END,
    'size_chart', v_row.id::text,
    jsonb_build_object('name', v_row.name, 'slug', v_row.slug,
                       'rows', jsonb_array_length(v_row.rows), 'is_active', v_row.is_active));

  RETURN jsonb_build_object('chart', to_jsonb(v_row), 'created', v_created);
EXCEPTION
  WHEN check_violation OR not_null_violation OR unique_violation
    OR invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_size_chart';
END;
$$;

REVOKE ALL ON FUNCTION api.upsert_size_chart(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.upsert_size_chart(uuid, jsonb) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. set_size_chart_active — show/hide on the storefront + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.set_size_chart_active(p_actor uuid, p_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.size_charts%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  UPDATE public.size_charts SET
    is_active = p_active, updated_at = now(), updated_by = p_actor
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'size_chart_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'size_chart.status_changed', 'size_chart', p_id::text,
    jsonb_build_object('name', v_row.name, 'is_active', p_active));

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION api.set_size_chart_active(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_size_chart_active(uuid, uuid, boolean) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. delete_size_chart — hard delete + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.delete_size_chart(p_actor uuid, p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  DELETE FROM public.size_charts WHERE id = p_id RETURNING name INTO v_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'size_chart_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'size_chart.deleted', 'size_chart', p_id::text,
    jsonb_build_object('name', v_name));
END;
$$;

REVOKE ALL ON FUNCTION api.delete_size_chart(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_size_chart(uuid, uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. Seed — today's hardcoded storefront charts, byte-identical (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.size_charts
  (slug, name, unit, label_header, helper_column, columns, rows, sort_order, is_active)
VALUES
('kurti', 'Kurti', 'in', 'Size', 'Bust',
 '["Bust","Waist","Hip","Shoulder","Sleeve","Length"]',
 '[
   {"label":"XS","values":["32","28","36","13.5","17","42"],"popular":false},
   {"label":"S","values":["34","30","38","14","17.5","42"],"popular":false},
   {"label":"M","values":["36","32","40","14.5","18","43"],"popular":true},
   {"label":"L","values":["38","34","42","15","18","44"],"popular":true},
   {"label":"XL","values":["40","36","44","15.5","18.5","44"],"popular":false},
   {"label":"XXL","values":["42","38","46","16","19","45"],"popular":false},
   {"label":"3XL","values":["44","40","48","16.5","19","45"],"popular":false}
 ]', 0, true),
('three-piece', 'Three Piece', 'in', 'Size', 'Bust',
 '["Bust","Waist","Hip","Shoulder","Kameez Length"]',
 '[
   {"label":"S","values":["34","30","38","14","42"],"popular":false},
   {"label":"M","values":["36","32","40","14.5","43"],"popular":true},
   {"label":"L","values":["38","34","42","15","44"],"popular":true},
   {"label":"XL","values":["40","36","44","15.5","44"],"popular":false},
   {"label":"XXL","values":["42","38","46","16","45"],"popular":false}
 ]', 1, true),
('girls', 'Girls Dress', 'in', 'Age', 'Chest',
 '["Chest","Waist","Dress Length"]',
 '[
   {"label":"2–3 Years","values":["22","20","22"],"popular":false},
   {"label":"4–5 Years","values":["24","22","26"],"popular":false},
   {"label":"6–7 Years","values":["26","24","30"],"popular":false},
   {"label":"8–9 Years","values":["28","26","34"],"popular":false},
   {"label":"10–11 Years","values":["30","28","38"],"popular":false},
   {"label":"12–13 Years","values":["32","30","40"],"popular":false}
 ]', 2, true)
ON CONFLICT (slug) DO NOTHING;
