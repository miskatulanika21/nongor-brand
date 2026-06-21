import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdminHeader,
  PreviewNotice,
  MockBadge,
  ViewToggle,
  createPreviewId,
} from "@/components/admin/AdminUI";
import { PRODUCTS, PRODUCT_TYPE_LABEL, type ProductType, type Product } from "@/lib/products";
import { formatBDT } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Copy,
  MoreHorizontal,
  X,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  List,
  Upload,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products")({
  head: () => ({ meta: [{ title: "Products · Nongorr Admin" }] }),
  component: ProductsAdmin,
});

const TYPES: ProductType[] = [
  "kurti",
  "saree",
  "three-piece",
  "girls-dress",
  "cosmetics",
  "makeup",
  "serum",
];
const STATUSES = ["active", "draft", "hidden", "archived"] as const;
type AdminProductStatus = (typeof STATUSES)[number];

const PREVIEW_FIELD_NOTE = "Local admin preview field · Not connected to the storefront model";

interface AdminProductRecord {
  source: Product;
  id: string;
  isPreviewCreated: boolean;
  status: AdminProductStatus;
  // public-ish editable mirror
  name: string;
  slug: string;
  type: ProductType;
  category: string;
  description: string;
  price: number;
  salePrice: number | null;
  stock: number;
  customSize: boolean;
  customSizeCharge: number;
  // admin-only fields
  tags: string[];
  altText: string;
  videoUrl: string;
  costPrice: string;
  taxNote: string;
  sku: string;
  lowStockThreshold: number;
  allowBackorder: boolean;
  processingTime: string;
  returnNote: string;
  countryOfOrigin: string;
  seoTitle: string;
  seoDescription: string;
}

function toRecord(p: Product): AdminProductRecord {
  return {
    source: p,
    id: p.id,
    isPreviewCreated: false,
    status: "active",
    name: p.name,
    slug: p.slug,
    type: p.type,
    category: p.category,
    description: p.description,
    price: p.price,
    salePrice: p.salePrice ?? null,
    stock: p.sizeStock ? Object.values(p.sizeStock).reduce((s, q) => s + q, 0) : p.stock,
    customSize: Boolean(p.customSize),
    customSizeCharge: p.customSizeCharge ?? 0,
    tags: [],
    altText: p.name,
    videoUrl: "",
    costPrice: "",
    taxNote: "",
    sku: p.id.toUpperCase(),
    lowStockThreshold: 10,
    allowBackorder: false,
    processingTime: "3–5 working days",
    returnNote: "",
    countryOfOrigin: "Bangladesh",
    seoTitle: p.name,
    seoDescription: p.description.slice(0, 150),
  };
}

const STATUS_TONE: Record<AdminProductStatus, string> = {
  active: "border-success/40 text-success",
  draft: "border-border text-muted-foreground",
  hidden: "border-gold/40 text-primary",
  archived: "border-destructive/40 text-destructive",
};

