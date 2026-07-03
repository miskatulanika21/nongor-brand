import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AdminHeader, ViewToggle } from "@/components/admin/AdminUI";
import { listReviews, moderateReview, removeReview } from "@/lib/reviews-admin.api";
import type { AdminReview } from "@/lib/server/reviews-admin.server";
import type { ReviewStatus } from "@/lib/catalog-admin.schema";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Check, Loader2, MessageSquare, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({ meta: [{ title: "Reviews · Nongorr Admin" }] }),
  loader: async () => {
    const res = await listReviews();
    return { reviews: res.success ? res.reviews : [], loadError: !res.success };
  },
  component: Reviews,
});

type Filter = ReviewStatus | "all";

const STATUS_BADGE: Record<ReviewStatus, string> = {
  pending: "border-gold/40 text-primary",
  approved: "border-success/40 text-success",
  rejected: "border-destructive/40 text-destructive",
};

function Reviews() {
  const { reviews, loadError } = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const refresh = () => router.invalidate();

  const counts = useMemo(() => {
    const c = { all: reviews.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of reviews) c[r.status] += 1;
    return c;
  }, [reviews]);

  const visible = filter === "all" ? reviews : reviews.filter((r) => r.status === filter);

  const moderate = async (review: AdminReview, status: ReviewStatus) => {
    setBusyId(review.id);
    const res = await moderateReview({ data: { id: review.id, status } });
    setBusyId(null);
    if (res.success) {
      toast.success(
        status === "approved"
          ? "Review approved — it now shows on the storefront."
          : status === "rejected"
            ? "Review rejected — hidden from the storefront."
            : "Review moved back to pending.",
      );
      await refresh();
    } else {
      toast.error(res.error);
    }
  };

  const askDelete = (review: AdminReview) =>
    confirm({
      tone: "danger",
      title: "Delete this review?",
      description: (
        <>
          This permanently removes {review.authorName}&rsquo;s review of {review.productName}. To
          merely hide it, use Reject instead.
        </>
      ),
      confirmText: "Delete",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        setBusyId(review.id);
        const res = await removeReview({ data: { id: review.id } });
        setBusyId(null);
        if (res.success) {
          toast.success("Review deleted.");
          await refresh();
        } else {
          toast.error(res.error);
        }
      },
    });

  return (
    <div>
      <AdminHeader
        title="Reviews"
        description="Approve, reject, or remove customer reviews. Approved reviews drive each product's public rating."
        action={
          <ViewToggle<Filter>
            value={filter}
            onValueChange={setFilter}
            label="Filter reviews by status"
            options={[
              { value: "pending", label: `Pending (${counts.pending})` },
              { value: "approved", label: `Approved (${counts.approved})` },
              { value: "rejected", label: `Rejected (${counts.rejected})` },
              { value: "all", label: `All (${counts.all})` },
            ]}
          />
        }
      />

      {loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
          <p className="text-sm text-destructive">Reviews could not be loaded.</p>
          <Button variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
            <MessageSquare className="h-6 w-6" />
          </div>
          <h3 className="font-display text-xl text-foreground">
            {filter === "pending" ? "Nothing awaiting moderation" : "No reviews here"}
          </h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {filter === "pending"
              ? "New customer reviews will appear here for approval."
              : "Try a different status filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const busy = busyId === r.id;
            return (
              <div
                key={r.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg text-foreground">{r.authorName}</span>
                    <StarRating rating={r.rating} />
                    <Badge variant="outline" className={STATUS_BADGE[r.status]}>
                      {r.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    on {r.productName} · {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">“{r.body}”</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {busy && <Loader2 className="h-8 w-4 animate-spin self-center text-gold" />}
                  {r.status !== "approved" && (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={busy}
                      title="Approve"
                      aria-label="Approve review"
                      onClick={() => moderate(r, "approved")}
                    >
                      <Check className="h-4 w-4 text-success" />
                    </Button>
                  )}
                  {r.status !== "rejected" && (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={busy}
                      title="Reject"
                      aria-label="Reject review"
                      onClick={() => moderate(r, "rejected")}
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                  {r.status !== "pending" && (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={busy}
                      title="Move back to pending"
                      aria-label="Move review back to pending"
                      onClick={() => moderate(r, "pending")}
                    >
                      <Undo2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    disabled={busy}
                    title="Delete permanently"
                    aria-label="Delete review"
                    onClick={() => askDelete(r)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
