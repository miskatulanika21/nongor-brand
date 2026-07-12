-- Stage 7 (P4) — covering indexes for foreign keys on the tables that grow, so
-- FK lookups / joins / cascade checks stay index-backed at scale (perf advisor
-- 0001_unindexed_foreign_keys). Tiny/low-write CMS tables are intentionally left
-- unindexed (an index there is pure write overhead for no read benefit).
CREATE INDEX IF NOT EXISTS idx_order_status_history_actor ON public.order_status_history (actor_id);
CREATE INDEX IF NOT EXISTS idx_payments_verified_by ON public.payments (verified_by);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON public.product_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_order ON public.idempotency_keys (order_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_by ON public.media_assets (created_by);
CREATE INDEX IF NOT EXISTS idx_contact_messages_handled_by ON public.contact_messages (handled_by);
CREATE INDEX IF NOT EXISTS idx_shipments_created_by ON public.shipments (created_by);
CREATE INDEX IF NOT EXISTS idx_shipments_exchange_order ON public.shipments (exchange_order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_parent ON public.shipments (parent_shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipments_provider ON public.shipments (provider);
