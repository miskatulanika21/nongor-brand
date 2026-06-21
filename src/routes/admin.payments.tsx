import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { ORDERS, type Order } from "@/lib/orders";
import { formatBDT } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Check, X, Eye, RotateCcw, Flag, ImageIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/payments")({
  component: Payments,
});

type PayState = "Pending" | "Verified" | "Rejected" | "Correction" | "Suspicious";

const pendingSeed: Order[] = [
  ...ORDERS,
  { ...ORDERS[1], id: "NGR-100262", customer: "Mim Chowdhury", paymentStatus: "Pending" },
  {
    ...ORDERS[0],
    id: "NGR-100263",
    customer: "Sadia Islam",
    paymentStatus: "Pending",
    trxId: "5K4J3H2G1F",
  },
];

const STATE_TONE: Record<PayState, string> = {
  Pending: "border-gold/40 text-primary",
  Verified: "border-success/40 text-success",
  Rejected: "border-destructive/40 text-destructive",
  Correction: "border-gold/40 text-gold-foreground",
  Suspicious: "border-destructive/40 text-destructive",
};

function Payments() {
  const [states, setStates] = useState<Record<string, PayState>>(() =>
    Object.fromEntries(pendingSeed.map((o) => [o.id, o.paymentStatus as PayState])),
  );

  const setState = (id: string, s: PayState, msg: string) => {
    setStates((prev) => ({ ...prev, [id]: s }));
    toast.success(msg);
    // TODO: persist payment verification + notify customer via backend
  };

  return (
    <div>
      <AdminHeader
        title="Payments"
        description="Verify manual bKash payments before confirming orders."
      />
      <div className="space-y-3">
        {pendingSeed.map((o) => {
          const st = states[o.id] ?? "Pending";
          return (
            <div key={o.id} className="rounded-xl border border-border bg-card p-5">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_auto] lg:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-lg text-foreground">{o.id}</p>
                    <Badge variant="outline" className={cn(STATE_TONE[st])}>
                      {st}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {o.customer} · {o.phone}
                  </p>
                </div>
                <div className="text-sm">
                  <p>
                    Payable:{" "}
                    <span className="font-semibold text-primary">{formatBDT(o.total)}</span>
                  </p>
                  <p className="text-muted-foreground">Sender bKash: {o.senderNumber}</p>
                  <p className="text-muted-foreground">
                    TrxID: <span className="font-medium text-foreground">{o.trxId}</span>
                  </p>
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Eye className="h-4 w-4" /> Screenshot
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{o.id} · Payment screenshot</DialogTitle>
                    </DialogHeader>
                    <div className="grid h-72 place-items-center rounded-lg border border-dashed border-border bg-secondary text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <ImageIcon className="h-4 w-4" /> No screenshot uploaded (demo)
                      </span>
                    </div>
                    <Textarea placeholder="Internal admin note…" />
                  </DialogContent>
                </Dialog>
              </div>

              <Textarea className="mt-4" placeholder="Admin note for this payment…" rows={2} />

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90"
                  onClick={() => setState(o.id, "Verified", "Payment verified")}
                >
                  <Check className="h-4 w-4" /> Verify
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/5"
                  onClick={() => setState(o.id, "Rejected", "Payment rejected")}
                >
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setState(o.id, "Correction", "Correction requested")}
                >
                  <RotateCcw className="h-4 w-4" /> Request correction
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/5"
                  onClick={() => setState(o.id, "Suspicious", "Flagged as suspicious")}
                >
                  <Flag className="h-4 w-4" /> Flag suspicious
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