function ProductsAdmin() {
  const [records, setRecords] = useState<AdminProductRecord[]>(() => PRODUCTS.map(toRecord));
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [customFilter, setCustomFilter] = useState("all");
  const [view, setView] = useState<"table" | "card">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProductRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminProductRecord | null>(null);
  const [bulkAction, setBulkAction] = useState<null | "delete">(null);

  const visible = useMemo(() => {
    return records.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (customFilter === "custom" && !r.customSize) return false;
      if (customFilter === "standard" && r.customSize) return false;
      if (stockFilter === "in" && !(r.stock > r.lowStockThreshold)) return false;
      if (stockFilter === "low" && !(r.stock > 0 && r.stock <= r.lowStockThreshold)) return false;
      if (stockFilter === "out" && r.stock !== 0) return false;
      return true;
    });
  }, [records, q, typeFilter, statusFilter, stockFilter, customFilter]);

  const visibleIds = new Set(visible.map((r) => r.id));
  // Clear any selections that are no longer visible to avoid confusion.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => visibleIds.has(id)));
      return next.size === s.size ? s : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, typeFilter, statusFilter, stockFilter, customFilter]);

  const selectedVisible = [...selected].filter((id) => visibleIds.has(id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => {
    if (selectedVisible.length === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((r) => r.id)));
  };

  const setStatus = (ids: string[], status: AdminProductStatus) =>
    setRecords((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, status } : r)));

  const bulkStatus = (status: AdminProductStatus, verb: string) => {
    setStatus(selectedVisible, status);
    toast(
      `${selectedVisible.length} product(s) ${verb} in this local preview. Reloading restores the original mock data.`,
    );
    setSelected(new Set());
  };

  const bulkDelete = () => {
    setRecords((rs) => rs.filter((r) => !selectedVisible.includes(r.id)));
    toast(`${selectedVisible.length} product(s) removed from this local preview.`);
    setSelected(new Set());
    setBulkAction(null);
  };

  const duplicate = (r: AdminProductRecord) => {
    const copy: AdminProductRecord = {
      ...r,
      id: createPreviewId(),
      isPreviewCreated: true,
      status: "draft",
      name: `${r.name} (copy)`,
      tags: [...r.tags],
    };
    setRecords((rs) => [copy, ...rs]);
    toast("Duplicated as a new local preview record. It is not added to the catalog.");
  };

  const removeOne = (r: AdminProductRecord) => {
    setRecords((rs) => rs.filter((x) => x.id !== r.id));
    setDeleteTarget(null);
    toast("Removed from this local preview. Reloading restores the original mock data.");
  };

  const saveDraft = (draft: AdminProductRecord) => {
    setRecords((rs) => {
      const exists = rs.some((r) => r.id === draft.id);
      return exists ? rs.map((r) => (r.id === draft.id ? draft : r)) : [draft, ...rs];
    });
    toast("Updated in this local preview. Reloading the page will restore the original mock data.");
    setSheetOpen(false);
  };

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (r: AdminProductRecord) => {
    setEditing(r);
    setSheetOpen(true);
  };

  return (
    <div className="pb-20">
      <AdminHeader
        title="Products"
        description={`${records.length} products in this local preview`}
        action={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add product
          </Button>
        }
      />
      <PreviewNotice className="mb-5" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="relative xl:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="pl-9"
            aria-label="Search products"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {PRODUCT_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger aria-label="Filter by stock">
            <SelectValue placeholder="Stock" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stock</SelectItem>
            <SelectItem value="in">In stock</SelectItem>
            <SelectItem value="low">Low stock</SelectItem>
            <SelectItem value="out">Out of stock</SelectItem>
          </SelectContent>
        </Select>
        <Select value={customFilter} onValueChange={setCustomFilter}>
          <SelectTrigger aria-label="Filter by custom-size">
            <SelectValue placeholder="Custom size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sizing</SelectItem>
            <SelectItem value="custom">Custom-size enabled</SelectItem>
            <SelectItem value="standard">Standard only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{visible.length} shown</p>
        <ViewToggle
          value={view}
          onValueChange={setView}
          label="Product view"
          options={[
            { value: "table", label: "Table", icon: List },
            { value: "card", label: "Cards", icon: LayoutGrid },
          ]}
        />
      </div>

      {view === "table" ? (
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
                  Type
                </th>
                <th scope="col" className="p-3">
                  Price
                </th>
                <th scope="col" className="p-3">
                  Stock
                </th>
                <th scope="col" className="p-3">
                  Status
                </th>
                <th scope="col" className="p-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={r.source.image}
                        alt={r.altText || r.name}
                        className="h-12 w-10 rounded object-cover"
                      />
                      <div>
                        <span className="line-clamp-1 font-medium text-foreground">{r.name}</span>
                        {r.isPreviewCreated && (
                          <Badge variant="outline" className="mt-0.5 text-[0.6rem]">
                            Preview product
                          </Badge>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{PRODUCT_TYPE_LABEL[r.type]}</Badge>
                  </td>
                  <td className="p-3">
                    <span className="font-medium text-primary">
                      {formatBDT(r.salePrice ?? r.price)}
                    </span>
                    {r.salePrice != null && (
                      <span className="ml-1 text-xs text-muted-foreground line-through">
                        {formatBDT(r.price)}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        r.stock === 0
                          ? "border-destructive/40 text-destructive"
                          : r.stock <= r.lowStockThreshold
                            ? "border-gold/40 text-primary"
                            : "border-success/40 text-success",
                      )}
                    >
                      {r.stock}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={cn("capitalize", STATUS_TONE[r.status])}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <RowMenu
                      r={r}
                      onEdit={() => openEdit(r)}
                      onDuplicate={() => duplicate(r)}
                      onDelete={() => setDeleteTarget(r)}
                    />
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-muted-foreground">
                    No products match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Card grid (always on mobile, optional on desktop) */}
      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
          view === "table" ? "md:hidden" : "",
        )}
      >
        {visible.map((r) => (
          <div key={r.id} className="flex flex-col rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                className="mt-1"
                checked={selected.has(r.id)}
                onCheckedChange={() => toggle(r.id)}
                aria-label={`Select ${r.name}`}
              />
              <img
                src={r.source.image}
                alt={r.altText || r.name}
                className="h-16 w-14 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-foreground">{r.name}</p>
                <p className="text-xs text-muted-foreground">{PRODUCT_TYPE_LABEL[r.type]}</p>
                <p className="text-sm font-medium text-primary">
                  {formatBDT(r.salePrice ?? r.price)}
                </p>
              </div>
              <RowMenu
                r={r}
                onEdit={() => openEdit(r)}
                onDuplicate={() => duplicate(r)}
                onDelete={() => setDeleteTarget(r)}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  r.stock === 0
                    ? "border-destructive/40 text-destructive"
                    : r.stock <= r.lowStockThreshold
                      ? "border-gold/40 text-primary"
                      : "border-success/40 text-success",
                )}
              >
                {r.stock} in stock
              </Badge>
              <Badge variant="outline" className={cn("capitalize", STATUS_TONE[r.status])}>
                {r.status}
              </Badge>
              {r.isPreviewCreated && (
                <Badge variant="outline" className="text-[0.6rem]">
                  Preview product
                </Badge>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && view === "card" && (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            No products match your filters.
          </p>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedVisible.length > 0 && (
        <div className="admin-bulk-bar mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-sm">
            <MockBadge /> {selectedVisible.length} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkStatus("active", "published")}>
              Publish
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkStatus("hidden", "hidden")}>
              Hide
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkStatus("archived", "archived")}>
              Archive
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => setBulkAction("delete")}
            >
              Delete from preview
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Add / Edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          <ProductForm
            key={editing?.id ?? "new"}
            editing={editing}
            onCancel={() => setSheetOpen(false)}
            onSave={saveDraft}
          />
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from preview?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{deleteTarget?.name}</strong> from this local preview only. The
              catalog data is unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && removeOne(deleteTarget)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkAction === "delete"} onOpenChange={(o) => !o && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove selected products?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {selectedVisible.length} product(s) from this local preview only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={bulkDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RowMenu({
  r,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  r: AdminProductRecord;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <Copy className="h-4 w-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete from preview
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------------------- Product form ---------------------------- */

interface PreviewMediaItem {
  id: string;
  url: string;
  file?: File;
  source: "catalog" | "local";
}

interface DraftValues {
  name: string;
  slug: string;
  type: ProductType;
  category: string;
  description: string;
  price: string;
  salePrice: string;
  stock: string;
  customSize: boolean;
  customSizeCharge: string;
  tags: string;
  status: AdminProductStatus;
  altText: string;
  videoUrl: string;
  costPrice: string;
  taxNote: string;
  sku: string;
  lowStockThreshold: string;
  allowBackorder: boolean;
  processingTime: string;
  returnNote: string;
  countryOfOrigin: string;
  seoTitle: string;
  seoDescription: string;
}

function emptyDraft(): DraftValues {
  return {
    name: "",
    slug: "",
    type: "kurti",
    category: "",
    description: "",
    price: "",
    salePrice: "",
    stock: "0",
    customSize: false,
    customSizeCharge: "0",
    tags: "",
    status: "draft",
    altText: "",
    videoUrl: "",
    costPrice: "",
    taxNote: "",
    sku: "",
    lowStockThreshold: "10",
    allowBackorder: false,
    processingTime: "",
    returnNote: "",
    countryOfOrigin: "Bangladesh",
    seoTitle: "",
    seoDescription: "",
  };
}

function recordToDraft(r: AdminProductRecord): DraftValues {
  return {
    name: r.name,
    slug: r.slug,
    type: r.type,
    category: r.category,
    description: r.description,
    price: String(r.price),
    salePrice: r.salePrice != null ? String(r.salePrice) : "",
    stock: String(r.stock),
    customSize: r.customSize,
    customSizeCharge: String(r.customSizeCharge),
    tags: r.tags.join(", "),
    status: r.status,
    altText: r.altText,
    videoUrl: r.videoUrl,
    costPrice: r.costPrice,
    taxNote: r.taxNote,
    sku: r.sku,
    lowStockThreshold: String(r.lowStockThreshold),
    allowBackorder: r.allowBackorder,
    processingTime: r.processingTime,
    returnNote: r.returnNote,
    countryOfOrigin: r.countryOfOrigin,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
  };
}

function ProductForm({
  editing,
  onCancel,
  onSave,
}: {
  editing: AdminProductRecord | null;
  onCancel: () => void;
  onSave: (r: AdminProductRecord) => void;
}) {
  const [d, setD] = useState<DraftValues>(() => (editing ? recordToDraft(editing) : emptyDraft()));
  const [touched, setTouched] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Media: featured + gallery with stable IDs and object-URL cleanup.
  const [featured, setFeatured] = useState<PreviewMediaItem | null>(
    editing ? { id: "feat", url: editing.source.image, source: "catalog" } : null,
  );
  const [gallery, setGallery] = useState<PreviewMediaItem[]>(
    editing
      ? (editing.source.gallery ?? []).map((url, i) => ({
          id: `g-${i}`,
          url,
          source: "catalog" as const,
        }))
      : [],
  );
  const localUrls = useRef<Set<string>>(new Set());
  const featInput = useRef<HTMLInputElement>(null);
  const galInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = localUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const set = <K extends keyof DraftValues>(k: K, v: DraftValues[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const priceNum = Number(d.price);
  const saleNum = d.salePrice.trim() === "" ? null : Number(d.salePrice);
  const stockNum = Number(d.stock);
  const thresholdNum = Number(d.lowStockThreshold);
  const chargeNum = Number(d.customSizeCharge);

  const errors: Partial<Record<keyof DraftValues, string>> = {};
  if (!d.name.trim()) errors.name = "Title is required.";
  if (!d.slug.trim()) errors.slug = "Slug is required.";
  if (!d.category.trim()) errors.category = "Category is required.";
  if (!Number.isFinite(priceNum) || priceNum < 0) errors.price = "Enter a non-negative price.";
  if (saleNum != null && (!Number.isFinite(saleNum) || saleNum < 0 || saleNum >= priceNum))
    errors.salePrice = "Sale price must be below the regular price.";
  if (!Number.isInteger(stockNum) || stockNum < 0)
    errors.stock = "Stock must be a non-negative whole number.";
  if (!Number.isFinite(thresholdNum) || thresholdNum < 0)
    errors.lowStockThreshold = "Threshold must be non-negative.";
  if (d.customSize && (!Number.isFinite(chargeNum) || chargeNum < 0))
    errors.customSizeCharge = "Custom-size charge must be non-negative.";
  if (d.sku.length > 40) errors.sku = "SKU is too long (max 40).";

  const requiredValid =
    !errors.name &&
    !errors.slug &&
    !errors.category &&
    !errors.price &&
    !errors.salePrice &&
    !errors.stock &&
    !errors.lowStockThreshold &&
    !errors.customSizeCharge &&
    !errors.sku;
  const numericValid =
    !errors.price &&
    !errors.salePrice &&
    !errors.stock &&
    !errors.lowStockThreshold &&
    !errors.customSizeCharge;

  const buildRecord = (status: AdminProductStatus): AdminProductRecord => {
    const base = editing?.source ?? PRODUCTS[0];
    return {
      source: base,
      id: editing?.id ?? createPreviewId(),
      isPreviewCreated: editing?.isPreviewCreated ?? !editing,
      status,
      name: d.name.trim(),
      slug: d.slug.trim(),
      type: d.type,
      category: d.category.trim(),
      description: d.description,
      price: priceNum,
      salePrice: saleNum,
      stock: stockNum,
      customSize: d.customSize,
      customSizeCharge: chargeNum,
      tags: d.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      altText: d.altText,
      videoUrl: d.videoUrl,
      costPrice: d.costPrice,
      taxNote: d.taxNote,
      sku: d.sku,
      lowStockThreshold: thresholdNum,
      allowBackorder: d.allowBackorder,
      processingTime: d.processingTime,
      returnNote: d.returnNote,
      countryOfOrigin: d.countryOfOrigin,
      seoTitle: d.seoTitle,
      seoDescription: d.seoDescription,
    };
  };

  const handleSaveDraft = () => {
    setTouched(true);
    if (!numericValid) {
      toast.error("Fix the highlighted numeric fields.");
      return;
    }
    onSave(buildRecord("draft"));
  };
  const handlePublish = () => {
    setTouched(true);
    if (!requiredValid) {
      toast.error("Fix the highlighted fields before publishing.");
      return;
    }
    onSave(buildRecord("active"));
  };
  const handleArchive = () => {
    setTouched(true);
    if (!numericValid) {
      toast.error("Fix the highlighted numeric fields.");
      return;
    }
    onSave(buildRecord("archived"));
  };

  // Media handlers
  const replaceFeatured = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Images only.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max file size is 5 MB.");
      return;
    }
    if (featured?.source === "local") {
      URL.revokeObjectURL(featured.url);
      localUrls.current.delete(featured.url);
    }
    const url = URL.createObjectURL(file);
    localUrls.current.add(url);
    setFeatured({ id: createPreviewId(), url, file, source: "local" });
  };
  const removeFeatured = () => {
    if (featured?.source === "local") {
      URL.revokeObjectURL(featured.url);
      localUrls.current.delete(featured.url);
    }
    setFeatured(null);
  };
  const addGallery = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Images only.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max file size is 5 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    localUrls.current.add(url);
    setGallery((g) => [...g, { id: createPreviewId(), url, file, source: "local" }]);
  };
  const removeGallery = (item: PreviewMediaItem) => {
    if (item.source === "local") {
      URL.revokeObjectURL(item.url);
      localUrls.current.delete(item.url);
    }
    setGallery((g) => g.filter((x) => x.id !== item.id));
  };
  const moveGallery = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    setGallery((g) => {
      if (j < 0 || j >= g.length) return g;
      const n = [...g];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  const err = (k: keyof DraftValues) => touched && errors[k];

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-2xl">
          {editing ? "Edit product" : "Add a product"}
        </SheetTitle>
      </SheetHeader>
      <PreviewNotice className="px-1 pb-2" />

      <div className="flex-1 space-y-6 overflow-y-auto py-2">
        {/* Basic info */}
        <Section title="Basic information">
          <Field label="Title" error={err("name")}>
            <Input
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              aria-invalid={!!err("name")}
            />
          </Field>
          <Field label="Slug" error={err("slug")}>
            <Input
              value={d.slug}
              onChange={(e) => set("slug", e.target.value)}
              aria-invalid={!!err("slug")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={d.type} onValueChange={(v) => set("type", v as ProductType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PRODUCT_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Category" error={err("category")}>
              <Input
                value={d.category}
                onChange={(e) => set("category", e.target.value)}
                aria-invalid={!!err("category")}
              />
            </Field>
          </div>
          <Field label="Status">
            <Select value={d.status} onValueChange={(v) => set("status", v as AdminProductStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description">
            <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Tags (comma separated)" note={PREVIEW_FIELD_NOTE}>
            <Input
              value={d.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="festive, handmade"
            />
          </Field>
        </Section>

        {/* Media */}
        <Section title="Media">
          <Field label="Featured image">
            {featured ? (
              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                <img
                  src={featured.url}
                  alt={d.altText || d.name || "Featured preview"}
                  className="h-20 w-16 rounded object-cover"
                />
                <span className="flex-1 text-sm text-muted-foreground">
                  {featured.source === "local" ? "Local preview image" : "Bundled image"}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={removeFeatured}>
                  <X className="h-4 w-4" /> Remove
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground hover:border-primary">
                <Upload className="h-5 w-5" /> Choose image (max 5 MB)
                <input
                  ref={featInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) replaceFeatured(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </Field>
          <Field label="Gallery">
            <div className="flex flex-wrap gap-3">
              {gallery.map((item, i) => (
                <div
                  key={item.id}
                  className="relative h-24 w-20 overflow-hidden rounded-lg border border-border"
                >
                  <img
                    src={item.url}
                    alt={`${d.name || "Product"} gallery ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/80 px-1 py-0.5">
                    <button
                      type="button"
                      aria-label="Move left"
                      onClick={() => moveGallery(i, -1)}
                      disabled={i === 0}
                      className="text-muted-foreground hover:text-primary disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5 -rotate-90" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() => removeGallery(item)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move right"
                      onClick={() => moveGallery(i, 1)}
                      disabled={i === gallery.length - 1}
                      className="text-muted-foreground hover:text-primary disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5 -rotate-90" />
                    </button>
                  </div>
                </div>
              ))}
              <label className="grid h-24 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary">
                <Plus className="h-5 w-5" />
                <input
                  ref={galInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) addGallery(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </Field>
          <Field label="Alt text" note={PREVIEW_FIELD_NOTE}>
            <Input value={d.altText} onChange={(e) => set("altText", e.target.value)} />
          </Field>
          <Field
            label="Video URL"
            note="Preview only · Product video is not connected to the storefront."
          >
            <Input
              value={d.videoUrl}
              onChange={(e) => set("videoUrl", e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </Section>

        {/* Pricing */}
        <Section title="Pricing">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Regular price (৳)" error={err("price")}>
              <Input
                type="number"
                min={0}
                value={d.price}
                onChange={(e) => set("price", e.target.value)}
                aria-invalid={!!err("price")}
              />
            </Field>
            <Field label="Sale price (৳)" error={err("salePrice")}>
              <Input
                type="number"
                min={0}
                value={d.salePrice}
                onChange={(e) => set("salePrice", e.target.value)}
                placeholder="optional"
                aria-invalid={!!err("salePrice")}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost price (৳)" note={PREVIEW_FIELD_NOTE}>
              <Input
                type="number"
                min={0}
                value={d.costPrice}
                onChange={(e) => set("costPrice", e.target.value)}
              />
            </Field>
            <Field label="Tax note" note={PREVIEW_FIELD_NOTE}>
              <Input value={d.taxNote} onChange={(e) => set("taxNote", e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Custom size</p>
              <p className="text-xs text-muted-foreground">Made-to-measure option</p>
            </div>
            <Switch
              checked={d.customSize}
              onCheckedChange={(v) => set("customSize", v)}
              aria-label="Enable custom size"
            />
          </div>
          {d.customSize && (
            <Field label="Custom-size charge (৳)" error={err("customSizeCharge")}>
              <Input
                type="number"
                min={0}
                value={d.customSizeCharge}
                onChange={(e) => set("customSizeCharge", e.target.value)}
                aria-invalid={!!err("customSizeCharge")}
              />
            </Field>
          )}
        </Section>

        {/* Inventory */}
        <Section title="Inventory">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" note={PREVIEW_FIELD_NOTE} error={err("sku")}>
              <Input
                value={d.sku}
                onChange={(e) => set("sku", e.target.value)}
                aria-invalid={!!err("sku")}
              />
            </Field>
            <Field label="Stock" error={err("stock")}>
              <Input
                type="number"
                min={0}
                step={1}
                value={d.stock}
                onChange={(e) => set("stock", e.target.value)}
                aria-invalid={!!err("stock")}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Low-stock threshold"
              note={PREVIEW_FIELD_NOTE}
              error={err("lowStockThreshold")}
            >
              <Input
                type="number"
                min={0}
                value={d.lowStockThreshold}
                onChange={(e) => set("lowStockThreshold", e.target.value)}
                aria-invalid={!!err("lowStockThreshold")}
              />
            </Field>
            <Field label="Backorder" note={PREVIEW_FIELD_NOTE}>
              <div className="flex h-9 items-center">
                <Switch
                  checked={d.allowBackorder}
                  onCheckedChange={(v) => set("allowBackorder", v)}
                  aria-label="Allow backorder"
                />
              </div>
            </Field>
          </div>
        </Section>

        {/* Custom sizing / fulfilment */}
        <Section title="Custom sizing & fulfilment">
          <Field label="Processing time" note={PREVIEW_FIELD_NOTE}>
            <Input
              value={d.processingTime}
              onChange={(e) => set("processingTime", e.target.value)}
              placeholder="3–5 working days"
            />
          </Field>
          <Field label="Return note" note={PREVIEW_FIELD_NOTE}>
            <Textarea value={d.returnNote} onChange={(e) => set("returnNote", e.target.value)} />
          </Field>
        </Section>

        {/* Cosmetics */}
        <Section title="Cosmetics">
          <Field label="Country of origin" note={PREVIEW_FIELD_NOTE}>
            <Input
              value={d.countryOfOrigin}
              onChange={(e) => set("countryOfOrigin", e.target.value)}
            />
          </Field>
        </Section>

        {/* SEO */}
        <Section title="SEO">
          <Field label={`SEO title (${d.seoTitle.length} chars)`} note={PREVIEW_FIELD_NOTE}>
            <Input value={d.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
          </Field>
          <Field
            label={`SEO description (${d.seoDescription.length} chars)`}
            note={PREVIEW_FIELD_NOTE}
          >
            <Textarea
              value={d.seoDescription}
              onChange={(e) => set("seoDescription", e.target.value)}
            />
          </Field>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Social preview</p>
            <p className="line-clamp-1 font-medium text-primary">
              {d.seoTitle || d.name || "Product title"}
            </p>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {d.seoDescription || d.description || "Product description preview."}
            </p>
          </div>
        </Section>
      </div>

      <SheetFooter className="flex-col gap-2 border-t border-border pt-3 sm:flex-row">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          <Eye className="h-4 w-4" /> Preview
        </Button>
        <Button type="button" variant="outline" onClick={handleSaveDraft}>
          Save Draft
        </Button>
        <Button type="button" variant="outline" onClick={handleArchive}>
          Archive
        </Button>
        <Button type="button" onClick={handlePublish}>
          Publish
        </Button>
      </SheetFooter>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft preview · Admin UI only</DialogTitle>
            <DialogDescription>
              This uses unsaved draft values and is not the public product page.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-4">
            {featured && (
              <img
                src={featured.url}
                alt={d.altText || d.name || "Preview"}
                className="h-32 w-24 rounded object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-xl text-foreground">
                {d.name || "Untitled product"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {PRODUCT_TYPE_LABEL[d.type]} · {d.category || "—"}
              </p>
              <p className="mt-1 font-medium text-primary">
                {d.salePrice
                  ? formatBDT(Number(d.salePrice))
                  : d.price
                    ? formatBDT(Number(d.price))
                    : "—"}
                {d.salePrice && d.price && (
                  <span className="ml-1 text-xs text-muted-foreground line-through">
                    {formatBDT(Number(d.price))}
                  </span>
                )}
              </p>
              <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">
                {d.description || "No description."}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-lg text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  note,
  error,
}: {
  label: string;
  children: React.ReactNode;
  note?: string;
  error?: string | false;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {note && <p className="text-[0.7rem] text-muted-foreground">{note}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
