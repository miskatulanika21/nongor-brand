import { createFileRoute } from "@tanstack/react-router";
import { cloneElement, isValidElement, useId, useState, type ReactElement } from "react";
import { useAccountUI, isValidAccountPhone, type SavedAddress } from "@/lib/account-ui";
import { normalizeBDPhone } from "@/lib/bd-phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MapPin, Plus, Pencil, Trash2, Star } from "lucide-react";

export const Route = createFileRoute("/_site/account/addresses")({
  component: AddressesPage,
});

const ADDRESS_MAX = 300;

interface AddrForm {
  recipient: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  label: string;
}

const EMPTY_FORM: AddrForm = {
  recipient: "",
  phone: "",
  district: "",
  area: "",
  address: "",
  label: "",
};

function AddressesPage() {
  const { hydrated, addresses, addAddress, updateAddress, deleteAddress, setDefaultAddress } =
    useAccountUI();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AddrForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const confirm = useConfirm();

  const set =
    (k: keyof AddrForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(a: SavedAddress) {
    setEditingId(a.id);
    setForm({
      recipient: a.recipient,
      phone: a.phone,
      district: a.district,
      area: a.area,
      address: a.address,
      label: a.label ?? "",
    });
    setErrors({});
    setDialogOpen(true);
  }

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditingId(null);
      setForm(EMPTY_FORM);
      setErrors({});
    }
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!form.recipient.trim()) e.recipient = "Recipient name is required.";
    if (!form.phone.trim()) e.phone = "Phone is required.";
    else if (!isValidAccountPhone(form.phone))
      e.phone = "Enter a valid Bangladeshi number (01XXXXXXXXX).";
    if (!form.district.trim()) e.district = "District is required.";
    if (!form.area.trim()) e.area = "Area or thana is required.";
    if (!form.address.trim()) e.address = "Full address is required.";
    else if (form.address.trim().length > ADDRESS_MAX)
      e.address = `Keep the address under ${ADDRESS_MAX} characters.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSave() {
    if (saving || !validate()) return;
    const base = {
      recipient: form.recipient.trim(),
      phone: normalizeBDPhone(form.phone),
      district: form.district.trim(),
      area: form.area.trim(),
      address: form.address.trim(),
      label: form.label.trim() || undefined,
    };

    setSaving(true);
    let ok: boolean;
    if (editingId) {
      const existing = addresses.find((a) => a.id === editingId);
      ok = await updateAddress({
        ...base,
        id: editingId,
        isDefault: existing?.isDefault ?? false,
      });
    } else {
      ok = await addAddress({ ...base, isDefault: false });
    }
    setSaving(false);

    if (ok) {
      toast.success(editingId ? "Address updated" : "Address added");
      handleDialogChange(false);
    }
    // On failure the provider shows the specific error; keep the dialog open.
  }

  async function onDelete(a: SavedAddress) {
    await confirm({
      tone: "danger",
      title: "Delete address?",
      description: `This will remove the address for ${a.label || a.recipient}. This can't be undone.`,
      confirmText: "Delete",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        if (await deleteAddress(a.id)) toast.success("Address removed");
      },
    });
  }

  async function onSetDefault(id: string) {
    if (await setDefaultAddress(id)) toast.success("Default address updated");
  }

  if (!hydrated) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl text-foreground">Delivery addresses</h2>
          <p className="text-sm text-muted-foreground">
            Keep your delivery addresses ready for faster checkout — saved to your account.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          <Plus className="mr-2 h-4 w-4" /> Add address
        </Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-6 w-6" />}
          title="No saved addresses"
          description="Add a delivery address to reuse it at checkout, on any device."
          primaryAction={
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Add your first address
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <div
              key={a.id}
              className={cn(
                "rounded-2xl border bg-card p-5",
                a.isDefault ? "border-primary/40" : "border-border",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-medium text-foreground">{a.recipient}</p>
                  {a.isDefault && (
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      Default
                    </Badge>
                  )}
                </div>
              </div>
              {a.label && (
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{a.label}</p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">{a.phone}</p>
              <p className="mt-2 text-sm text-foreground">{a.address}</p>
              <p className="text-sm text-muted-foreground">
                {a.area}, {a.district}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {!a.isDefault && (
                  <Button variant="ghost" size="sm" onClick={() => onSetDefault(a.id)}>
                    <Star className="mr-2 h-4 w-4" /> Set default
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(a)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit address" : "Add address"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <AddrField label="Label (optional)" error={errors.label}>
              <Input value={form.label} onChange={set("label")} placeholder="Home, Office…" />
            </AddrField>
            <AddrField label="Recipient name" error={errors.recipient}>
              <Input value={form.recipient} onChange={set("recipient")} />
            </AddrField>
            <AddrField label="Phone" error={errors.phone}>
              <Input
                inputMode="tel"
                value={form.phone}
                onChange={set("phone")}
                placeholder="01XXXXXXXXX"
              />
            </AddrField>
            <div className="grid gap-4 sm:grid-cols-2">
              <AddrField label="District" error={errors.district}>
                <Input value={form.district} onChange={set("district")} />
              </AddrField>
              <AddrField label="Area / thana" error={errors.area}>
                <Input value={form.area} onChange={set("area")} />
              </AddrField>
            </div>
            <AddrField label="Full address" error={errors.address}>
              <Textarea
                value={form.address}
                onChange={set("address")}
                maxLength={ADDRESS_MAX}
                rows={3}
              />
            </AddrField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleDialogChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddrField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as Record<string, unknown>).id ?? id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error
          ? [(children.props as Record<string, unknown>)["aria-describedby"], errorId]
              .filter(Boolean)
              .join(" ")
          : (children.props as Record<string, unknown>)["aria-describedby"],
      })
    : children;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {control}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
