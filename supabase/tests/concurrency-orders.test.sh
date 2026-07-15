#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# concurrency-orders.test.sh — Stage 7 (P2) money-path race proofs.
#
# Fires N genuinely-parallel psql connections at api.place_order to prove the
# three invariants hold under real concurrency (not single-session sequential):
#
#   Race 1 — OVERSELL:   1 unit of stock, N parallel orders → exactly ONE order
#            is created; the rest get out_of_stock; stock is never oversold.
#   Race 2 — IDEMPOTENCY: the SAME idempotency key fired N times in parallel →
#            exactly ONE order exists for that key (all callers converge on it).
#   Race 3 — COUPON:     a coupon with usage_limit=1, N parallel redemptions →
#            exactly ONE order consumes it; usage_count == 1; no over-grant.
#
# The serialization points under test are the product-row FOR UPDATE lock
# (oversell), the idempotency_keys unique key (duplicate), and the coupon-row
# FOR UPDATE lock + usage_count (coupon) inside api.place_order.
#
# Prereqs: psql + a running local Supabase. Run: bash <this>. CI: migrations-local.
# NOTE: append-only / order rows persist; the ephemeral CI DB is torn down after.
# ---------------------------------------------------------------------------

set -uo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
N="${N:-8}"                 # parallelism
PASS=true
CUST='{"name":"Race Buyer","phone":"01700000000","district":"Dhaka","address":"Test Rd"}'

q() { psql "$DB_URL" -t -A -c "$1"; }

echo "=== Order money-path concurrency test (N=$N) ==="

# ---- Fixtures (committed outside any test transaction) --------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO public.product_categories (slug, name, sort_order, is_active)
  VALUES ('conc-ord-cat', 'Conc Orders', 98, true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.products (code, slug, name, category_id, price, stock, status)
  SELECT v.code, v.code, v.code, c.id, 1000, v.stock, 'active'
    FROM (VALUES ('conc-oversell', 1), ('conc-idem', 50), ('conc-coupon', 50))
         AS v(code, stock)
    CROSS JOIN (SELECT id FROM public.product_categories WHERE slug='conc-ord-cat') c
  ON CONFLICT (code) DO UPDATE SET stock = EXCLUDED.stock, status = 'active';
INSERT INTO public.coupons (code, type, value, usage_limit, active)
  VALUES ('CONCRACE1', 'fixed', 100, 1, true)
  ON CONFLICT (code) DO UPDATE SET usage_limit = 1, usage_count = 0, active = true;
-- reset any prior run's residue so re-runs are deterministic
DELETE FROM public.coupon_usages WHERE coupon_code = 'CONCRACE1';
SQL
echo "fixtures loaded"

place_order() {
  # $1 = lines jsonb, $2 = idempotency key, $3 = coupon (or empty)
  # A guest placement requires a client token hash (sha256 hex); a fixed valid
  # hash is fine here — every request in a race shares the same order or fails
  # before the token matters, and tracking is by order_no + hash.
  local lines="$1" key="$2" coupon="$3" couponarg
  if [ -n "$coupon" ]; then couponarg="'$coupon'"; else couponarg="NULL"; fi
  psql "$DB_URL" -t -A -c \
    "SELECT api.place_order('$lines'::jsonb, '$CUST'::jsonb, 'dhaka', 'cod', '$key', NULL, NULL, $couponarg, encode(extensions.digest('conc-token','sha256'),'hex'));"
}

# ---- Race 1: OVERSELL (1 unit, N parallel, distinct keys) -----------------
echo ""
echo "--- Race 1: oversell (stock=1, $N parallel) ---"
LINES='[{"code":"conc-oversell","size":null,"qty":1}]'
for i in $(seq 1 "$N"); do
  place_order "$LINES" "oversell-$i" "" > "/tmp/os_$i.txt" 2>&1 &
done
wait
OS_ORDERS=$(q "SELECT count(*) FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id WHERE p.code='conc-oversell';")
OS_OOS=$(grep -l "out_of_stock" /tmp/os_*.txt 2>/dev/null | wc -l | tr -d ' ')
echo "orders created for oversell product: $OS_ORDERS (expect 1); out_of_stock rejections: $OS_OOS (expect $((N-1)))"
if [ "$OS_ORDERS" != "1" ]; then echo "FAIL: oversell — expected exactly 1 order, got $OS_ORDERS"; PASS=false; fi
if [ "$OS_OOS" != "$((N-1))" ]; then echo "FAIL: oversell — expected $((N-1)) out_of_stock, got $OS_OOS"; PASS=false; fi

# ---- Race 2: IDEMPOTENCY (same key, N parallel, same payload) -------------
echo ""
echo "--- Race 2: idempotency (same key, $N parallel) ---"
LINES='[{"code":"conc-idem","size":null,"qty":1}]'
for i in $(seq 1 "$N"); do
  place_order "$LINES" "idem-shared-key" "" > "/tmp/idem_$i.txt" 2>&1 &
done
wait
IDEM_ORDERS=$(q "SELECT count(*) FROM public.orders WHERE idempotency_key='idem-shared-key';")
echo "orders for the shared idempotency key: $IDEM_ORDERS (expect 1)"
if [ "$IDEM_ORDERS" != "1" ]; then echo "FAIL: idempotency — expected exactly 1 order, got $IDEM_ORDERS"; PASS=false; fi

# ---- Race 3: COUPON (usage_limit=1, N parallel, distinct keys) ------------
echo ""
echo "--- Race 3: coupon exhaustion (usage_limit=1, $N parallel) ---"
LINES='[{"code":"conc-coupon","size":null,"qty":1}]'
for i in $(seq 1 "$N"); do
  place_order "$LINES" "coupon-$i" "CONCRACE1" > "/tmp/cpn_$i.txt" 2>&1 &
done
wait
CPN_USAGES=$(q "SELECT count(*) FROM public.coupon_usages WHERE coupon_code='CONCRACE1';")
CPN_COUNT=$(q "SELECT usage_count FROM public.coupons WHERE code='CONCRACE1';")
CPN_ORDERS=$(q "SELECT count(*) FROM public.orders WHERE coupon_code='CONCRACE1';")
CPN_EXH=$(grep -l "coupon_exhausted" /tmp/cpn_*.txt 2>/dev/null | wc -l | tr -d ' ')
echo "coupon_usages: $CPN_USAGES (expect 1); usage_count: $CPN_COUNT (expect 1); orders with coupon: $CPN_ORDERS (expect 1); coupon_exhausted: $CPN_EXH (expect $((N-1)))"
if [ "$CPN_USAGES" != "1" ]; then echo "FAIL: coupon — usages=$CPN_USAGES, expected 1 (over-grant!)"; PASS=false; fi
if [ "$CPN_COUNT" != "1" ]; then echo "FAIL: coupon — usage_count=$CPN_COUNT, expected 1"; PASS=false; fi
if [ "$CPN_ORDERS" != "1" ]; then echo "FAIL: coupon — orders=$CPN_ORDERS, expected 1"; PASS=false; fi
if [ "$CPN_EXH" != "$((N-1))" ]; then echo "FAIL: coupon — coupon_exhausted=$CPN_EXH, expected $((N-1))"; PASS=false; fi

echo ""
if [ "$PASS" = "true" ]; then
  echo "=== ORDER CONCURRENCY TEST PASSED ==="
  exit 0
else
  echo "=== ORDER CONCURRENCY TEST FAILED ==="
  exit 1
fi
