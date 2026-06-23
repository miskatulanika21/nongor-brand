import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AdminHeader, AdminSectionCard } from "@/components/admin/AdminUI";
import { listInventory, adjustInventory } from "@/lib/catalog-admin.api";
import type { InventoryItem, InventoryMovement } from "@/lib/server/catalog-admin.server";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Boxes, History, Loader2 } from "lucide-react";

const LOW_STOCK = 10;

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({ meta: [{ title: "Inventory · Nongorr Admin" }] }),
  loader: async () => {
    const res = await listInventory();
    return {
      items: res.success ? res.items : [],
      movements: res.success ? res.movements : [],
      loadError: !res.success,
    };
  },
  component: Inventory,
});

function statusOf(stock: number): { label: string; cls: string } {
  if (stock === 0) return { label: "Out of stock", cls: "border-destructive/40 text-destructive" };
  if (stock <= LOW_STOCK) return { label: "Low stock", cls: "border-gold/40 text-primary" };
  return { label: "Healthy", cls: "border-success/40 text-success" };
}

function Inventory() {
  const { items, movements, loadError } = Route.useLoaderData();
  const router = useRouter();

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.invalidate();

  const categoryNames = useMemo(
    () => Array.from(new Set(items.map((i) => i.categoryName).filter(Boolean))).sort(),
    [items],
  );

  const visible = items.filter((r) => {
    if (categoryFilter !== "all" && r.categoryName !== categoryFilter) return false;
    if (lowOnly && r.stock > LOW_STOCK) return false;
    return true;
  });

  const visibleCodes = new Set(visible.map((r) => r.code));
  const selectedVisible = [...selected].filter((c) => visibleCodes.has(c));

  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const toggleAll = () => {
    if (selectedVisible.length === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((r) => r.code)));
  };

  const bulkZeroNonVariant = async () => {
    const targets = visible.filter((r) => selectedVisible.includes(r.code) && r.sizes.length === 0);
    const skipped = selectedVisible.length - targets.length;
    if (targets.length === 0) {
      toast.error("Selected products have size variants — adjust their sizes individually.");
      return;
    }
    setBusy(true);
    const results = await Promise.all(
      targets.map((r) =>
        adjustInventory({
          data: { code: r.code, size: null, quantity: 0, reason: "Bulk set to zero", note: null },
        }),
      ),
    );
    setBusy(false);
    const failed = results.filter((x) => !x.success).length;
    if (failed) toast.error(`${failed} update(s) failed.`);
    else
      toast.success(
        `${targets.length} product(s) set to 0${skipped ? ` · ${skipped} variant product(s) skipped` : ""}.`,
      );
    setSelected(new Set());
    await refresh();
  };

  return (
    <div>
      <AdminHeader
        title="Inventory"
        description="Track and adjust stock. Every change is recorded in the movement ledger."
      />

      {loadError && (
        <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Inventory could not be loaded. Refresh to try again.
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[170px]" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categoryNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={lowOnly}
              onCheckedChange={(v) => setLowOnly(!!v)}
              aria-label="Show low stock only"
            />
            Low stock only
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          {visible.length} of {items.length} shown
        </p>
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="p-3">
                <Checkbox
                  checked={visible.length > 0 && selectedVisible.length === visible.length}
                  onCheckedChange={toggleAll}
                  aria-label="Select all visible products"
                />
              </th>
              <th scope="col" className="p-3">
                Product
              </th>
              <th scope="col" className="p-3">
                Category
              </th>
              <th scope="col" className="p-3">
                Stock
              </th>
              <th scope="col" className="p-3">
                Status
              </th>
              <th scope="col" className="p-3 text-right">
                Adjust
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const st = statusOf(r.stock);
              return (
                <tr key={r.code} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(r.code)}
                      onCheckedChange={() => toggle(r.code)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {r.image ? (
                        <img src={r.image} alt={r.name} className="h-10 w-9 rounded object-cover" />
                      ) : (
                        <div className="grid h-10 w-9 place-items-center rounded bg-muted text-[0.6rem] text-muted-foreground">
                          N/A
                        </div>
                      )}
                      <span className="line-clamp-1 text-foreground">
                        {r.name}
                        {r.sizes.length > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">(variants)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="p-3">{r.categoryName}</td>
                  <td className="p-3 font-medium text-foreground">{r.stock}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={st.cls}>
                      {st.label}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setAdjustTarget(r)}
                    >
                      Adjust
                    </Button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-muted-foreground">
                  No products match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {visible.map((r) => {
          const st = statusOf(r.stock);
          return (
            <div key={r.code} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(r.code)}
                  onCheckedChange={() => toggle(r.code)}
                  aria-label={`Select ${r.name}`}
                />
                {r.image ? (
                  <img src={r.image} alt={r.name} className="h-14 w-12 rounded object-cover" />
                ) : (
                  <div className="grid h-14 w-12 place-items-center rounded bg-muted text-[0.6rem] text-muted-foreground">
                    N/A
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.categoryName} · {r.stock} in stock
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className={st.cls}>
                      {st.label}
                    </Badge>
                    {r.sizes.length > 0 && (
                      <span className="text-xs text-muted-foreground">variants</span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                disabled={busy}
                onClick={() => setAdjustTarget(r)}
              >
                Adjust stock
              </Button>
            </div>
          );
        })}
      </div>

      {selectedVisible.length > 0 && (
        <div className="admin-bulk-bar mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">{selectedVisible.length} selected</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={bulkZeroNonVariant}>
              Set non-variant stock to 0
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8">
        <AdminSectionCard
          title={
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-gold" /> Adjustment history
            </span>
          }
        >
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {movements.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
                >
                  <span className="text-foreground">
                    {m.productName}
                    {m.size ? ` · ${m.size}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {m.previousQuantity} → {m.newQuantity} ({m.delta >= 0 ? "+" : ""}
                    {m.delta}) · {m.reason} · {new Date(m.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminSectionCard>
      </div>

      <AdjustDialog
        target={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onApplied={async () => {
          setAdjustTarget(null);
          await refresh();
        }}
      />
    </div>
  );
}

function AdjustDialog({
  target,
  onClose,
  onApplied,
}: {
  target: InventoryItem | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const sizes = target?.sizes ?? [];
  const [variant, setVariant] = useState<string>("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("Manual adjustment");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      const first = target.sizes[0];
      setVariant(first?.size ?? "");
      setValue(String(first ? first.quantity : target.stock));
      setReason("Manual adjustment");
    }
  }, [target]);

  if (!target) return null;
  const num = Number(value);
  const valid = Number.isInteger(num) && num >= 0 && reason.trim().length > 0;

  const apply = async () => {
    if (!valid) return;
    setSaving(true);
    const res = await adjustInventory({
      data: {
        code: target.code,
        size: sizes.length > 0 ? variant : null,
        quantity: num,
        reason: reason.trim(),
        note: null,
      },
    });
    setSaving(false);
    if (res.success) {
      toast.success("Stock updated.");
      onApplied();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock — {target.name}</DialogTitle>
          <DialogDescription>
            Sets the new quantity and records a movement in the ledger.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {sizes.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="adj-variant">Size variant</Label>
              <Select
                value={variant}
                onValueChange={(v) => {
                  setVariant(v);
                  setValue(String(sizes.find((s) => s.size === v)?.quantity ?? 0));
                }}
              >
                <SelectTrigger id="adj-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s.size} value={s.size}>
                      {s.size} (current {s.quantity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Total stock recalculates from variant quantities.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="adj-value">New quantity</Label>
            <Input
              id="adj-value"
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {!(Number.isInteger(num) && num >= 0) && (
              <p className="text-xs text-destructive">Enter a non-negative whole number.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={apply}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}{" "}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
