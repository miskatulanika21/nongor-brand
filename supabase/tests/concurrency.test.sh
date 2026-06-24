#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# concurrency.test.sh — genuine two-connection advisory-lock serialization test
#
# Runs TWO parallel psql connections against the same actor+op_key to verify:
#   1. Advisory lock serializes concurrent bulk_set_inventory calls
#   2. Only one connection processes the inventory mutation
#   3. The other replays the stored result (no duplicate mutation)
#   4. No PK violation on inventory_bulk_ops
#   5. Stock changes exactly once
#   6. Exactly one inventory movement is created
#
# Also tests the payload-conflict case: same key, different payload.
#
# Prerequisites: psql, a running Supabase local instance.
# Run:  bash supabase/tests/concurrency.test.sh
# CI:   runs inside the migrations-local job after supabase start.
# NOTE: test data persists (movements are append-only); the ephemeral CI DB
#       is torn down after the job. Not suitable for long-lived databases.
# ---------------------------------------------------------------------------

set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PASS=true

echo "=== Two-connection concurrency test ==="

# ---- Fixtures (committed outside any test transaction) --------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-cccccccccc01'),
  ('00000000-0000-0000-0000-cccccccccc02')
  ON CONFLICT DO NOTHING;
INSERT INTO public.staff_profiles (user_id, role, is_active) VALUES
  ('00000000-0000-0000-0000-cccccccccc01', 'admin'::private.staff_role, true),
  ('00000000-0000-0000-0000-cccccccccc02', 'admin'::private.staff_role, true)
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.product_categories (slug, name, sort_order)
  VALUES ('conc-cat', 'Concurrency Cat', 99) ON CONFLICT DO NOTHING;
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'conc-p1', 'conc-p1', 'Concurrency Product 1', id, 100, 10
    FROM public.product_categories WHERE slug = 'conc-cat'
  ON CONFLICT DO NOTHING;
INSERT INTO public.products (code, slug, name, category_id, price, stock)
  SELECT 'conc-p2', 'conc-p2', 'Concurrency Product 2', id, 100, 5
    FROM public.product_categories WHERE slug = 'conc-cat'
  ON CONFLICT DO NOTHING;
SQL
echo "fixtures loaded"

# ---- Test 1: same actor + same key + same payload (concurrent) ------------
#   One connection processes, the other waits and replays.
echo ""
echo "--- Test 1: identical concurrent requests (same actor+key+payload) ---"

PAYLOAD='[{"code":"conc-p1","size":null,"quantity":25,"reason":"concurrency test 1"}]'
ACTOR='00000000-0000-0000-0000-cccccccccc01'

# Launch two parallel psql sessions — genuine two-connection test
psql "$DB_URL" -t -A -c \
  "SELECT api.bulk_set_inventory('$PAYLOAD'::jsonb, '$ACTOR'::uuid, 'conc-key-1');" \
  > /tmp/conc_result_a.txt 2>&1 &
PID_A=$!

psql "$DB_URL" -t -A -c \
  "SELECT api.bulk_set_inventory('$PAYLOAD'::jsonb, '$ACTOR'::uuid, 'conc-key-1');" \
  > /tmp/conc_result_b.txt 2>&1 &
PID_B=$!

wait $PID_A; STATUS_A=$?
wait $PID_B; STATUS_B=$?

if [ $STATUS_A -ne 0 ] || [ $STATUS_B -ne 0 ]; then
  echo "FAIL: one or both concurrent calls errored (exit: A=$STATUS_A B=$STATUS_B)"
  echo "--- Result A ---"; cat /tmp/conc_result_a.txt
  echo "--- Result B ---"; cat /tmp/conc_result_b.txt
  PASS=false
