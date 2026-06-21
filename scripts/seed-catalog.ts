/**
 * Seed Catalog Script — idempotent.
 *
 * Seeds the initial catalog (categories, products, media, size stock, reviews)
 * from the pure fixture in scripts/seed/catalog-fixture.ts into Supabase using
 * the service-role key (bypasses RLS).
 *
 * Safety:
 *   - Requires SEED_CONFIRM=1 to run (guards against accidental seeding).
 *   - Validates the project ref derived from VITE_SUPABASE_URL and prints it for
 *     confirmation. If EXPECTED_SUPABASE_REF is set, asserts an exact match.
 *   - Never prints the service-role key.
 *
 * Idempotency:
 *   - Categories upserted on `slug`, products upserted on `code`.
 *   - Per-product child rows (media, size_stock, reviews) are replaced
 *     (delete-then-insert) so re-running converges to the same state and obsolete
 *     rows are removed. Running twice yields identical counts/relationships.
 *
 * Usage:
 *   SEED_CONFIRM=1 npx tsx scripts/seed-catalog.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { CATEGORY_SEED, PRODUCT_SEED, type ProductSeed } from "./seed/catalog-fixture";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

// Derive the project ref from the URL host (e.g. https://<ref>.supabase.co).
function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).host; // <ref>.supabase.co
    const ref = host.split(".")[0];
    return ref || null;
  } catch {
    return null;
  }
}

const projectRef = projectRefFromUrl(SUPABASE_URL);
if (!projectRef) {
  console.error("❌ Could not derive a project ref from VITE_SUPABASE_URL.");
  process.exit(1);
}

const expectedRef = process.env.EXPECTED_SUPABASE_REF;
if (expectedRef && expectedRef !== projectRef) {
  console.error(
    `❌ Project ref mismatch: VITE_SUPABASE_URL points at "${projectRef}" but EXPECTED_SUPABASE_REF is "${expectedRef}". Aborting.`,
  );
  process.exit(1);
}

console.log(`\n🌱 Nongorr Studio — Catalog Seed`);
console.log(`   Target project ref: ${projectRef}`);

if (process.env.SEED_CONFIRM !== "1") {
  console.error(
    `\n❌ Refusing to seed without confirmation.\n   Re-run with SEED_CONFIRM=1 once you've verified the project ref above.\n`,
  );
  process.exit(1);
}

const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function toProductRow(p: ProductSeed, categoryId: string) {
  return {
    code: p.code,
    slug: p.slug,
    name: p.name,
    category_id: categoryId,
    price: p.price,
    sale_price: p.salePrice,
    stock: p.stock,
    rating: p.rating,
    review_count: p.reviewCount,
    status: p.status,
    sort_order: p.sortOrder,
    is_new: p.isNew,
    is_handmade: p.isHandmade,
    is_best_seller: p.isBestSeller,
    has_video: p.hasVideo,
    custom_size: p.customSize,
    custom_size_charge: p.customSizeCharge,
    color: p.color,
    colors: p.colors,
    fabric: p.fabric,
    occasion: p.occasion,
    description: p.description,
    care: p.care,
    blouse_piece: p.blousePiece,
    length: p.length,
    work_type: p.workType,
    stitched: p.stitched,
    pieces_included: p.piecesIncluded,
    shade: p.shade,
    volume: p.volume,
    skin_type: p.skinType,
    expiry: p.expiry,
    batch: p.batch,
    ingredients: p.ingredients,
    how_to_use: p.howToUse,
    safety: p.safety,
  };
}

function fail(label: string, error: { message: string } | null): asserts error is null {
  if (error) {
    console.error(`❌ ${label}: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  // 1. Categories (upsert on slug).
  const categoryRows = CATEGORY_SEED.map((c) => ({
    slug: c.slug,
    name: c.name,
    sort_order: c.sortOrder,
    is_active: true,
  }));
  {
    const { error } = await db
      .from("product_categories")
      .upsert(categoryRows, { onConflict: "slug" });
    fail("Upsert categories", error);
  }

  const { data: cats, error: catErr } = await db.from("product_categories").select("id, slug");
  fail("Read categories", catErr);
  const categoryIdBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));

  // 2. Products (upsert on code).
  const productRows = PRODUCT_SEED.map((p) => {
    const categoryId = categoryIdBySlug.get(p.categorySlug);
    if (!categoryId) {
      console.error(`❌ Unknown category slug "${p.categorySlug}" for product ${p.code}`);
      process.exit(1);
    }
    return toProductRow(p, categoryId);
  });
  {
    const { error } = await db.from("products").upsert(productRows, { onConflict: "code" });
    fail("Upsert products", error);
  }

  const { data: prods, error: prodErr } = await db.from("products").select("id, code");
  fail("Read products", prodErr);
  const productIdByCode = new Map((prods ?? []).map((p) => [p.code, p.id]));

  // 3. Per-product children: replace (delete-then-insert) for clean idempotency.
  for (const p of PRODUCT_SEED) {
    const productId = productIdByCode.get(p.code);
    if (!productId) {
      console.error(`❌ Product id not found after upsert for code ${p.code}`);
      process.exit(1);
    }

    // Media
    fail(
      `Clear media (${p.code})`,
      (await db.from("product_media").delete().eq("product_id", productId)).error,
    );
    if (p.media.length) {
      const { error } = await db.from("product_media").insert(
        p.media.map((m) => ({
          product_id: productId,
          url: m.url,
          alt: m.alt,
          kind: m.kind,
          sort_order: m.sortOrder,
          is_primary: m.isPrimary,
        })),
      );
      fail(`Insert media (${p.code})`, error);
    }

    // Size stock
    fail(
      `Clear sizes (${p.code})`,
      (await db.from("product_size_stock").delete().eq("product_id", productId)).error,
    );
    if (p.sizes.length) {
      const { error } = await db.from("product_size_stock").insert(
        p.sizes.map((s) => ({
          product_id: productId,
          size: s.size,
          quantity: s.quantity,
          sort_order: s.sortOrder,
        })),
      );
      fail(`Insert sizes (${p.code})`, error);
    }

    // Reviews
    fail(
      `Clear reviews (${p.code})`,
      (await db.from("product_reviews").delete().eq("product_id", productId)).error,
    );
    if (p.reviews.length) {
      const { error } = await db.from("product_reviews").insert(
        p.reviews.map((r) => ({
          product_id: productId,
          author_name: r.authorName,
          rating: r.rating,
          body: r.body,
          status: r.status,
          seed_key: r.seedKey,
          created_at: r.createdAt,
        })),
      );
      fail(`Insert reviews (${p.code})`, error);
    }
  }

  // 4. Report counts.
  const counts: Record<string, number> = {};
  for (const table of [
    "product_categories",
    "products",
    "product_media",
    "product_size_stock",
    "product_reviews",
  ] as const) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    fail(`Count ${table}`, error);
    counts[table] = count ?? 0;
  }

  console.log("\n✅ Seed complete. Row counts:");
  for (const [table, n] of Object.entries(counts)) {
    console.log(`   ${table.padEnd(22)} ${n}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err instanceof Error ? err.message : "Unknown error");
  process.exit(1);
});
