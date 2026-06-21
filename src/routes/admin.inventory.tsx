import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AdminHeader,
  PreviewNotice,
  AdminSectionCard,
  MockBadge,
} from "@/components/admin/AdminUI";
import { PRODUCTS, PRODUCT_TYPE_LABEL, type ProductType } from "@/lib/products";
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
import { Boxes, History } from "lucide-react";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({ meta: [{ title: "Inventory · Nongorr Admin" }] }),
  component: Inventory,
});

interface InventoryRecord {
  productId: string;
  name: string;
  image: string;
  type: ProductType;
  stock: number;
  sizeStock?: Record<string, number>;
  lowStockThreshold: number;
}

interface HistoryEntry {
  id: string;
  product: string;
  variant?: string;
  previous: number;
  next: number;
  reason: string;
  at: string;
}

function buildInventory(): InventoryRecord[] {
  return PRODUCTS.map((p) => ({
    productId: p.id,
    name: p.name,
    image: p.image,
    type: p.type,
    stock: p.sizeStock ? Object.values(p.sizeStock).reduce((s, q) => s + q, 0) : p.stock,
    sizeStock: p.sizeStock ? { ...p.sizeStock } : undefined,
    lowStockThreshold: 10,
  }));
}

function statusOf(stock: number, threshold: number): { label: string; cls: string } {
  if (stock === 0) return { label: "Out of stock", cls: "border-destructive/40 text-destructive" };
  if (stock <= threshold) return { label: "Low stock", cls: "border-gold/40 text-primary" };
  return { label: "Healthy", cls: "border-success/40 text-success" };
}

