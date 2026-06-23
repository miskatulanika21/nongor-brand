-- Migration 17: Transactional catalog write RPCs (canonical audit) + atomic reorder.
-- Version: 20260623230000
--
-- Brings product/category writes up to the staff/inventory standard: the mutation
-- and its canonical audit row are written inside ONE transaction by a SECURITY
-- DEFINER api.* function (service-role-only EXECUTE), so they can never diverge,
-- and category reorder is a single atomic UPDATE instead of a TS loop.
--
-- Product payloads are passed as a snake_case jsonb object (category already
-- resolved to category_id by the server). products.stock is never written here,
-- so the stock-write guard (migration 15) is respected.

-- ---- api.save_product ------------------------------------------------------
CREATE OR REPLACE FUNCTION api.save_product(
  p_mode    text,
  p_code    text,
  p_payload jsonb,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_slug text;
  v_colors text[];
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF p_mode NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;

  v_colors := CASE WHEN jsonb_typeof(p_payload -> 'colors') = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'colors')) ELSE NULL END;

  IF p_mode = 'create' THEN
    INSERT INTO public.products (
      code, name, slug, category_id, status, price, sale_price, custom_size, custom_size_charge,
      is_new, is_handmade, is_best_seller, has_video, description, color, colors, fabric, occasion,
      care, length, work_type, pieces_included, shade, volume, skin_type, expiry, batch,
      ingredients, how_to_use, safety, blouse_piece, stitched
    ) VALUES (
      p_code,
      p_payload ->> 'name', p_payload ->> 'slug', (p_payload ->> 'category_id')::uuid,
      coalesce(p_payload ->> 'status', 'draft'),
      (p_payload ->> 'price')::int, (p_payload ->> 'sale_price')::int,
      coalesce((p_payload ->> 'custom_size')::boolean, false), (p_payload ->> 'custom_size_charge')::int,
      coalesce((p_payload ->> 'is_new')::boolean, false),
      coalesce((p_payload ->> 'is_handmade')::boolean, false),
      coalesce((p_payload ->> 'is_best_seller')::boolean, false),
      coalesce((p_payload ->> 'has_video')::boolean, false),
      coalesce(p_payload ->> 'description', ''),
      p_payload ->> 'color', v_colors, p_payload ->> 'fabric', p_payload ->> 'occasion',
      p_payload ->> 'care', p_payload ->> 'length', p_payload ->> 'work_type',
      p_payload ->> 'pieces_included', p_payload ->> 'shade', p_payload ->> 'volume',
      p_payload ->> 'skin_type', p_payload ->> 'expiry', p_payload ->> 'batch',
      p_payload ->> 'ingredients', p_payload ->> 'how_to_use', p_payload ->> 'safety',
      (p_payload ->> 'blouse_piece')::boolean, (p_payload ->> 'stitched')::boolean
    )
    RETURNING code, slug INTO v_code, v_slug;
  ELSE
    UPDATE public.products SET
      name = p_payload ->> 'name', slug = p_payload ->> 'slug',
      category_id = (p_payload ->> 'category_id')::uuid,
      status = coalesce(p_payload ->> 'status', 'draft'),
      price = (p_payload ->> 'price')::int, sale_price = (p_payload ->> 'sale_price')::int,
      custom_size = coalesce((p_payload ->> 'custom_size')::boolean, false),
      custom_size_charge = (p_payload ->> 'custom_size_charge')::int,
      is_new = coalesce((p_payload ->> 'is_new')::boolean, false),
      is_handmade = coalesce((p_payload ->> 'is_handmade')::boolean, false),
      is_best_seller = coalesce((p_payload ->> 'is_best_seller')::boolean, false),
      has_video = coalesce((p_payload ->> 'has_video')::boolean, false),
      description = coalesce(p_payload ->> 'description', ''),
      color = p_payload ->> 'color', colors = v_colors, fabric = p_payload ->> 'fabric',
      occasion = p_payload ->> 'occasion', care = p_payload ->> 'care', length = p_payload ->> 'length',
      work_type = p_payload ->> 'work_type', pieces_included = p_payload ->> 'pieces_included',
      shade = p_payload ->> 'shade', volume = p_payload ->> 'volume',
      skin_type = p_payload ->> 'skin_type', expiry = p_payload ->> 'expiry',
      batch = p_payload ->> 'batch', ingredients = p_payload ->> 'ingredients',
      how_to_use = p_payload ->> 'how_to_use', safety = p_payload ->> 'safety',
      blouse_piece = (p_payload ->> 'blouse_piece')::boolean,
      stitched = (p_payload ->> 'stitched')::boolean,
      updated_at = now()
    WHERE code = p_code
    RETURNING code, slug INTO v_code, v_slug;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'Product not found';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_id,
    CASE WHEN p_mode = 'create' THEN 'product.created' ELSE 'product.updated' END,
    'products', v_code,
    jsonb_build_object('slug', v_slug, 'status', coalesce(p_payload ->> 'status', 'draft'))
  );

  RETURN jsonb_build_object('code', v_code, 'slug', v_slug);
