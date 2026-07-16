#!/usr/bin/env bash
# Logical database backup (Stage 7 / P6).
#
# Produces the three-file logical dump Supabase's "migrate between projects"
# restore expects, plus an auth-data dump so customer-owned rows (orders →
# auth.users) restore with intact FKs:
#
#   <out>/roles.sql    cluster roles            (supabase db dump --role-only)
#   <out>/schema.sql   DDL for app schemas      (public, api, private)
#   <out>/data.sql     row data (COPY form)     (app schemas)
#   <out>/auth.sql     auth.users + identities  (so user_id FKs resolve on restore)
#   <out>/MANIFEST.txt commit sha, timestamp, file sizes, line counts
#
# Restore target is a FRESH Supabase project/stack (which already provides the
# managed auth/storage schemas) — see docs/stage-7-backup-and-dr.md.
#
# READ-ONLY against prod: every dump is a SELECT. Nothing is written to the
# source database.
#
# Required env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD.
# Usage: scripts/backup-db.sh <out-dir>
set -euo pipefail

OUT="${1:?usage: backup-db.sh <out-dir>}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.33.9}"
APP_SCHEMAS="${APP_SCHEMAS:-public,api,private}"
SB() { npx -y "supabase@${SUPABASE_CLI_VERSION}" "$@"; }

mkdir -p "$OUT"

echo "backup-db: linking project ${SUPABASE_PROJECT_ID}…"
SB link --project-ref "$SUPABASE_PROJECT_ID" >/dev/null

# --linked is the default; -p passes the DB password non-interactively.
echo "backup-db: dumping roles…"
SB db dump --linked -p "$SUPABASE_DB_PASSWORD" --role-only -f "$OUT/roles.sql"

echo "backup-db: dumping schema (${APP_SCHEMAS})…"
SB db dump --linked -p "$SUPABASE_DB_PASSWORD" -s "$APP_SCHEMAS" -f "$OUT/schema.sql"

echo "backup-db: dumping data (${APP_SCHEMAS}, COPY form)…"
SB db dump --linked -p "$SUPABASE_DB_PASSWORD" -s "$APP_SCHEMAS" --data-only --use-copy -f "$OUT/data.sql"

# Customer identities: orders.user_id → auth.users(id). Dumping the two auth
# tables the app depends on lets a restore re-link customer-owned orders. The
# rest of the auth schema is service-managed and recreated by the target.
echo "backup-db: dumping auth.users + auth.identities data…"
SB db dump --linked -p "$SUPABASE_DB_PASSWORD" -s auth --data-only --use-copy \
  -x auth.schema_migrations -x auth.instances -x auth.audit_log_entries \
  -x auth.flow_state -x auth.sessions -x auth.refresh_tokens \
  -x auth.mfa_amr_claims -x auth.mfa_challenges -x auth.mfa_factors \
  -x auth.one_time_tokens -x auth.saml_providers -x auth.saml_relay_states \
  -x auth.sso_domains -x auth.sso_providers \
  -f "$OUT/auth.sql"

{
  echo "Nongorr logical DB backup"
  echo "commit:    ${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "project:   ${SUPABASE_PROJECT_ID}"
  echo "schemas:   ${APP_SCHEMAS} (+ auth users/identities)"
  echo ""
  echo "file           bytes      lines"
  for f in roles.sql schema.sql data.sql auth.sql; do
    if [ -f "$OUT/$f" ]; then
      printf "%-14s %-10s %s\n" "$f" "$(wc -c <"$OUT/$f")" "$(wc -l <"$OUT/$f")"
    fi
  done
} | tee "$OUT/MANIFEST.txt"

echo "backup-db: OK → $OUT"
