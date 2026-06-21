-- Migration 9: Catalog schema (Stage 2, Pass 1 — public read path).
-- Version: 20260622000000
--
-- Adds the normalized catalog: categories, products, media, per-size stock and
-- reviews. Public (anon + authenticated) gets SELECT-only access through RLS
-- that requires the parent product to be active AND its category active; child
-- rows never leak for hidden/draft/archived products; reviews require approval.
-- No public writes — admin write paths and inventory movements land in a later
-- Stage 2 pass; the seed script uses the service-role key (bypasses RLS).
--
-- Source-of-truth notes (documented, transitional):
--   * category        -> products.category_id (only source)
--   * stock           -> sum(product_size_stock.quantity) when size rows exist,
--                        else products.stock (kept consistent by the seed)
--   * rating/review_count -> denormalized display snapshot on products;
--                        product_reviews is the row store. Not auto-synced yet.

-- ============================================================
-- 1. product_categories
-- ============================================================
CREATE TABLE public.product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.product_categories IS
  'Catalog categories (one row per product type). Canonical source for a product''s category via products.category_id.';

CREATE TRIGGER trg_product_categories_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. products
-- ============================================================
CREATE TABLE public.products (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,            -- stable legacy id ("p1".."p10")
  slug               text NOT NULL UNIQUE,            -- public URL key
  name               text NOT NULL,
  category_id        uuid NOT NULL REFERENCES public.product_categories(id),
  price              integer NOT NULL CHECK (price >= 0),
  sale_price         integer CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price <= price)),
  stock              integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  rating             numeric(2,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review_count       integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('draft','active','hidden','archived')),
  sort_order         integer NOT NULL DEFAULT 0,
  is_new             boolean NOT NULL DEFAULT false,
  is_handmade        boolean NOT NULL DEFAULT false,
  is_best_seller     boolean NOT NULL DEFAULT false,
  has_video          boolean NOT NULL DEFAULT false,
  custom_size        boolean NOT NULL DEFAULT false,
  custom_size_charge integer CHECK (custom_size_charge IS NULL OR custom_size_charge >= 0),
  -- descriptive, type-specific fields (finite set from the Product interface)
  color              text,
  colors             text[],
  fabric             text,
  occasion           text,
  description        text NOT NULL DEFAULT '',
  care               text,
  blouse_piece       boolean,
  length             text,
  work_type          text,
  stitched           boolean,
  pieces_included    text,
  shade              text,
  volume             text,
  skin_type          text,
  expiry             text,
  batch              text,
  ingredients        text,
  how_to_use         text,
  safety             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.products IS
  'Catalog products. status gates public visibility (only active is public). code preserves the legacy "p1".."p10" id used by cart/wishlist localStorage.';

CREATE INDEX idx_products_category_id ON public.products (category_id);
CREATE INDEX idx_products_status ON public.products (status);
CREATE INDEX idx_products_status_sort ON public.products (status, sort_order);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. product_media
-- ============================================================
CREATE TABLE public.product_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt         text,
  kind        text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video')),
  sort_order  integer NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_media_product_sort ON public.product_media (product_id, sort_order);
-- At most one primary media row per product.
CREATE UNIQUE INDEX uq_product_media_one_primary
  ON public.product_media (product_id) WHERE is_primary;

CREATE TRIGGER trg_product_media_updated_at
  BEFORE UPDATE ON public.product_media
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. product_size_stock
-- ============================================================
CREATE TABLE public.product_size_stock (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size        text NOT NULL,
  quantity    integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size)
);

CREATE TRIGGER trg_product_size_stock_updated_at
  BEFORE UPDATE ON public.product_size_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 5. product_reviews
-- ============================================================
CREATE TABLE public.product_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  author_name  text NOT NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'approved'
                 CHECK (status IN ('pending','approved','rejected')),
  seed_key     text UNIQUE,                            -- deterministic idempotency key for seeding
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_reviews_product_status ON public.product_reviews (product_id, status);

-- ============================================================
-- 6. Row Level Security — public SELECT only, no public writes.
-- ============================================================
ALTER TABLE public.product_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_media       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_size_stock  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_reviews     ENABLE ROW LEVEL SECURITY;

-- Active categories are public.
CREATE POLICY product_categories_public_read ON public.product_categories
  FOR SELECT TO anon, authenticated
  USING (is_active);

-- A product is public only when active AND its category is active.
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.product_categories c
      WHERE c.id = products.category_id AND c.is_active
    )
  );

-- Child rows are visible only when their parent product is publicly visible.
CREATE POLICY product_media_public_read ON public.product_media
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.product_categories c ON c.id = p.category_id
      WHERE p.id = product_media.product_id AND p.status = 'active' AND c.is_active
    )
  );

CREATE POLICY product_size_stock_public_read ON public.product_size_stock
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.product_categories c ON c.id = p.category_id
      WHERE p.id = product_size_stock.product_id AND p.status = 'active' AND c.is_active
    )
  );

-- Reviews additionally require approval.
CREATE POLICY product_reviews_public_read ON public.product_reviews
  FOR SELECT TO anon, authenticated
  USING (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.product_categories c ON c.id = p.category_id
      WHERE p.id = product_reviews.product_id AND p.status = 'active' AND c.is_active
    )
  );
