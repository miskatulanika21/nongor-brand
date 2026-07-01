import { createFileRoute, useRouter } from "@tanstack/react-router";
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
import { Plus, Ticket, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadCoupons, saveCoupon, setCouponActive, deleteCoupon } from "@/lib/coupons.api";
import {
  couponInputSchema,
  couponValueLabel,
  type AdminCoupon,
  type CouponType,
} from "@/lib/coupons-shared";

export const Route = createFileRoute("/admin/coupons")({
  head: () => ({ meta: [{ title: "Coupons · Nongorr Admin" }] }),
  loader: async () => {
    const res = await loadCoupons();
    return { coupons: res.success ? res.coupons : [], loadError: !res.success };
  },
  component: Coupons,
});

const TYPE_LABEL: Record<CouponType, string> = {
  percent: "Percentage",
  fixed: "Fixed amount",
  free_shipping: "Free shipping",
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB");
}

function Coupons() {
  const { coupons, loadError } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCoupon | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const refresh = () => router.invalidate();

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (c: AdminCoupon) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const toggle = async (c: AdminCoupon) => {
    setBusyCode(c.code);
    const res = await setCouponActive({ data: { code: c.code, active: !c.active } });
    setBusyCode(null);
    if (res.success) {
      toast.success(`${c.code} ${c.active ? "disabled" : "enabled"}.`);
      refresh();
    } else {
      toast.error(res.error);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const code = deleteTarget.code;
    setDeleteTarget(null);
    setBusyCode(code);
    const res = await deleteCoupon({ data: { code } });
    setBusyCode(null);
    if (res.success) {
      toast.success(`Coupon ${code} deleted.`);
      refresh();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <div>
      <AdminHeader
        title="Coupons"
        description="Create and manage discount codes. Validation is enforced server-side at checkout."
        action={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New coupon
          </Button>
        }
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Could not load coupons. Refresh to try again.
        </div>
      )}

      {coupons.length === 0 && !loadError ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Ticket className="mx-auto mb-2 h-6 w-6 text-gold" />
          No coupons yet. Create your first discount code.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coupons.map((c) => {
            const start = fmtDate(c.starts_at);
            const end = fmtDate(c.ends_at);
            return (
              <div
                key={c.code}
                className="relative overflow-hidden rounded-xl border border-border bg-card"
              >
                <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
                <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
                <div className="flex items-stretch">
                  <div className="grid w-12 place-items-center border-r border-dashed border-border bg-gold/10 text-gold">
                    {busyCode === c.code ? (
                      <Loader2 className="h-5 w-5 animate-spin text-gold" />
                    ) : (
                      <Ticket className="h-5 w-5 text-gold" />
                    )}
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-xl tracking-wide text-primary">
                        {c.code}
                      </span>
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
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {couponValueLabel(c)}
                      {c.type === "percent" && c.max_discount ? ` (max ৳${c.max_discount})` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Min {c.min_subtotal ? `৳${c.min_subtotal}` : "—"}
                      {end ? ` · exp ${end}` : ""}
                      {start ? ` · from ${start}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.usage_count}
                      {c.usage_limit ? `/${c.usage_limit}` : ""} used
                      {c.per_user_limit ? ` · ${c.per_user_limit}/customer` : ""}
                      {c.first_order_only ? " · 1st order" : ""}
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
                          onClick={() => setDeleteTarget(c)}
                          disabled={busyCode === c.code}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Switch
                        checked={c.active}
                        disabled={busyCode === c.code}
                        onCheckedChange={() => toggle(c)}
                        aria-label={c.active ? "Disable coupon" : "Enable coupon"}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CouponDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => {
          setDialogOpen(false);
          refresh();
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the coupon permanently. A coupon that has already been used cannot be
              deleted — disable it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormState {
  code: string;
  description: string;
  type: CouponType;
  value: string;
  min_subtotal: string;
  max_discount: string;
  usage_limit: string;
  per_user_limit: string;
  first_order_only: boolean;
  starts_at: string;
  ends_at: string;
  active: boolean;
}

function toForm(c: AdminCoupon | null): FormState {
  return {
    code: c?.code ?? "",
    description: c?.description ?? "",
    type: c?.type ?? "percent",
    value: c ? String(c.value) : "10",
    min_subtotal: c ? String(c.min_subtotal) : "0",
    max_discount: c?.max_discount != null ? String(c.max_discount) : "",
    usage_limit: c?.usage_limit != null ? String(c.usage_limit) : "",
    per_user_limit: c?.per_user_limit != null ? String(c.per_user_limit) : "",
    first_order_only: c?.first_order_only ?? false,
    starts_at: c?.starts_at ? c.starts_at.slice(0, 10) : "",
    ends_at: c?.ends_at ? c.ends_at.slice(0, 10) : "",
    active: c?.active ?? true,
  };
}

function CouponDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: AdminCoupon | null;
  onSaved: () => void;
}) {
  // Reset the form each time the dialog opens (key on code + open).
  const [form, setForm] = useState<FormState>(() => toForm(editing));
  const [formKey, setFormKey] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const key = `${open}:${editing?.code ?? "new"}`;
  if (key !== formKey) {
    setFormKey(key);
    setForm(toForm(editing));
  }

  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

  const submit = async () => {
    const payload = {
      code: form.code,
      description: form.description.trim() === "" ? null : form.description,
      type: form.type,
      value: form.type === "free_shipping" ? 0 : Number(form.value || 0),
      min_subtotal: Number(form.min_subtotal || 0),
      max_discount: numOrNull(form.max_discount),
      usage_limit: numOrNull(form.usage_limit),
      per_user_limit: numOrNull(form.per_user_limit),
      first_order_only: form.first_order_only,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      active: form.active,
    };

    // Client-side validation for immediate field feedback (server re-validates).
    const parsed = couponInputSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the coupon fields.");
      return;
    }

    setSaving(true);
    const res = await saveCoupon({ data: parsed.data });
    setSaving(false);
    if (res.success) {
      toast.success(res.created ? `Coupon ${res.coupon.code} created.` : "Coupon updated.");
      onSaved();
    } else {
      toast.error(res.error);
    }
  };

  const isPercent = form.type === "percent";
  const isFree = form.type === "free_shipping";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.code}` : "New coupon"}</DialogTitle>
          <DialogDescription>
            Coupons are validated and consumed server-side at checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Code</Label>
            <Input
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="EID2026"
              className="uppercase"
              disabled={!!editing}
            />
            {editing && (
              <p className="text-xs text-muted-foreground">A coupon code can't be renamed.</p>
            )}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description (optional)</Label>
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Eid festive discount"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Discount type</Label>
            <Select value={form.type} onValueChange={(v) => set("type", v as CouponType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABEL) as CouponType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{isPercent ? "Percent (1–100)" : "Value (৳)"}</Label>
            <Input
              type="number"
              min={0}
              value={isFree ? "0" : form.value}
              onChange={(e) => set("value", e.target.value)}
              disabled={isFree}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Minimum order (৳)</Label>
            <Input
              type="number"
              min={0}
              value={form.min_subtotal}
              onChange={(e) => set("min_subtotal", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Max discount (৳, optional)</Label>
            <Input
              type="number"
              min={1}
              value={form.max_discount}
              onChange={(e) => set("max_discount", e.target.value)}
              placeholder={isPercent ? "e.g. 500" : "—"}
              disabled={!isPercent}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Total uses (optional)</Label>
            <Input
              type="number"
              min={1}
              value={form.usage_limit}
              onChange={(e) => set("usage_limit", e.target.value)}
              placeholder="Unlimited"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Per-customer limit (optional)</Label>
            <Input
              type="number"
              min={1}
              value={form.per_user_limit}
              onChange={(e) => set("per_user_limit", e.target.value)}
              placeholder="Unlimited"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Starts (optional)</Label>
            <Input
              type="date"
              value={form.starts_at}
              onChange={(e) => set("starts_at", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Expires (optional)</Label>
            <Input
              type="date"
              value={form.ends_at}
              onChange={(e) => set("ends_at", e.target.value)}
            />
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm text-foreground">First order only</span>
            <Switch
              checked={form.first_order_only}
              onCheckedChange={(v) => set("first_order_only", v)}
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm text-foreground">Active</span>
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </label>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create coupon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
