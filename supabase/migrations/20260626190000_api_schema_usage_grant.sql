-- Stage 2 hardening (F-08) — grant USAGE on the api schema to the API roles.
--
-- The public read RPCs api.catalog_facets() and api.get_public_settings() are
-- granted EXECUTE to anon + authenticated, and the app calls them through the
-- per-request anon/authenticated client (createServerSupabaseClient). But those
-- roles never held USAGE on the `api` schema, so every such PostgREST call failed
-- with `42501 permission denied for schema api` — silently, because the callers
-- fall back (empty facets / static announcement) and there is no production
-- traffic yet. This was caught by the new REST smoke test.
--
-- Schema USAGE is necessary but NOT sufficient: a role still needs EXECUTE on the
-- specific function. Every privileged RPC REVOKEs EXECUTE from anon/authenticated,
-- so granting USAGE exposes ONLY the two intentionally-public functions above.
-- (There are no tables in the api schema — it is functions only.)

GRANT USAGE ON SCHEMA api TO anon, authenticated;
