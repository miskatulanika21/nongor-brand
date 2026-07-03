-- Stage 4 P7 — guest-order claim (attach a guest order to a signed-in account).
--
-- The capability TOKEN is the proof of ownership — phone/email matching is
-- never used (V3 hard rule). The server fn hashes the visitor's raw token
-- (sha256 hex, identical to track_order) and passes the VERIFIED session user
-- id; the client never picks the scope.
--
--   api.claim_guest_order(user, order_no, token_hash) → {order_id, order_no,
--     claimed, already_owned}
--
-- Stable codes: actor_not_authorized, order_not_found, order_not_claimable.
--
-- Semantics:
--   * guest-owned + matching token → UPDATE sets user_id and clears
--     guest_token_hash in ONE statement, preserving the orders_one_owner XOR
--     CHECK. The old tracking link stops working by design — the order now
--     lives in the account's order history (list_my_orders / get_my_order).
--   * already owned by THIS user → idempotent success (a retried click after
--     a network blip must not error), already_owned=true.
--   * owned by another account → order_not_claimable (never reveals whose).
--   * unknown order OR wrong token → order_not_found — one non-oracular
--     answer, mirroring track_order.
--   * FOR UPDATE on the order row serializes racing claims: the loser sees
--     the winner's user_id and gets the claimable/idempotent path.
--   * Ownership changes are security-relevant → canonical order.claimed audit
--     row in the same transaction (plan §2/§8 — same rule as account.imported).

CREATE OR REPLACE FUNCTION api.claim_guest_order(p_user uuid, p_order_no text, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_no text; v_hash text;
  v_id uuid; v_owner uuid; v_guest_hash text;
BEGIN
  PERFORM private.assert_account_user(p_user);

  v_no   := btrim(COALESCE(p_order_no, ''));
  v_hash := btrim(COALESCE(p_token_hash, ''));
  IF v_no = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT o.id, o.user_id, o.guest_token_hash
    INTO v_id, v_owner, v_guest_hash
    FROM public.orders o
   WHERE o.order_no = v_no
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_owner IS NOT NULL THEN
    IF v_owner = p_user THEN
      RETURN jsonb_build_object(
        'order_id', v_id, 'order_no', v_no,
        'claimed', true, 'already_owned', true);
    END IF;
    RAISE EXCEPTION 'order_not_claimable'
      USING DETAIL = 'The order already belongs to an account';
  END IF;

  IF v_guest_hash IS NULL OR v_guest_hash <> v_hash THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- One statement: user_id set + token cleared together keeps the XOR CHECK.
  UPDATE public.orders
     SET user_id = p_user, guest_token_hash = NULL
   WHERE id = v_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_user, 'order.claimed', 'orders', v_id::text,
          jsonb_build_object('order_no', v_no));

  RETURN jsonb_build_object(
    'order_id', v_id, 'order_no', v_no,
    'claimed', true, 'already_owned', false);
END;
$$;
REVOKE ALL ON FUNCTION api.claim_guest_order(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.claim_guest_order(uuid, text, text) TO service_role;
