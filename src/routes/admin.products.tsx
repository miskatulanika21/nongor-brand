import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AdminHeader, ViewToggle } from "@/components/admin/AdminUI";
import {
  listAdminProducts,
  listAdminCategories,
  getAdminProduct,
  saveProduct,
  setProductStatus,
  deleteProduct as deleteProductFn,
} from "@/lib/catalog-admin.api";
import {
  PRODUCT_STATUSES,
  productInputSchema,
  type ProductStatus,
  type ProductInput,
} from "@/lib/catalog-admin.schema";
import type {
  AdminProductListItem,
  AdminCategory,
  AdminProductDetail,
} from "@/lib/server/catalog-admin.server";
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
  MoreHorizontal,
  LayoutGrid,
  List,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const LOW_STOCK = 10;

export const Route = createFileRoute("/admin/products")({
  head: () => ({ meta: [{ title: "Products · Nongorr Admin" }] }),
  loader: async () => {
    const [p, c] = await Promise.all([listAdminProducts(), listAdminCategories()]);
    return {
      products: p.success ? p.products : [],
      categories: c.success ? c.categories : [],
      loadError: !p.success || !c.success,
    };
  },
  component: ProductsAdmin,
});

const STATUS_TONE: Record<ProductStatus, string> = {
  active: "border-success/40 text-success",
  draft: "border-border text-muted-foreground",
  hidden: "border-gold/40 text-primary",
  archived: "border-destructive/40 text-destructive",
};

