import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, Ticket, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/coupons")({ component: Coupons });

// TODO: Coupons MUST be validated server-side at checkout (code existence, expiry,
// usage caps, per-customer limits, min order, category eligibility). This UI is mock only.

interface Coupon {
  id: string;
  code: string;
  discountType: "percent" | "fixed" | "free-shipping";
  value: number;
  minOrder: number;
  maxUses: number;
  perCustomer: number;
  expiry: string;
  category: string;
  active: boolean;
  used: number;
}

const SEED: Coupon[] = [
  {
    id: "1",
    code: "EID2026",
    discountType: "percent",
    value: 15,
    minOrder: 2000,
    maxUses: 200,
    perCustomer: 1,
    expiry: "2026-07-15",
    category: "All",
    active: true,
    used: 42,
  },
  {
    id: "2",
    code: "FREESHIP",
    discountType: "free-shipping",
    value: 0,
    minOrder: 1500,
    maxUses: 500,
    perCustomer: 2,
    expiry: "2026-12-31",
    category: "All",
    active: true,
    used: 120,
  },
  {
    id: "3",
    code: "WELCOME10",
    discountType: "percent",
    value: 10,
    minOrder: 0,
    maxUses: 1000,
    perCustomer: 1,
    expiry: "2026-06-01",
    category: "Kurti",
    active: false,
    used: 8,
  },
];

const CATEGORIES = ["All", "Kurti", "Saree", "Three Piece", "Girls Dress", "Cosmetics"];

function discountLabel(c: Coupon) {
  if (c.discountType === "free-shipping") return "Free delivery";
  if (c.discountType === "percent") return `${c.value}% off`;
  return `৳${c.value} off`;
}

function Coupons() {
  const [coupons, setCoupons] = useState<Coupon[]>(SEED);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: Coupon) => {
    setEditing(c);
    setOpen(true);
  };

  const save = (c: Coupon) => {
    setCoupons((prev) => {
      const exists = prev.some((p) => p.id === c.id);
      return exists ? prev.map((p) => (p.id === c.id ? c : p)) : [...prev, c];
    });
    setOpen(false);
    toast.success(editing ? "Coupon updated (demo)" : "Coupon created (demo)");
    // TODO: persist coupon via backend
  };

  const toggle = (id: string) =>
    setCoupons((prev) => prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));

  return (
    <div>
      <AdminHeader
        title="Coupons"
        description="Create and manage discount codes."
        action={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New coupon
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {coupons.map((c) => (
          <div
            key={c.id}
            className="relative overflow-hidden rounded-xl border border-border bg-card"
          >
            {/* ticket notches */}
            <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
            <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
            <div className="flex items-stretch">
              <div className="grid w-12 place-items-center border-r border-dashed border-border bg-gold/10 text-gold">
                <Ticket className="h-5 w-5 text-gold" />
              </div>
              <div className="flex-1 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-display text-xl tracking-wide text-primary">{c.code}</span>
                  <Badge
                    variant="outline"
                    className={
                      c.active
                        ? "border-success/40 text-success"
                        : "border-border text-muted-foreground"
                    }
                  >
                    {c.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{discountLabel(c)}</p>
                <p className="text-xs text-muted-foreground">
                  Min {c.minOrder ? `৳${c.minOrder}` : "—"} · {c.category} · exp {c.expiry}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.used}/{c.maxUses} used · {c.perCustomer}/customer
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleteId(c.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Switch checked={c.active} onCheckedChange={() => toggle(c.id)} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <CouponDialog open={open} onOpenChange={setOpen} editing={editing} onSave={save} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              This coupon will no longer work at checkout. This is a mock action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setCoupons((prev) => prev.filter((p) => p.id !== deleteId));
                setDeleteId(null);
                toast.success("Coupon deleted (demo)");
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CouponDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Coupon | null;
  onSave: (c: Coupon) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit coupon" : "New coupon"}</DialogTitle>
          <DialogDescription>
            Validation here is UI-only — the backend must re-validate.
          </DialogDescription>
        </DialogHeader>
        <form
          id="coupon-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const code = String(fd.get("code") || "")
              .trim()
              .toUpperCase();
            if (!code) {
              toast.error("Coupon code is required");
              return;
            }
            onSave({
              id: editing?.id ?? String(Date.now()),
              code,
              discountType: String(fd.get("discountType")) as Coupon["discountType"],
              value: Number(fd.get("value") || 0),
              minOrder: Number(fd.get("minOrder") || 0),
              maxUses: Number(fd.get("maxUses") || 0),
              perCustomer: Number(fd.get("perCustomer") || 1),
              expiry: String(fd.get("expiry") || ""),
              category: String(fd.get("category") || "All"),
              active: fd.get("active") === "on",
              used: editing?.used ?? 0,
            });
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Code</Label>
            <Input
              name="code"
              defaultValue={editing?.code}
              placeholder="EID2026"
              className="uppercase"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Discount type</Label>
            <Select name="discountType" defaultValue={editing?.discountType ?? "percent"}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentage</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
                <SelectItem value="free-shipping">Free shipping</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Value</Label>
            <Input name="value" type="number" min={0} defaultValue={editing?.value ?? 0} />
          </div>
          <div className="space-y-1.5">
            <Label>Minimum order (৳)</Label>
            <Input name="minOrder" type="number" min={0} defaultValue={editing?.minOrder ?? 0} />
          </div>
          <div className="space-y-1.5">
            <Label>Max uses</Label>
            <Input name="maxUses" type="number" min={0} defaultValue={editing?.maxUses ?? 100} />
          </div>
          <div className="space-y-1.5">
            <Label>Per-customer limit</Label>
            <Input
              name="perCustomer"
              type="number"
              min={1}
              defaultValue={editing?.perCustomer ?? 1}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Expiry date</Label>
            <Input name="expiry" type="date" defaultValue={editing?.expiry} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Applicable category</Label>
            <Select name="category" defaultValue={editing?.category ?? "All"}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <span className="text-sm text-foreground">Active</span>
            <Switch name="active" defaultChecked={editing?.active ?? true} />
          </label>
        </form>
        <DialogFooter>
          <Button type="submit" form="coupon-form">
            {editing ? "Save changes" : "Create coupon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
