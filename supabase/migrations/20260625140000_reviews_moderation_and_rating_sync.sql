-- Stage 2 Pass 3a: review moderation + automatic rating/review_count sync.
--
-- Context
-- -------
-- `product_reviews` (status pending/approved/rejected) and the denormalized
-- `products.rating` / `products.review_count` snapshot columns have existed
-- since the catalog schema, but the snapshot was NEVER kept in sync with the
-- review rows, and there was no server-authoritative moderation path (the admin
-- UI was a mock). This migration adds both.
--
-- 1. A trigger keeps products.rating/review_count == aggregate of APPROVED
--    reviews, for EVERY write path (moderation, seeding, future customer
--    submissions). It writes only rating/review_count/updated_at, so the
--    products.stock write-guard (which fires only when stock changes) is
--    respected.
-- 2. SECURITY DEFINER api.* moderation RPCs (service-role EXECUTE only) mutate a
--    review's status / delete it and write the canonical audit row in one
--    transaction; the trigger resyncs the aggregate. Errors use the same stable
--    snake_case code convention as the inventory RPCs (code as message, human
--    text in DETAIL) so the TS/UI layer can surface granular messages.

-- ===========================================================================
-- 1. Aggregate sync
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.sync_product_review_aggregate(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.products p
     SET rating = COALESCE((
           SELECT round(avg(r.rating)::numeric, 1)
             FROM public.product_reviews r
            WHERE r.product_id = p_product_id AND r.status = 'approved'
         ), 0),
         review_count = (
           SELECT count(*)
             FROM public.product_reviews r
            WHERE r.product_id = p_product_id AND r.status = 'approved'
         ),
         updated_at = now()
   WHERE p.id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_product_reviews_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.sync_product_review_aggregate(OLD.product_id);
    RETURN OLD;
  END IF;
  -- INSERT or UPDATE: resync the (new) product; also the old product if it moved.
  IF TG_OP = 'UPDATE' AND NEW.product_id <> OLD.product_id THEN
    PERFORM private.sync_product_review_aggregate(OLD.product_id);
  END IF;
  PERFORM private.sync_product_review_aggregate(NEW.product_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_reviews_sync_aggregate ON public.product_reviews;
CREATE TRIGGER product_reviews_sync_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION private.trg_product_reviews_sync();

-- Backfill once so existing snapshots match reality immediately.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT product_id FROM public.product_reviews LOOP
    PERFORM private.sync_product_review_aggregate(r.product_id);
  END LOOP;
END;
$$;

-- ===========================================================================
-- 2. api.set_review_status — moderate a single review (idempotent)
-- ===========================================================================
CREATE OR REPLACE FUNCTION api.set_review_status(p_review_id uuid, p_status text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_pid uuid; v_old text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING DETAIL = 'Unknown review status';
  END IF;

  SELECT product_id, status INTO v_pid, v_old
    FROM public.product_reviews WHERE id = p_review_id FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'review_not_found' USING DETAIL = 'Review not found';
  END IF;

  -- Idempotent: re-applying the current status is a successful no-op.
  IF v_old = p_status THEN
    RETURN jsonb_build_object('id', p_review_id, 'product_id', v_pid, 'status', p_status, 'changed', false);
  END IF;

  UPDATE public.product_reviews SET status = p_status WHERE id = p_review_id;
  -- trigger product_reviews_sync_aggregate resyncs products.rating/review_count

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'review.status_changed', 'product_reviews', p_review_id::text,
          jsonb_build_object('from', v_old, 'to', p_status, 'product_id', v_pid));

  RETURN jsonb_build_object('id', p_review_id, 'product_id', v_pid, 'status', p_status, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION api.set_review_status(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.set_review_status(uuid, text, uuid) TO service_role;

-- ===========================================================================
-- 3. api.delete_review — hard-delete a review (e.g. spam)
-- ===========================================================================
CREATE OR REPLACE FUNCTION api.delete_review(p_review_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_pid uuid; v_status text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE user_id = p_actor_id AND is_active
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'An active acting user is required';
  END IF;

  SELECT product_id, status INTO v_pid, v_status
    FROM public.product_reviews WHERE id = p_review_id FOR UPDATE;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'review_not_found' USING DETAIL = 'Review not found';
  END IF;

  DELETE FROM public.product_reviews WHERE id = p_review_id;
  -- trigger resyncs products.rating/review_count

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor_id, 'review.deleted', 'product_reviews', p_review_id::text,
          jsonb_build_object('product_id', v_pid, 'prior_status', v_status));

  RETURN jsonb_build_object('id', p_review_id, 'product_id', v_pid, 'deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION api.delete_review(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_review(uuid, uuid) TO service_role;