function Inventory() {
  const [records, setRecords] = useState<InventoryRecord[]>(buildInventory);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjustTarget, setAdjustTarget] = useState<InventoryRecord | null>(null);
  const [bulkThreshold, setBulkThreshold] = useState("");

  const types = useMemo(() => Array.from(new Set(PRODUCTS.map((p) => p.type))), []);

  const visible = records.filter((r) => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (lowOnly && r.stock > r.lowStockThreshold) return false;
    return true;
  });

  const visibleIds = new Set(visible.map((r) => r.productId));
  const selectedVisible = [...selected].filter((id) => visibleIds.has(id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selectedVisible.length === visible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.productId)));
    }
  };

  const applyAdjustment = (
    rec: InventoryRecord,
    variant: string | undefined,
    nextValue: number,
    reason: string,
  ) => {
    setRecords((rs) =>
      rs.map((r) => {
        if (r.productId !== rec.productId) return r;
        if (variant && r.sizeStock) {
          const sizeStock = { ...r.sizeStock, [variant]: nextValue };
          const total = Object.values(sizeStock).reduce((s, q) => s + q, 0);
          return { ...r, sizeStock, stock: total };
        }
        return { ...r, stock: nextValue };
      }),
    );
    const previous = variant && rec.sizeStock ? rec.sizeStock[variant] : rec.stock;
    setHistory((h) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product: rec.name,
        variant,
        previous,
        next: nextValue,
        reason,
        at: new Date().toLocaleString(),
      },
      ...h,
    ]);
    toast("Updated in this local preview. Reloading the page will restore the original mock data.");
  };

  const bulkSetThreshold = () => {
    const t = Number(bulkThreshold);
    if (!Number.isFinite(t) || t < 0) {
      toast.error("Enter a valid non-negative threshold.");
      return;
    }
    setRecords((rs) =>
      rs.map((r) => (selectedVisible.includes(r.productId) ? { ...r, lowStockThreshold: t } : r)),
    );
    toast(`${selectedVisible.length} low-stock thresholds updated in this local preview.`);
  };

  const bulkZeroNonVariant = () => {
    const targets = visible.filter((r) => selectedVisible.includes(r.productId));
    const adjustable = targets.filter((r) => !r.sizeStock);
    const skipped = targets.length - adjustable.length;
    setRecords((rs) =>
      rs.map((r) => (adjustable.some((a) => a.productId === r.productId) ? { ...r, stock: 0 } : r)),
    );
    adjustable.forEach((r) =>
      setHistory((h) => [
        {
          id: `${Date.now()}-${r.productId}`,
          product: r.name,
          previous: r.stock,
          next: 0,
          reason: "Bulk set to 0 (preview)",
          at: new Date().toLocaleString(),
        },
        ...h,
      ]),
    );
    toast(
      `${adjustable.length} products adjusted locally. ${skipped} variant products were skipped and require size-level changes.`,
    );
    setSelected(new Set());
  };

  return (
    <div>
      <AdminHeader title="Inventory" description="Track and adjust stock — local preview only." />
      <PreviewNotice className="mb-5" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[170px]" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {PRODUCT_TYPE_LABEL[t]}
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
          {visible.length} of {records.length} shown
        </p>
      </div>

      {/* Desktop table */}
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
              const st = statusOf(r.stock, r.lowStockThreshold);
              return (
                <tr key={r.productId} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(r.productId)}
                      onCheckedChange={() => toggle(r.productId)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <img src={r.image} alt={r.name} className="h-10 w-9 rounded object-cover" />
                      <span className="line-clamp-1 text-foreground">
                        {r.name}
                        {r.sizeStock && (
                          <span className="ml-1 text-xs text-muted-foreground">(variants)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="p-3">{PRODUCT_TYPE_LABEL[r.type]}</td>
                  <td className="p-3 font-medium text-foreground">{r.stock}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={st.cls}>
                      {st.label}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setAdjustTarget(r)}>
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

      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {visible.map((r) => {
          const st = statusOf(r.stock, r.lowStockThreshold);
          return (
            <div key={r.productId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(r.productId)}
                  onCheckedChange={() => toggle(r.productId)}
                  aria-label={`Select ${r.name}`}
                />
                <img src={r.image} alt={r.name} className="h-14 w-12 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {PRODUCT_TYPE_LABEL[r.type]} · {r.stock} in stock
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className={st.cls}>
                      {st.label}
                    </Badge>
                    {r.sizeStock && <span className="text-xs text-muted-foreground">variants</span>}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setAdjustTarget(r)}
              >
                Adjust stock
              </Button>
            </div>
          );
        })}
      </div>

      {/* Bulk update */}
      {selectedVisible.length > 0 && (
        <div className="admin-bulk-bar mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-sm">
            <MockBadge /> {selectedVisible.length} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={bulkThreshold}
              onChange={(e) => setBulkThreshold(e.target.value)}
              placeholder="Low-stock threshold"
              className="h-9 w-40"
              type="number"
              min={0}
              aria-label="Bulk low-stock threshold"
            />
            <Button size="sm" variant="outline" onClick={bulkSetThreshold}>
              Set threshold
            </Button>
            <Button size="sm" variant="outline" onClick={bulkZeroNonVariant}>
              Set non-variant stock to 0
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* History */}
      <div className="mt-8">
        <AdminSectionCard
          title={
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-gold" /> Adjustment history
            </span>
          }
          action={<MockBadge label="Session only" />}
        >
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No adjustments made in this preview session. Reloading clears this history.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
                >
                  <span className="text-foreground">
                    {h.product}
                    {h.variant ? ` · ${h.variant}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {h.previous} → {h.next} · {h.reason} · {h.at}
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
        onApply={applyAdjustment}
      />
    </div>
  );
}

function AdjustDialog({
  target,
  onClose,
  onApply,
}: {
  target: InventoryRecord | null;
  onClose: () => void;
  onApply: (
    rec: InventoryRecord,
    variant: string | undefined,
    next: number,
    reason: string,
  ) => void;
}) {
  const sizes = target?.sizeStock ? Object.keys(target.sizeStock) : [];
  const [variant, setVariant] = useState<string>("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("Manual adjustment");

  // Reset on target change.
  useEffect(() => {
    if (target) {
      const firstSize = target.sizeStock ? Object.keys(target.sizeStock)[0] : "";
      setVariant(firstSize);
      setValue(String(target.sizeStock ? (target.sizeStock[firstSize] ?? 0) : target.stock));
      setReason("Manual adjustment");
    }
  }, [target]);

  if (!target) return null;
  const num = Number(value);
  const valid = Number.isInteger(num) && num >= 0;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock — {target.name}</DialogTitle>
          <DialogDescription>
            Local preview only · Changes reset when this page reloads.
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
                  setValue(String(target.sizeStock?.[v] ?? 0));
                }}
              >
                <SelectTrigger id="adj-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s} (current {target.sizeStock?.[s] ?? 0})
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
            {!valid && (
              <p className="text-xs text-destructive">Enter a non-negative whole number.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onApply(
                target,
                sizes.length > 0 ? variant : undefined,
                num,
                reason || "Manual adjustment",
              );
              onClose();
            }}
          >
            <Boxes className="h-4 w-4" /> Apply (preview)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
