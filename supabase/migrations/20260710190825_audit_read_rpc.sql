-- Stage 5 follow-up (audit surfacing) — read RPC for the admin Audit Logs page.
--
-- public.audit_logs has accumulated real rows since Stage 1 (written in-txn by
-- every api.* mutation) but nothing ever displayed them — the admin page showed
-- a hardcoded mock. This adds a single owner-only read RPC that resolves the
-- actor id → email + staff display name (authenticated clients cannot read
-- auth.users, so resolution must happen inside a SECURITY DEFINER function),
-- with server-side filtering + pagination over the existing indexes
-- (idx_audit_logs_action, idx_audit_logs_actor, idx_audit_logs_created_at).
--
-- Owner-only by design: the audit trail is the most sensitive read surface, and
-- the `audit.view` permission is owner-exclusive. The app server fn enforces
-- audit.view; this RPC re-checks role = 'owner' as defense in depth.

CREATE OR REPLACE FUNCTION api.list_audit_logs(
  p_actor        uuid,
  p_action       text        DEFAULT NULL,
  p_target_type  text        DEFAULT NULL,
  p_actor_filter uuid        DEFAULT NULL,
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL,
  p_search       text        DEFAULT NULL,
  p_limit        integer     DEFAULT 50,
  p_offset       integer     DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  -- Owner-only. Active-staff + owner role required.
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles
     WHERE user_id = p_actor AND is_active AND role::text = 'owner'
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.audit_logs al
  LEFT JOIN auth.users u ON u.id = al.actor_id
  WHERE (p_action IS NULL OR al.action = p_action)
    AND (p_target_type IS NULL OR al.target_type = p_target_type)
    AND (p_actor_filter IS NULL OR al.actor_id = p_actor_filter)
    AND (p_from IS NULL OR al.created_at >= p_from)
    AND (p_to   IS NULL OR al.created_at <  p_to)
    AND (v_search IS NULL
      OR al.action ILIKE '%' || v_search || '%'
      OR COALESCE(al.target_id, '')   ILIKE '%' || v_search || '%'
      OR COALESCE(al.target_type, '') ILIKE '%' || v_search || '%'
      OR COALESCE(al.metadata::text, '') ILIKE '%' || v_search || '%'
      OR COALESCE(u.email, '') ILIKE '%' || v_search || '%');

  SELECT COALESCE(jsonb_agg(sub.r ORDER BY sub.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      al.created_at,
      jsonb_build_object(
        'id',          al.id,
        'actor_id',    al.actor_id,
        'actor_email', u.email,
        'actor_name',  sp.display_name,
        'actor_role',  sp.role::text,
        'action',      al.action,
        'target_type', al.target_type,
        'target_id',   al.target_id,
        'metadata',    COALESCE(al.metadata, '{}'::jsonb),
        'created_at',  al.created_at
      ) AS r
    FROM public.audit_logs al
    LEFT JOIN auth.users u ON u.id = al.actor_id
    LEFT JOIN public.staff_profiles sp ON sp.user_id = al.actor_id
    WHERE (p_action IS NULL OR al.action = p_action)
      AND (p_target_type IS NULL OR al.target_type = p_target_type)
      AND (p_actor_filter IS NULL OR al.actor_id = p_actor_filter)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to   IS NULL OR al.created_at <  p_to)
      AND (v_search IS NULL
        OR al.action ILIKE '%' || v_search || '%'
        OR COALESCE(al.target_id, '')   ILIKE '%' || v_search || '%'
        OR COALESCE(al.target_type, '') ILIKE '%' || v_search || '%'
        OR COALESCE(al.metadata::text, '') ILIKE '%' || v_search || '%'
        OR COALESCE(u.email, '') ILIKE '%' || v_search || '%')
    ORDER BY al.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION api.list_audit_logs(uuid, text, text, uuid, timestamptz, timestamptz, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_audit_logs(uuid, text, text, uuid, timestamptz, timestamptz, text, integer, integer)
  TO service_role;
