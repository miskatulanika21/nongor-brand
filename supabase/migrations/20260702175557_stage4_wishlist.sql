-- Stage 4 P6 — wishlist server sync (premium: hearts survive devices).
--
-- Guests keep a localStorage wishlist; on login the store merges it here
-- (api.sync_wishlist — union, cap 100) and the server becomes the truth
-- (api.toggle_wishlist for every heart thereafter; localStorage stays only as
-- an instant-paint mirror). Same posture as every Stage-4 table: RPC-only —
-- deny-all RLS, direct grants revoked, SECURITY DEFINER api.* service-role-only
-- EXECUTE; the server fn passes the VERIFIED session user id (the client never
-- picks the scope). Both writes take the P2 per-user advisory lock, so cap
-- counting is race-free with zero cross-user contention.
--
--   api.sync_wishlist(user, codes[]) → merge-on-login; returns the canonical list
--   api.toggle_wishlist(user, code)  → single heart flip; returns the canonical list
--
-- Stable codes: actor_not_authorized, product_not_found, wishlist_full.
--
-- Design notes (plan §3/§4):
--   * product_code references products(code) — the stable public catalog id the
--     client already keeps in its wishlist array — so no id translation layer.
--     Deleting a product silently drops it from every wishlist (CASCADE).
--   * created_at drives the wishlist page's "recently added" order (the client
--     renders newest-first). No updated_at: rows are insert/delete only.
--   * sync SALVAGES, never rejects: unknown codes, duplicates and codes beyond
--     the cap are dropped; the response is the canonical post-merge list.

-- ── wishlist_items (cap 100/user, enforced in the RPCs) ───────────────────────
CREATE TABLE IF NOT EXISTS public.wishlist_items (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_code text        NOT NULL REFERENCES public.products(code)
                             ON UPDATE CASCADE ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_code)
);
COMMENT ON TABLE public.wishlist_items IS
  'Stage 4 wishlist (one row per user x product). RPC-only (deny-all RLS). Cap 100/user enforced in the sync/toggle RPCs.';

-- FK-cascade / catalog-side lookups (the PK only serves user-first paths).
CREATE INDEX IF NOT EXISTS idx_wishlist_items_product
  ON public.wishlist_items (product_code);

ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_items FROM anon, authenticated;

-- ── private.wishlist_snapshot ─────────────────────────────────────────────────
-- The canonical response of both RPCs: codes oldest-first + count.
CREATE OR REPLACE FUNCTION private.wishlist_snapshot(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'codes', COALESCE(jsonb_agg(w.product_code ORDER BY w.created_at, w.product_code), '[]'::jsonb),
    'count', count(*))
  FROM public.wishlist_items w
  WHERE w.user_id = p_user;
$$;

-- ── api.sync_wishlist ─────────────────────────────────────────────────────────
-- Merge-on-login: union the device's local codes into the server list, keeping
-- payload order, dropping blanks/duplicates/unknown products, filling only up
-- to the cap. Idempotent — re-syncing the same codes changes nothing.
CREATE OR REPLACE FUNCTION api.sync_wishlist(p_user uuid, p_codes text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_room integer;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);

  SELECT 100 - count(*) INTO v_room FROM public.wishlist_items WHERE user_id = p_user;

  IF v_room > 0 AND p_codes IS NOT NULL THEN
    INSERT INTO public.wishlist_items (user_id, product_code)
    SELECT p_user, c.code
    FROM (
      -- first occurrence of each non-blank code, first 200 entries only
      SELECT DISTINCT ON (btrim(t.code)) btrim(t.code) AS code, t.ord
      FROM unnest(p_codes[1:200]) WITH ORDINALITY AS t(code, ord)
      WHERE btrim(COALESCE(t.code, '')) <> ''
      ORDER BY btrim(t.code), t.ord
    ) c
    JOIN public.products p ON p.code = c.code
    WHERE NOT EXISTS (
      SELECT 1 FROM public.wishlist_items w
      WHERE w.user_id = p_user AND w.product_code = c.code)
    ORDER BY c.ord
    LIMIT v_room
    ON CONFLICT (user_id, product_code) DO NOTHING;
  END IF;

  RETURN private.wishlist_snapshot(p_user);
END;
$$;
REVOKE ALL ON FUNCTION api.sync_wishlist(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.sync_wishlist(uuid, text[]) TO service_role;

-- ── api.toggle_wishlist ───────────────────────────────────────────────────────
-- One heart flip: removes the row if present, else validates the product +
-- cap and inserts. Returns {'wishlisted': bool} + the canonical snapshot so
-- the client reconciles in one round trip.
CREATE OR REPLACE FUNCTION api.toggle_wishlist(p_user uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_code text; v_count integer; v_wishlisted boolean;
BEGIN
  PERFORM private.assert_account_user(p_user);
  PERFORM private.account_write_lock(p_user);

  v_code := btrim(COALESCE(p_code, ''));
  IF v_code = '' THEN
    RAISE EXCEPTION 'product_not_found' USING DETAIL = 'A product code is required';
  END IF;

  DELETE FROM public.wishlist_items WHERE user_id = p_user AND product_code = v_code;
  IF FOUND THEN
    v_wishlisted := false;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE code = v_code) THEN
      RAISE EXCEPTION 'product_not_found' USING DETAIL = 'No product with this code';
    END IF;
    SELECT count(*) INTO v_count FROM public.wishlist_items WHERE user_id = p_user;
    IF v_count >= 100 THEN
      RAISE EXCEPTION 'wishlist_full' USING DETAIL = 'At most 100 wishlist items';
    END IF;
    INSERT INTO public.wishlist_items (user_id, product_code) VALUES (p_user, v_code);
    v_wishlisted := true;
  END IF;

  RETURN private.wishlist_snapshot(p_user) || jsonb_build_object('wishlisted', v_wishlisted);
END;
$$;
REVOKE ALL ON FUNCTION api.toggle_wishlist(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.toggle_wishlist(uuid, text) TO service_role;