END;
$$;
REVOKE ALL ON FUNCTION api.save_product(text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.save_product(text, text, jsonb, uuid) TO service_role;

-- ---- api.set_product_status ------------------------------------------------
CREATE OR REPLACE FUNCTION api.set_product_status(p_code text, p_status text, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_code text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF p_status NOT IN ('draft', 'active', 'hidden', 'archived') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  UPDATE public.products SET status = p_status, updated_at = now()
   WHERE code = p_code RETURNING code INTO v_code;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'product.status_changed', 'products', p_code,
          jsonb_build_object('status', p_status));
END;
$$;
REVOKE ALL ON FUNCTION api.set_product_status(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_product_status(text, text, uuid) TO service_role;

-- ---- api.save_category -----------------------------------------------------
CREATE OR REPLACE FUNCTION api.save_category(
  p_mode text, p_orig_slug text, p_slug text, p_name text,
  p_sort_order int, p_is_active boolean, p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_slug text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF p_mode = 'create' THEN
    INSERT INTO public.product_categories (slug, name, sort_order, is_active)
    VALUES (p_slug, p_name, p_sort_order, p_is_active);
  ELSIF p_mode = 'update' THEN
    UPDATE public.product_categories
       SET slug = p_slug, name = p_name, sort_order = p_sort_order, is_active = p_is_active,
           updated_at = now()
     WHERE slug = p_orig_slug RETURNING slug INTO v_slug;
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'Category not found';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid mode';
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, CASE WHEN p_mode = 'create' THEN 'category.created' ELSE 'category.updated' END,
          'product_categories', p_slug, jsonb_build_object('name', p_name, 'is_active', p_is_active));
END;
$$;
REVOKE ALL ON FUNCTION api.save_category(text, text, text, text, int, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.save_category(text, text, text, text, int, boolean, uuid) TO service_role;

-- ---- api.set_category_active -----------------------------------------------
CREATE OR REPLACE FUNCTION api.set_category_active(p_slug text, p_active boolean, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_slug text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  UPDATE public.product_categories SET is_active = p_active, updated_at = now()
   WHERE slug = p_slug RETURNING slug INTO v_slug;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'Category not found';
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'category.status_changed', 'product_categories', p_slug,
          jsonb_build_object('is_active', p_active));
END;
$$;
REVOKE ALL ON FUNCTION api.set_category_active(text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_category_active(text, boolean, uuid) TO service_role;

-- ---- api.delete_category ---------------------------------------------------
CREATE OR REPLACE FUNCTION api.delete_category(p_slug text, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_slug text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  -- audit first; if the delete is blocked (FK) or no row matched, the whole
  -- transaction rolls back including this audit row.
  DELETE FROM public.product_categories WHERE slug = p_slug RETURNING slug INTO v_slug;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'Category not found';
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id)
  VALUES (p_actor_id, 'category.deleted', 'product_categories', p_slug);
END;
$$;
REVOKE ALL ON FUNCTION api.delete_category(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_category(text, uuid) TO service_role;

-- ---- api.reorder_categories (atomic) ---------------------------------------
CREATE OR REPLACE FUNCTION api.reorder_categories(p_items jsonb, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count int;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'An active acting user is required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 500 THEN
    RAISE EXCEPTION 'Invalid reorder batch';
  END IF;

  UPDATE public.product_categories c
     SET sort_order = x.sort_order, updated_at = now()
    FROM (
      SELECT e ->> 'slug' AS slug, (e ->> 'sortOrder')::int AS sort_order
      FROM jsonb_array_elements(p_items) e
    ) x
   WHERE c.slug = x.slug;

  INSERT INTO public.audit_logs (actor_id, action, target_type, metadata)
  VALUES (p_actor_id, 'category.reordered', 'product_categories',
          jsonb_build_object('count', v_count));
END;
$$;
REVOKE ALL ON FUNCTION api.reorder_categories(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.reorder_categories(jsonb, uuid) TO service_role;
