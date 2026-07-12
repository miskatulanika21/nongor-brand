-- Stage 7 (P1) — self-serve customer account deletion.
--
-- Powers the "Delete account" action on /account/security. A customer may erase
-- their identity + personal data, but ORDERS are business/financial records and
-- must survive — so an order owned by the deleting user is converted to an
-- anonymized GUEST order (user_id -> NULL, a fresh random guest_token_hash) in
-- the SAME statement, keeping the orders_one_owner XOR satisfied at all times.
-- The fresh, never-shared token also kills any live tracking link.
--
-- Everything else the user owns is removed by the auth.users cascade:
--   customer_profiles / saved_addresses / saved_measurements / wishlist_items
--   are ON DELETE CASCADE; product_reviews.user_id + audit_logs.actor_id are
--   ON DELETE SET NULL (reviews/audit survive, de-identified).
--
-- Atomic by construction: order anonymization + the auth.users delete happen in
-- one SECURITY DEFINER transaction, so we can never detach orders yet leave the
-- user (or vice-versa). Service-role only; the server fn enforces CSRF + a
-- verified session + password re-auth before calling in with the verified id.

CREATE OR REPLACE FUNCTION api.delete_account(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orders integer;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;

  -- Staff/owner accounts are never removed through the customer self-serve path;
  -- staff removal goes through the guarded admin workflow (defense in depth — the
  -- server fn already rejects staff callers).
  IF EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'staff_cannot_self_delete';
  END IF;

  -- Detach + anonymize the user's orders in a single UPDATE so the XOR owner
  -- CHECK is satisfied on the intermediate row (user_id NULL, hash NOT NULL).
  UPDATE public.orders
     SET user_id = NULL,
         guest_token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
         updated_at = now()
   WHERE user_id = p_user;
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  -- Canonical audit row (same transaction). actor_id is nulled by the cascade
  -- below, so the deleted id is also kept in metadata for the trail.
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_user, 'account.deleted', 'auth.users', p_user::text,
          jsonb_build_object('orders_anonymized', v_orders, 'deleted_user_id', p_user));

  -- Cascades customer_profiles / addresses / measurements / wishlist; SET NULLs
  -- reviews + the audit actor. GoTrue's own FKs (identities/sessions/mfa) cascade
  -- too, so this is equivalent to auth.admin.deleteUser but atomic with the above.
  DELETE FROM auth.users WHERE id = p_user;

  RETURN jsonb_build_object('orders_anonymized', v_orders);
END;
$$;

REVOKE ALL ON FUNCTION api.delete_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.delete_account(uuid) TO service_role;

COMMENT ON FUNCTION api.delete_account(uuid) IS
  'Stage 7: self-serve customer account deletion. Anonymizes the user''s orders to guest ownership (records preserved), writes account.deleted audit, then deletes auth.users (cascading personal data). Service-role only; caller is the verified, re-authenticated account owner. Rejects staff accounts.';