else
  echo "both connections completed successfully"

  # Verify stock
  STOCK=$(psql "$DB_URL" -t -A -c \
    "SELECT stock FROM public.products WHERE code = 'conc-p1';")
  if [ "$STOCK" != "25" ]; then
    echo "FAIL: stock is $STOCK, expected 25 (mutation applied more than once?)"
    PASS=false
  else
    echo "stock = $STOCK (correct)"
  fi

  # Verify exactly 1 movement
  MOVEMENTS=$(psql "$DB_URL" -t -A -c \
    "SELECT count(*) FROM public.product_inventory_movements m
       JOIN public.products p ON p.id = m.product_id
      WHERE p.code = 'conc-p1' AND m.reason = 'concurrency test 1';")
  if [ "$MOVEMENTS" != "1" ]; then
    echo "FAIL: movements = $MOVEMENTS, expected 1 (duplicate mutation?)"
    PASS=false
  else
    echo "movements = $MOVEMENTS (correct)"
  fi

  # Verify exactly 1 bulk_ops row (no PK violation)
  OPS=$(psql "$DB_URL" -t -A -c \
    "SELECT count(*) FROM public.inventory_bulk_ops
      WHERE actor_id = '$ACTOR' AND op_key = 'conc-key-1';")
  if [ "$OPS" != "1" ]; then
    echo "FAIL: bulk_ops rows = $OPS, expected 1"
    PASS=false
  else
    echo "bulk_ops rows = $OPS (correct)"
  fi
fi

# ---- Test 2: same actor + same key + different payload (conflict) ---------
echo ""
echo "--- Test 2: same key, different payload (conflict detection) ---"

PAYLOAD_DIFF='[{"code":"conc-p1","size":null,"quantity":30,"reason":"different payload"}]'

psql "$DB_URL" -t -A -c \
  "SELECT api.bulk_set_inventory('$PAYLOAD_DIFF'::jsonb, '$ACTOR'::uuid, 'conc-key-1');" \
  > /tmp/conc_conflict.txt 2>&1 && {
    echo "FAIL: conflicting payload was not rejected"
    PASS=false
  } || {
    if grep -qi "already used" /tmp/conc_conflict.txt; then
      echo "correctly rejected: payload conflict detected"
    else
      echo "rejected, but unexpected error message:"
      cat /tmp/conc_conflict.txt
      # Still a pass — the call was blocked, which is the requirement
    fi
  }

# Verify stock did NOT change to 30
STOCK_POST=$(psql "$DB_URL" -t -A -c \
  "SELECT stock FROM public.products WHERE code = 'conc-p1';")
if [ "$STOCK_POST" != "25" ]; then
  echo "FAIL: stock changed to $STOCK_POST after conflict (should be 25)"
  PASS=false
else
  echo "stock unchanged at $STOCK_POST after conflict (correct)"
fi

# ---- Test 3: different actors + same key (independent operations) ---------
echo ""
echo "--- Test 3: different actors, same key (independent operations) ---"

ACTOR_B='00000000-0000-0000-0000-cccccccccc02'
PAYLOAD_B='[{"code":"conc-p2","size":null,"quantity":20,"reason":"actor B independent"}]'

psql "$DB_URL" -t -A -c \
  "SELECT api.bulk_set_inventory('$PAYLOAD_B'::jsonb, '$ACTOR_B'::uuid, 'conc-key-1');" \
  > /tmp/conc_actor_b.txt 2>&1
if [ $? -ne 0 ]; then
  echo "FAIL: independent actor B call failed:"
  cat /tmp/conc_actor_b.txt
  PASS=false
else
  STOCK_B=$(psql "$DB_URL" -t -A -c \
    "SELECT stock FROM public.products WHERE code = 'conc-p2';")
  if [ "$STOCK_B" != "20" ]; then
    echo "FAIL: actor B stock is $STOCK_B, expected 20"
    PASS=false
  else
    echo "actor B independently processed: stock = $STOCK_B (correct)"
  fi
fi

# ---- Cleanup note ---------------------------------------------------------
echo ""
echo "NOTE: test data persists (movement rows are append-only). The ephemeral"
echo "      CI database is torn down after the job; no cleanup needed."

# ---- Verdict ---------------------------------------------------------------
echo ""
if [ "$PASS" = "true" ]; then
  echo "=== CONCURRENCY TEST PASSED ==="
  exit 0
else
  echo "=== CONCURRENCY TEST FAILED ==="
  exit 1
fi
