-- Stage 3 Pass 5d — admin coupon management RPCs.
--
-- DB-backs admin.coupons.tsx (was a pure useState mock). All are SECURITY DEFINER
-- service-role RPCs that re-check active-staff (defense in depth behind the app's
-- guardAdminWrite("coupons.manage")) and write a canonical audit row in the same
-- transaction. Same posture as api.save_settings / api.set_review_status.
--
--   api.list_coupons(actor)                 → admin read (all coupons + usage)
--   api.upsert_coupon(actor, coupon)        → create or edit (keyed on code)
--   api.set_coupon_active(actor, code, on)  → enable/disable
--   api.delete_coupon(actor, code)          → hard-delete ONLY if never used
--                                             (used coupons are deactivated, not
--                                              deleted — preserves redemption
--                                              history via the FK RESTRICT)
--
-- Stable codes: actor_not_authorized, invalid_coupon_code, invalid_coupon_type,
-- invalid_coupon_config, coupon_not_found, coupon_in_use.

-- ── Admin read ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.list_coupons(p_actor uuid)
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
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v FROM public.coupons c;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION api.list_coupons(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_coupons(uuid) TO service_role;

-- ── Create / edit (upsert on code) ────────────────────────────────────────────
-- On edit the code is the identity (a code cannot be renamed — its usages FK to
-- it). usage_count / created_by / created_at are preserved on conflict. Type/value
-- coherence + bounds are enforced by the table CHECKs; a violation maps to the
-- stable invalid_coupon_config so raw SQL never reaches the client.
CREATE OR REPLACE FUNCTION api.upsert_coupon(p_actor uuid, p_coupon jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_code text; v_type text; v_created boolean; v jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  IF p_coupon IS NULL OR jsonb_typeof(p_coupon) <> 'object' THEN
    RAISE EXCEPTION 'invalid_coupon_config' USING DETAIL = 'A coupon object is required';
  END IF;

  v_code := upper(btrim(COALESCE(p_coupon->>'code', '')));
  IF v_code = '' OR char_length(v_code) < 3 OR char_length(v_code) > 40
     OR v_code !~ '^[A-Z0-9][A-Z0-9_-]*$' THEN
    RAISE EXCEPTION 'invalid_coupon_code'
      USING DETAIL = '3–40 chars, A–Z 0–9 dash underscore';
  END IF;

  v_type := COALESCE(p_coupon->>'type', '');
  IF v_type NOT IN ('percent','fixed','free_shipping') THEN
    RAISE EXCEPTION 'invalid_coupon_type';
  END IF;

  v_created := NOT EXISTS (SELECT 1 FROM public.coupons WHERE code = v_code);

  BEGIN
    INSERT INTO public.coupons (
      code, description, type, value, min_subtotal, max_discount,
      usage_limit, per_user_limit, first_order_only, starts_at, ends_at, active, created_by)
    VALUES (
      v_code,
      NULLIF(btrim(COALESCE(p_coupon->>'description', '')), ''),
      v_type,
      COALESCE((p_coupon->>'value')::int, 0),
      COALESCE((p_coupon->>'min_subtotal')::int, 0),
      NULLIF(p_coupon->>'max_discount', '')::int,
      NULLIF(p_coupon->>'usage_limit', '')::int,
      NULLIF(p_coupon->>'per_user_limit', '')::int,
      COALESCE((p_coupon->>'first_order_only')::boolean, false),
      NULLIF(p_coupon->>'starts_at', '')::timestamptz,
      NULLIF(p_coupon->>'ends_at', '')::timestamptz,
      COALESCE((p_coupon->>'active')::boolean, true),
      p_actor)
    ON CONFLICT (code) DO UPDATE SET
      description      = EXCLUDED.description,
      type             = EXCLUDED.type,
      value            = EXCLUDED.value,
      min_subtotal     = EXCLUDED.min_subtotal,
      max_discount     = EXCLUDED.max_discount,
      usage_limit      = EXCLUDED.usage_limit,
      per_user_limit   = EXCLUDED.per_user_limit,
      first_order_only = EXCLUDED.first_order_only,
      starts_at        = EXCLUDED.starts_at,
      ends_at          = EXCLUDED.ends_at,
      active           = EXCLUDED.active;
      -- usage_count, created_by, created_at deliberately NOT overwritten.
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_coupon_config'
      USING DETAIL = 'value/discount/window out of bounds for this coupon type';
  END;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, CASE WHEN v_created THEN 'coupon.created' ELSE 'coupon.updated' END,
          'coupon', v_code, jsonb_build_object('type', v_type));

  SELECT to_jsonb(c) INTO v FROM public.coupons c WHERE code = v_code;
  RETURN jsonb_build_object('coupon', v, 'created', v_created);
END;
$$;
REVOKE ALL ON FUNCTION api.upsert_coupon(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.upsert_coupon(uuid, jsonb) TO service_role;

-- ── Enable / disable ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.set_coupon_active(p_actor uuid, p_code text, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_code text; v jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  v_code := upper(btrim(COALESCE(p_code, '')));
  UPDATE public.coupons SET active = COALESCE(p_active, active) WHERE code = v_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'coupon_not_found'; END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'coupon.status_changed', 'coupon', v_code,
          jsonb_build_object('active', p_active));

  SELECT to_jsonb(c) INTO v FROM public.coupons c WHERE code = v_code;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION api.set_coupon_active(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_coupon_active(uuid, text, boolean) TO service_role;

-- ── Delete (only if never redeemed) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION api.delete_coupon(p_actor uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_code text;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
  v_code := upper(btrim(COALESCE(p_code, '')));
  IF NOT EXISTS (SELECT 1 FROM public.coupons WHERE code = v_code) THEN
    RAISE EXCEPTION 'coupon_not_found';
  END IF;
  -- A redeemed coupon is part of order history — keep it (deactivate instead).
  IF EXISTS (SELECT 1 FROM public.coupon_usages WHERE coupon_code = v_code) THEN
    RAISE EXCEPTION 'coupon_in_use';
  END IF;

  DELETE FROM public.coupons WHERE code = v_code;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'coupon.deleted', 'coupon', v_code, '{}'::jsonb);

  RETURN jsonb_build_object('deleted', true, 'code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION api.delete_coupon(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_coupon(uuid, text) TO service_role;
