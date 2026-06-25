-- Stage 2 Pass 3b: authenticated customer review submission.
--
-- Pass 3a added moderation + rating sync; reviews could only be created by
-- seeding. This lets a LOGGED-IN customer submit a review, which lands as
-- `pending` for the existing moderation queue (so the public rating is never
-- affected until an admin approves). Server-authoritative: the submission goes
-- through a SECURITY DEFINER api.* RPC (service-role only) that the customer
-- server function calls AFTER verifying the authenticated session.
--
-- Adds product_reviews.user_id so reviews are attributable and de-duplicated
-- (one review per user per product) and so a future "verified purchase" badge
-- has something to hang on. Existing/seeded rows keep user_id NULL.

-- ---- attribution column + one-per-user-per-product ----------------------------
ALTER TABLE public.product_reviews
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_user_product
  ON public.product_reviews (product_id, user_id)
  WHERE user_id IS NOT NULL;

-- ---- api.submit_review --------------------------------------------------------
CREATE OR REPLACE FUNCTION api.submit_review(
  p_code text, p_author_name text, p_rating integer, p_body text, p_user_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE v_pid uuid; v_name text; v_body text;
BEGIN
  -- Customer identity (the verified auth user). Not a staff check — any real
  -- authenticated account may submit.
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING DETAIL = 'A signed-in account is required';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'invalid_rating' USING DETAIL = 'Rating must be 1 to 5';
  END IF;

  v_name := btrim(coalesce(p_author_name, ''));
  IF length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_author' USING DETAIL = 'Name must be 1-80 characters';
  END IF;

  v_body := btrim(coalesce(p_body, ''));
  IF length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid_body' USING DETAIL = 'Review must be 1-2000 characters';
  END IF;

  -- Only publicly visible products can be reviewed (mirrors the public RLS).
  SELECT p.id INTO v_pid
    FROM public.products p
    JOIN public.product_categories c ON c.id = p.category_id
   WHERE p.code = p_code AND p.status = 'active' AND c.is_active;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'product_not_visible' USING DETAIL = 'Product is not available for review';
  END IF;

  -- One review per customer per product.
  IF EXISTS (
    SELECT 1 FROM public.product_reviews
     WHERE product_id = v_pid AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'already_reviewed' USING DETAIL = 'You have already reviewed this product';
  END IF;

  INSERT INTO public.product_reviews (product_id, user_id, author_name, rating, body, status)
  VALUES (v_pid, p_user_id, v_name, p_rating, v_body, 'pending');
  -- status='pending' => the rating-sync trigger leaves the public rating unchanged.

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_user_id, 'review.submitted', 'product_reviews', p_code,
          jsonb_build_object('product_id', v_pid, 'rating', p_rating));

  RETURN jsonb_build_object('status', 'pending');
END;
$$;
REVOKE ALL ON FUNCTION api.submit_review(text, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.submit_review(text, text, integer, text, uuid) TO service_role;
