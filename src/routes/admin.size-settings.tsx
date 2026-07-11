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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Ruler, Plus, Pencil, Trash2, Loader2, Star, X, Columns3, Rows3 } from "lucide-react";
import { toast } from "sonner";
import {
  loadSizeCharts,
  saveSizeChart,
  setSizeChartActiveFn,
  deleteSizeChartFn,
} from "@/lib/sizes.api";
import { sizeChartInputSchema, type AdminSizeChart } from "@/lib/sizes-shared";

export const Route = createFileRoute("/admin/size-settings")({
  head: () => ({ meta: [{ title: "Size Settings · Nongorr Admin" }] }),
  loader: async () => {
    const res = await loadSizeCharts();
    return { charts: res.success ? res.charts : [], loadError: !res.success };
  },
  component: SizeSettings,
});

function SizeSettings() {
  const { charts, loadError } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<AdminSizeChart | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => router.invalidate();

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (c: AdminSizeChart) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const toggle = async (c: AdminSizeChart) => {
    setBusyId(c.id);
    const res = await setSizeChartActiveFn({ data: { id: c.id, active: !c.is_active } });
    setBusyId(null);
    if (res.success) {
      toast.success(`${c.name} ${c.is_active ? "hidden from" : "visible on"} the size guide.`);
      refresh();
    } else {
      toast.error(res.error);
    }
  };

  const askDelete = (c: AdminSizeChart) =>
    confirm({
      tone: "danger",
      title: `Delete the ${c.name} chart?`,
      description:
        "The chart is removed permanently. The size guide falls back to the built-in charts only when NO chart is live.",
      confirmText: "Delete",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        setBusyId(c.id);
        const res = await deleteSizeChartFn({ data: { id: c.id } });
        setBusyId(null);
        if (res.success) {
          toast.success("Size chart deleted.");
          refresh();
        } else {
          toast.error(res.error);
        }
      },
    });

  return (
    <div>
      <AdminHeader
        title="Size Settings"
        description="These charts power the storefront size guide and its size helper. Edits go live within a minute of saving."
        action={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New chart
          </Button>
        }
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Could not load size charts. Refresh to try again.
        </div>
      )}

      {charts.length === 0 && !loadError ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Ruler className="mx-auto mb-2 h-6 w-6 text-gold" />
          No charts yet. The size guide is showing the built-in charts.
        </div>
      ) : (
        <div className="space-y-3">
          {charts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Ruler className="h-4 w-4 shrink-0 text-gold" />
                  <span className="truncate font-display text-lg">{c.name}</span>
                  <Badge
                    variant="outline"
                    className={
                      c.is_active
                        ? "border-success/40 text-success"
                        : "border-border text-muted-foreground"
                    }
                  >
                    {c.is_active ? "Live" : "Hidden"}
                  </Badge>
                </span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  /{c.slug} · {c.rows.length} rows × {c.columns.length} columns · {c.unit}
                  {c.helper_column ? ` · helper: ${c.helper_column}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => askDelete(c)}
                  disabled={busyId === c.id}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {busyId === c.id && <Loader2 className="h-4 w-4 animate-spin text-gold" />}
                <Switch
                  checked={c.is_active}
                  disabled={busyId === c.id}
                  onCheckedChange={() => toggle(c)}
                  aria-label={c.is_active ? "Hide chart" : "Show chart"}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <ChartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => {
          setDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

interface RowState {
  label: string;
  values: string[];
  popular: boolean;
}

interface FormState {
  slug: string;
  name: string;
  unit: "in" | "cm";
  label_header: string;
  helper_column: string;
  note: string;
  sort_order: string;
  is_active: boolean;
  columns: string[];
  rows: RowState[];
}

function toForm(c: AdminSizeChart | null): FormState {
  return {
    slug: c?.slug ?? "",
    name: c?.name ?? "",
    unit: c?.unit ?? "in",
    label_header: c?.label_header ?? "Size",
    helper_column: c?.helper_column ?? "",
    note: c?.note ?? "",
    sort_order: c ? String(c.sort_order) : "0",
    is_active: c?.is_active ?? false,
    columns: c ? [...c.columns] : ["Bust", "Waist"],
    rows: c
      ? c.rows.map((r) => ({ label: r.label, values: [...r.values], popular: r.popular }))
      : [{ label: "S", values: ["", ""], popular: false }],
  };
}

function ChartDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: AdminSizeChart | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(editing));
  const [formKey, setFormKey] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Reset the form each time the dialog opens (key on id + open).
  const key = `${open}:${editing?.id ?? "new"}`;
  if (key !== formKey) {
    setFormKey(key);
    setForm(toForm(editing));
  }

  // ── Grid mutations (columns and rows stay aligned by construction) ─────────
  const setColumn = (i: number, name: string) =>
    setForm((f) => ({ ...f, columns: f.columns.map((c, ci) => (ci === i ? name : c)) }));
  const addColumn = () =>
    setForm((f) => ({
      ...f,
      columns: [...f.columns, ""],
      rows: f.rows.map((r) => ({ ...r, values: [...r.values, ""] })),
    }));
  const removeColumn = (i: number) =>
    setForm((f) => ({
      ...f,
      columns: f.columns.filter((_, ci) => ci !== i),
      helper_column: f.helper_column === f.columns[i] ? "" : f.helper_column,
      rows: f.rows.map((r) => ({ ...r, values: r.values.filter((_, vi) => vi !== i) })),
    }));
  const addRow = () =>
    setForm((f) => ({
      ...f,
      rows: [...f.rows, { label: "", values: f.columns.map(() => ""), popular: false }],
    }));
  const removeRow = (i: number) =>
    setForm((f) => ({ ...f, rows: f.rows.filter((_, ri) => ri !== i) }));
  const setRow = (i: number, patch: Partial<RowState>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r, ri) => (ri === i ? { ...r, ...patch } : r)) }));
  const setCell = (ri: number, vi: number, value: string) =>
    setForm((f) => ({
      ...f,
      rows: f.rows.map((r, i) =>
        i === ri ? { ...r, values: r.values.map((v, j) => (j === vi ? value : v)) } : r,
      ),
    }));

  const submit = async () => {
    const payload = {
      id: editing?.id,
      slug: form.slug,
      name: form.name,
      unit: form.unit,
      label_header: form.label_header,
      helper_column: form.helper_column || null,
      note: form.note || null,
      columns: form.columns,
      rows: form.rows,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active,
    };

    // Client-side validation for immediate field feedback (server re-validates).
    const parsed = sizeChartInputSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the chart fields.");
      return;
    }

    setSaving(true);
    const res = await saveSizeChart({ data: parsed.data });
    setSaving(false);
    if (res.success) {
      toast.success(res.created ? "Size chart created." : "Size chart updated.");
      onSaved();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit: ${editing.name}` : "New size chart"}</DialogTitle>
          <DialogDescription>
            The grid below renders exactly like the storefront size guide table.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Chart name</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Kurti"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Slug (chip id)</Label>
            <Input
              value={form.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase())}
              placeholder="kurti"
              maxLength={40}
              disabled={!!editing}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => set("unit", v as "in" | "cm")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Inches</SelectItem>
                <SelectItem value="cm">Centimetres</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>First column header</Label>
            <Input
              value={form.label_header}
              onChange={(e) => set("label_header", e.target.value)}
              placeholder="Size / Age"
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Size-helper column</Label>
            <Select
              value={form.helper_column || "__none__"}
              onValueChange={(v) => set("helper_column", v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {form.columns
                  .filter((c) => c.trim() !== "")
                  .map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Sort</Label>
            <Input
              type="number"
              min={0}
              max={1000}
              value={form.sort_order}
              onChange={(e) => set("sort_order", e.target.value)}
            />
          </div>
        </div>

        {/* ── Grid editor ─────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50">
                <th className="min-w-28 px-2 py-2 text-left">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {form.label_header || "Size"}
                  </span>
                </th>
                {form.columns.map((col, i) => (
                  <th key={i} className="min-w-24 px-1 py-2">
                    <div className="flex items-center gap-1">
                      <Input
                        value={col}
                        onChange={(e) => setColumn(i, e.target.value)}
                        placeholder="Column"
                        className="h-8 text-xs"
                        maxLength={40}
                      />
                      <button
                        type="button"
                        onClick={() => removeColumn(i)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove column"
                        disabled={form.columns.length <= 1}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 text-center">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Popular
                  </span>
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <Input
                      value={row.label}
                      onChange={(e) => setRow(ri, { label: e.target.value })}
                      placeholder="S / 4–5 Years"
                      className="h-8 text-xs"
                      maxLength={40}
                    />
                  </td>
                  {row.values.map((v, vi) => (
                    <td key={vi} className="px-1 py-1.5">
                      <Input
                        value={v}
                        onChange={(e) => setCell(ri, vi, e.target.value)}
                        className="h-8 text-xs"
                        maxLength={20}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => setRow(ri, { popular: !row.popular })}
                      title={row.popular ? "Unmark Most Selected" : "Mark as Most Selected"}
                    >
                      <Star
                        className={
                          row.popular
                            ? "h-4 w-4 fill-gold text-gold"
                            : "h-4 w-4 text-muted-foreground"
                        }
                      />
                    </button>
                  </td>
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeRow(ri)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove row"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Rows3 className="h-3.5 w-3.5" /> Add row
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addColumn}
            disabled={form.columns.length >= 12}
          >
            <Columns3 className="h-3.5 w-3.5" /> Add column
          </Button>
          <span className="text-xs text-muted-foreground">
            ★ marks the “Most Selected” badge shown on the storefront.
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label>Note (optional, shown under the chart)</Label>
            <Input
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              maxLength={300}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm text-foreground">Live on size guide</span>
            <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
          </label>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create chart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
