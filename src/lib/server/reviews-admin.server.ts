/**
 * Reviews ADMIN repository — SERVER ONLY. Uses the service-role client, so it
 * sees reviews of EVERY status (pending/approved/rejected) regardless of RLS.
 * Authorization is enforced upstream (guardAdminWrite / requirePermission);
 * this layer assumes the caller is already verified.
 *
 * Moderation mutations go through SECURITY DEFINER api.* RPCs that write the
 * canonical audit row and let the product_reviews trigger resync
 * products.rating / review_count. Errors are re-thrown as ReviewError carrying a
 * STABLE code (see REVIEW_ERROR_MESSAGES) — no raw SQL ever reaches the client.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { KNOWN_REVIEW_ERROR_CODES, type ReviewStatus } from "@/lib/catalog-admin.schema";

export class ReviewError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ReviewError";
  }
}

function throwReviewError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new ReviewError(KNOWN_REVIEW_ERROR_CODES.has(raw) ? raw : "internal_error");
}

export interface AdminReview {
  id: string;
  productCode: string;
  productName: string;
  authorName: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  createdAt: string;
}

interface AdminReviewRow {
  id: string;
  author_name: string;
  rating: number;
  body: string;
  status: string;
  created_at: string;
  product: { code: string; name: string } | null;
}

const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };

/** Every review (any status), newest within each status group, pending first. */
export async function fetchAdminReviews(limit = 200): Promise<AdminReview[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("product_reviews")
    .select("id, author_name, rating, body, status, created_at, product:products ( code, name )")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ReviewError("internal_error");
  return ((data ?? []) as unknown as AdminReviewRow[])
    .map((r) => ({
      id: r.id,
      productCode: r.product?.code ?? "",
      productName: r.product?.name ?? "(deleted product)",
      authorName: r.author_name,
      rating: r.rating,
      body: r.body,
      status: r.status as ReviewStatus,
      createdAt: r.created_at,
    }))
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export async function setReviewStatus(
  id: string,
  status: ReviewStatus,
  actorId: string,
): Promise<{ productId: string; changed: boolean }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("set_review_status", {
    p_review_id: id,
    p_status: status,
    p_actor_id: actorId,
  });
  if (error) throwReviewError(error);
  const r = data as { product_id: string; changed: boolean };
  return { productId: r.product_id, changed: r.changed };
}

export async function deleteReview(id: string, actorId: string): Promise<{ productId: string }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("delete_review", {
    p_review_id: id,
    p_actor_id: actorId,
  });
  if (error) throwReviewError(error);
  const r = data as { product_id: string };
  return { productId: r.product_id };
}

/**
 * Customer submission (Pass 3b). Called by the customer server function AFTER it
 * has verified the authenticated session; `userId` is that verified user. The
 * review lands as `pending` for moderation (never affects the public rating).
 */
export async function submitReview(
  input: { code: string; authorName: string; rating: number; body: string },
  userId: string,
): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("submit_review", {
    p_code: input.code,
    p_author_name: input.authorName,
    p_rating: input.rating,
    p_body: input.body,
    p_user_id: userId,
  });
  if (error) throwReviewError(error);
}