function ProductsAdmin() {
  const { products, categories, loadError } = Route.useLoaderData();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [customFilter, setCustomFilter] = useState("all");
  const [view, setView] = useState<"table" | "card">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProductDetail | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminProductListItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.invalidate();

  const visible = useMemo(() => {
    return products.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (categoryFilter !== "all" && r.categorySlug !== categoryFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (customFilter === "custom" && !r.customSize) return false;
      if (customFilter === "standard" && r.customSize) return false;
      if (stockFilter === "in" && !(r.stock > LOW_STOCK)) return false;
      if (stockFilter === "low" && !(r.stock > 0 && r.stock <= LOW_STOCK)) return false;
      if (stockFilter === "out" && r.stock !== 0) return false;
      return true;
    });
  }, [products, q, categoryFilter, statusFilter, stockFilter, customFilter]);

  const visibleCodes = useMemo(() => new Set(visible.map((r) => r.code)), [visible]);
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((c) => visibleCodes.has(c)));
      return next.size === s.size ? s : next;
    });
  }, [visibleCodes]);

  const selectedVisible = [...selected].filter((c) => visibleCodes.has(c));

  const toggle = (code: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const toggleAll = () => {
    if (selectedVisible.length === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((r) => r.code)));
  };

  const changeStatus = async (code: string, status: ProductStatus) => {
    setBusy(true);
    const res = await setProductStatus({ data: { code, status } });
    setBusy(false);
    if (res.success) {
      toast.success(`Product ${status === "active" ? "published" : status}.`);
      await refresh();
    } else {
      toast.error(res.error);
    }
  };

  const bulkStatus = async (status: ProductStatus) => {
    setBusy(true);
    const results = await Promise.all(
      selectedVisible.map((code) => setProductStatus({ data: { code, status } })),
    );
    setBusy(false);
    const failed = results.filter((r) => !r.success).length;
    if (failed) toast.error(`${failed} update(s) failed.`);
    else toast.success(`${results.length} product(s) updated.`);
    setSelected(new Set());
    await refresh();
  };

  const removeOne = async (code: string) => {
    setBusy(true);
    const res = await deleteProductFn({ data: { code } });
    setBusy(false);
    setDeleteTarget(null);
    if (res.success) {
      toast.success("Product deleted.");
      await refresh();
    } else {
      toast.error(res.error);
    }
  };

  const bulkDelete = async () => {
    setBusy(true);
    const results = await Promise.all(
      selectedVisible.map((code) => deleteProductFn({ data: { code } })),
    );
    setBusy(false);
    setBulkDeleteOpen(false);
    const failed = results.filter((r) => !r.success).length;
    if (failed) toast.error(`${failed} delete(s) failed.`);
    else toast.success(`${results.length} product(s) deleted.`);
    setSelected(new Set());
    await refresh();
  };

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = async (code: string) => {
    setEditingLoading(true);
    setSheetOpen(true);
    const res = await getAdminProduct({ data: { code } });
    setEditingLoading(false);
    if (res.success && res.product) {
      setEditing(res.product);
    } else {
      toast.error(res.error ?? "Could not load product.");
      setSheetOpen(false);
    }
  };

  const onSaved = async () => {
    setSheetOpen(false);
    setEditing(null);
    await refresh();
  };

  return (
    <div className="pb-20">
      <AdminHeader
        title="Products"
        description={`${products.length} product${products.length === 1 ? "" : "s"} in the catalog`}
        action={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add product
          </Button>
        }
      />

      {loadError && (
        <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Some catalog data could not be loaded. Refresh to try again.
        </div>
      )}

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
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>
                {c.name}
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
            {PRODUCT_STATUSES.map((s) => (
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
                  Category
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
                        <img
                          src={r.image}
                          alt={r.name}
                          className="h-12 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="grid h-12 w-10 place-items-center rounded bg-muted text-[0.6rem] text-muted-foreground">
                          No image
                        </div>
                      )}
                      <span className="line-clamp-1 font-medium text-foreground">{r.name}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{r.categoryName || "—"}</Badge>
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
                    <Badge variant="outline" className={cn(stockTone(r.stock))}>
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
                      name={r.name}
                      status={r.status}
                      busy={busy}
                      onEdit={() => openEdit(r.code)}
                      onStatus={(s) => changeStatus(r.code, s)}
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

      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
          view === "table" ? "md:hidden" : "",
        )}
      >
        {visible.map((r) => (
          <div key={r.code} className="flex flex-col rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                className="mt-1"
                checked={selected.has(r.code)}
                onCheckedChange={() => toggle(r.code)}
                aria-label={`Select ${r.name}`}
              />
              {r.image ? (
                <img src={r.image} alt={r.name} className="h-16 w-14 rounded object-cover" />
              ) : (
                <div className="grid h-16 w-14 place-items-center rounded bg-muted text-[0.6rem] text-muted-foreground">
                  No image
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-foreground">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.categoryName}</p>
                <p className="text-sm font-medium text-primary">
                  {formatBDT(r.salePrice ?? r.price)}
                </p>
              </div>
              <RowMenu
                name={r.name}
                status={r.status}
                busy={busy}
                onEdit={() => openEdit(r.code)}
                onStatus={(s) => changeStatus(r.code, s)}
                onDelete={() => setDeleteTarget(r)}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn(stockTone(r.stock))}>
                {r.stock} in stock
              </Badge>
              <Badge variant="outline" className={cn("capitalize", STATUS_TONE[r.status])}>
                {r.status}
              </Badge>
            </div>
          </div>
        ))}
        {visible.length === 0 && view === "card" && (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            No products match your filters.
          </p>
        )}
      </div>

      {selectedVisible.length > 0 && (
        <div className="admin-bulk-bar mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">{selectedVisible.length} selected</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => bulkStatus("active")}
            >
              Publish
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => bulkStatus("hidden")}
            >
              Hide
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => bulkStatus("archived")}
            >
              Archive
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => setBulkDeleteOpen(true)}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          {editingLoading ? (
            <div className="grid flex-1 place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ProductForm
              key={editing?.code ?? "new"}
              editing={editing}
              categories={categories}
              onCancel={() => setSheetOpen(false)}
              onSaved={onSaved}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deleteTarget?.name}</strong> and its media, sizes
              and reviews. This cannot be undone. To hide it instead, use Archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && removeOne(deleteTarget.code)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected products?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {selectedVisible.length} product(s) and their related media,
              sizes and reviews. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={bulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function stockTone(stock: number): string {
  if (stock === 0) return "border-destructive/40 text-destructive";
  if (stock <= LOW_STOCK) return "border-gold/40 text-primary";
  return "border-success/40 text-success";
}

function RowMenu({
  name,
  status,
  busy,
  onEdit,
  onStatus,
  onDelete,
}: {
  name: string;
  status: ProductStatus;
  busy: boolean;
  onEdit: () => void;
  onStatus: (s: ProductStatus) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`} disabled={busy}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" /> Edit
        </DropdownMenuItem>
        {status !== "active" && (
          <DropdownMenuItem onClick={() => onStatus("active")}>Publish</DropdownMenuItem>
        )}
        {status !== "hidden" && (
          <DropdownMenuItem onClick={() => onStatus("hidden")}>Hide</DropdownMenuItem>
        )}
        {status !== "archived" && (
          <DropdownMenuItem onClick={() => onStatus("archived")}>Archive</DropdownMenuItem>
        )}
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------------------- Product form ---------------------------- */

interface DraftValues {
  name: string;
  slug: string;
  categorySlug: string;
  status: ProductStatus;
  description: string;
  price: string;
  salePrice: string;
  stock: string;
  customSize: boolean;
  customSizeCharge: string;
  isNew: boolean;
  isHandmade: boolean;
  isBestSeller: boolean;
}

function detailToDraft(d: AdminProductDetail): DraftValues {
  return {
    name: d.name,
    slug: d.slug,
    categorySlug: d.categorySlug,
    status: d.status,
    description: d.description ?? "",
    price: String(d.price),
    salePrice: d.salePrice != null ? String(d.salePrice) : "",
    stock: String(d.stock),
    customSize: d.customSize ?? false,
    customSizeCharge: d.customSizeCharge != null ? String(d.customSizeCharge) : "0",
    isNew: d.isNew ?? false,
    isHandmade: d.isHandmade ?? false,
    isBestSeller: d.isBestSeller ?? false,
  };
}

function emptyDraft(defaultCategory: string): DraftValues {
  return {
    name: "",
    slug: "",
    categorySlug: defaultCategory,
    status: "draft",
    description: "",
    price: "",
    salePrice: "",
    stock: "0",
    customSize: false,
    customSizeCharge: "0",
    isNew: false,
    isHandmade: false,
    isBestSeller: false,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ProductForm({
  editing,
  categories,
  onCancel,
  onSaved,
}: {
  editing: AdminProductDetail | null;
  categories: AdminCategory[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<DraftValues>(() =>
    editing ? detailToDraft(editing) : emptyDraft(categories[0]?.slug ?? ""),
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof DraftValues>(k: K, v: DraftValues[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  // Build a typed ProductInput from the draft, carrying through any fields the
  // form does not expose (preserved from `editing`) so an update never wipes them.
  const buildInput = (status: ProductStatus): ProductInput => {
    const base: Partial<ProductInput> = editing ? { ...editing } : {};
    return {
      ...base,
      name: d.name.trim(),
      slug: d.slug.trim(),
      categorySlug: d.categorySlug,
      status,
      description: d.description,
      price: Math.trunc(Number(d.price)),
      salePrice: d.salePrice.trim() === "" ? null : Math.trunc(Number(d.salePrice)),
      stock: Math.trunc(Number(d.stock)),
      customSize: d.customSize,
      customSizeCharge: d.customSize ? Math.trunc(Number(d.customSizeCharge || "0")) : null,
      isNew: d.isNew,
      isHandmade: d.isHandmade,
      isBestSeller: d.isBestSeller,
    };
  };

  const submit = async (status: ProductStatus) => {
    setTouched(true);
    const input = buildInput(status);
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    const res = await saveProduct({
      data: {
        mode: editing ? "update" : "create",
        code: editing?.code,
        product: parsed.data,
      },
    });
    setSaving(false);
    if (res.success) {
      toast.success(editing ? "Product saved." : "Product created.");
      onSaved();
    } else {
      toast.error(res.error);
    }
  };

  const priceNum = Number(d.price);
  const saleNum = d.salePrice.trim() === "" ? null : Number(d.salePrice);
  const errName = touched && !d.name.trim() ? "Title is required." : undefined;
  const errSlug = touched && !d.slug.trim() ? "Slug is required." : undefined;
  const errCategory = touched && !d.categorySlug ? "Category is required." : undefined;
  const errPrice =
    touched && (!Number.isFinite(priceNum) || priceNum < 0)
      ? "Enter a non-negative price."
      : undefined;
  const errSale =
    touched && saleNum != null && (saleNum < 0 || saleNum > priceNum)
      ? "Sale price must be at most the regular price."
      : undefined;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-2xl">
          {editing ? "Edit product" : "Add a product"}
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto py-2">
        <Section title="Basic information">
          <Field label="Title" error={errName}>
            <Input
              value={d.name}
              onChange={(e) => {
                const v = e.target.value;
                setD((p) => ({
                  ...p,
                  name: v,
                  slug:
                    !editing && (p.slug === "" || p.slug === slugify(p.name)) ? slugify(v) : p.slug,
                }));
              }}
              aria-invalid={!!errName}
            />
          </Field>
          <Field label="Slug" error={errSlug}>
            <Input
              value={d.slug}
              onChange={(e) => set("slug", e.target.value)}
              aria-invalid={!!errSlug}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" error={errCategory}>
              <Select value={d.categorySlug} onValueChange={(v) => set("categorySlug", v)}>
                <SelectTrigger aria-invalid={!!errCategory}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                      {!c.isActive ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={d.status} onValueChange={(v) => set("status", v as ProductStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-4">
            <ToggleField label="New" checked={d.isNew} onChange={(v) => set("isNew", v)} />
            <ToggleField
              label="Handmade"
              checked={d.isHandmade}
              onChange={(v) => set("isHandmade", v)}
            />
            <ToggleField
              label="Best seller"
              checked={d.isBestSeller}
              onChange={(v) => set("isBestSeller", v)}
            />
          </div>
        </Section>

        <Section title="Pricing">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Regular price (৳)" error={errPrice}>
              <Input
                type="number"
                min={0}
                value={d.price}
                onChange={(e) => set("price", e.target.value)}
                aria-invalid={!!errPrice}
              />
            </Field>
            <Field label="Sale price (৳)" error={errSale}>
              <Input
                type="number"
                min={0}
                value={d.salePrice}
                onChange={(e) => set("salePrice", e.target.value)}
                placeholder="optional"
                aria-invalid={!!errSale}
              />
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
            <Field label="Custom-size charge (৳)">
              <Input
                type="number"
                min={0}
                value={d.customSizeCharge}
                onChange={(e) => set("customSizeCharge", e.target.value)}
              />
            </Field>
          )}
        </Section>

        <Section title="Inventory">
          <Field label="Stock">
            <Input
              type="number"
              min={0}
              step={1}
              value={d.stock}
              onChange={(e) => set("stock", e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Per-size stock and movements are managed in Inventory.
          </p>
        </Section>
      </div>

      <SheetFooter className="flex-col gap-2 border-t border-border pt-3 sm:flex-row">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={() => submit("draft")} disabled={saving}>
          Save draft
        </Button>
        <Button type="button" onClick={() => submit("active")} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Publish
        </Button>
      </SheetFooter>
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
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | false;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      {label}
    </label>
  );
}
