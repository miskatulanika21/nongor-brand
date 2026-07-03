import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  useAccountUI,
  isPositiveNumber,
  formatUpdated,
  measurementDisplay,
  MEASURE_FIELDS,
  FIT_PREFERENCES,
  type MeasurementProfile,
  type FitPreference,
} from "@/lib/account-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Ruler, Plus, Pencil, Trash2, Copy, BookOpen } from "lucide-react";

export const Route = createFileRoute("/_site/account/measurements")({
  component: MeasurementsPage,
});

const NAME_MAX = 40;

type MeasureForm = {
  name: string;
  fitPreference: FitPreference;
} & Record<(typeof MEASURE_FIELDS)[number]["key"], string>;

const EMPTY_FORM: MeasureForm = {
  name: "",
  fitPreference: "Regular",
  bust: "",
  waist: "",
  hip: "",
  shoulder: "",
  sleeve: "",
  dressLength: "",
};

function MeasurementsPage() {
  const {
    hydrated,
    measurements,
    addMeasurement,
    updateMeasurement,
    duplicateMeasurement,
    deleteMeasurement,
  } = useAccountUI();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MeasureForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const confirm = useConfirm();

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(m: MeasurementProfile) {
    setEditingId(m.id);
    setForm({
      name: m.name,
      fitPreference: m.fitPreference,
      bust: m.bust,
      waist: m.waist,
      hip: m.hip,
      shoulder: m.shoulder,
      sleeve: m.sleeve,
      dressLength: m.dressLength,
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
    if (!form.name.trim()) e.name = "Profile name is required.";
    else if (form.name.trim().length > NAME_MAX)
      e.name = `Keep the name under ${NAME_MAX} characters.`;
    for (const field of MEASURE_FIELDS) {
      const v = form[field.key];
      if (!v.trim()) e[field.key] = `${field.label} is required.`;
      else if (!isPositiveNumber(v)) e[field.key] = `${field.label} must be a positive number.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSave() {
    if (saving || !validate()) return;
    const base = {
      name: form.name.trim(),
      fitPreference: form.fitPreference,
      bust: form.bust.trim(),
      waist: form.waist.trim(),
      hip: form.hip.trim(),
      shoulder: form.shoulder.trim(),
      sleeve: form.sleeve.trim(),
      dressLength: form.dressLength.trim(),
    };

    setSaving(true);
    const ok = editingId
      ? await updateMeasurement({ ...base, id: editingId, updatedAt: "" })
      : await addMeasurement(base);
    setSaving(false);

    if (ok) {
      toast.success(editingId ? "Measurements updated" : "Measurement profile saved");
      handleDialogChange(false);
    }
    // On failure the provider shows the specific error; keep the dialog open.
  }

  async function onDuplicate(id: string) {
    if (await duplicateMeasurement(id)) toast.success("Profile duplicated");
  }

  async function onDelete(m: MeasurementProfile) {
    await confirm({
      tone: "danger",
      title: "Delete measurement profile?",
      description: `This will remove “${m.name}”. This can't be undone.`,
      confirmText: "Delete",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        if (await deleteMeasurement(m.id)) toast.success("Profile removed");
      },
    });
  }

  if (!hydrated) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl text-foreground">Measurement profiles</h2>
          <p className="text-sm text-muted-foreground">
            Save your measurements to your account to speed up custom-size orders.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          <Plus className="mr-2 h-4 w-4" /> Add new
        </Button>
      </div>

      <Button asChild variant="link" className="h-auto p-0 text-primary">
        <Link to="/size-guide">
          <BookOpen className="mr-2 h-4 w-4" /> How to measure
        </Link>
      </Button>

      {measurements.length === 0 ? (
        <EmptyState
          icon={<Ruler className="h-6 w-6" />}
          title="No measurement profiles yet"
          description="Create a profile like “My Regular Fit” so custom-size orders are quick and accurate."
          primaryAction={
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Create a profile
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {measurements.map((m) => (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 truncate font-display text-lg text-foreground">{m.name}</h3>
                <Badge variant="outline" className="shrink-0">
                  {m.fitPreference}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{formatUpdated(m.updatedAt)}</p>

              <dl className="account-measure-grid mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {MEASURE_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="font-medium text-foreground">{measurementDisplay(m[f.key])}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDuplicate(m.id)}>
                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(m)}
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
            <DialogTitle>{editingId ? "Edit measurements" : "New measurement profile"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <MField label="Profile name" error={errors.name}>
              <Input
                value={form.name}
                maxLength={NAME_MAX}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My Regular Fit"
              />
            </MField>

            <div className="grid gap-4 sm:grid-cols-2">
              {MEASURE_FIELDS.map((f) => (
                <MField key={f.key} label={`${f.label} (in)`} error={errors[f.key]}>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    inputMode="decimal"
                    value={form[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className={cn(errors[f.key] && "border-destructive")}
                  />
                </MField>
              ))}
            </div>

            <MField label="Fit preference">
              <Select
                value={form.fitPreference}
                onValueChange={(v) => setForm((f) => ({ ...f, fitPreference: v as FitPreference }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIT_PREFERENCES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleDialogChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Save profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
