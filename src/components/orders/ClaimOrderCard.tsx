/**
 * Guest-order claim affordance (Stage 4 P7). Shown wherever a visitor holds a
 * valid order-number + capability-token pair (order-success, /track).
 *
 * Signed in  → one tap sends the pair to claimGuestOrderFn; the token is the
 *              only proof (never phone/email matching). A same-user retry is
 *              an idempotent success.
 * Signed out → a sign-in link that round-trips back to the tracking URL, where
 *              the signed-in variant of this card takes over.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { claimGuestOrderFn } from "@/lib/orders.api";
import type { ClaimGuestOrderResult } from "@/lib/orders-shared";

interface ClaimOrderCardProps {
  orderNo: string;
  token: string;
  signedIn: boolean;
  /** Fires after the server confirms the claim (or that it was already yours). */
  onClaimed: (result: ClaimGuestOrderResult) => void;
}

export function ClaimOrderCard({ orderNo, token, signedIn, onClaimed }: ClaimOrderCardProps) {
  const [claiming, setClaiming] = useState(false);

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await claimGuestOrderFn({ data: { orderNo, token } });
      if (res.success) {
        toast.success(
          res.result.alreadyOwned
            ? "This order is already in your account."
            : "Order added to your account.",
        );
        onClaimed(res.result);
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Could not add the order to your account. Please try again.");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <UserRound className="h-4 w-4" />
          </div>
          <div>
            <p className="font-medium text-foreground">Add this order to your account</p>
            <p className="mt-0.5 text-muted-foreground">
              {signedIn
                ? "It will always be in your order history — no tracking link needed."
                : "Sign in and it will always be in your order history — no tracking link needed."}
            </p>
          </div>
        </div>
        {signedIn ? (
          <Button size="sm" onClick={claim} disabled={claiming}>
            {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {claiming ? "Adding…" : "Add to my account"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/login"
              search={{
                next: `/track?o=${encodeURIComponent(orderNo)}&t=${encodeURIComponent(token)}`,
              }}
            >
              Sign in to add it
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
