import { createFileRoute } from "@tanstack/react-router";
import { AdminHeader } from "@/components/admin/AdminUI";
import { PRODUCTS } from "@/lib/products";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reviews")({ component: Reviews });

function Reviews() {
  const all = PRODUCTS.flatMap((p) => (p.reviews ?? []).map((r) => ({ ...r, product: p.name })));
  return (
    <div>
      <AdminHeader title="Reviews" description="Approve and moderate customer reviews." />
      <div className="space-y-3">
        {all.slice(0, 8).map((r, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg text-foreground">{r.name}</span>
                <StarRating rating={r.rating} />
              </div>
              <p className="text-xs text-muted-foreground">on {r.product}</p>
              <p className="mt-1 text-sm text-muted-foreground">“{r.text}”</p>
            </div>
            <div className="flex gap-2">
              <Badge
                variant="outline"
                className={
                  i % 3 === 0 ? "border-gold/40 text-primary" : "border-success/40 text-success"
                }
              >
                {i % 3 === 0 ? "Pending" : "Approved"}
              </Badge>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => toast.success("Approved")}
              >
                <Check className="h-4 w-4 text-success" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => toast("Hidden")}
              >
                <X className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
