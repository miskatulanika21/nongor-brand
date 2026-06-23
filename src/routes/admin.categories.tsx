import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminHeader, ViewToggle } from "@/components/admin/AdminUI";
import {
  listAdminCategories,
  saveCategory,
  setCategoryActive,
  reorderCategories,
  deleteCategory as deleteCategoryFn,
} from "@/lib/catalog-admin.api";
import { categoryInputSchema } from "@/lib/catalog-admin.schema";
import type { AdminCategory } from "@/lib/server/catalog-admin.server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories · Nongorr Admin" }] }),
  loader: async () => {
    const c = await listAdminCategories();
    return { categories: c.success ? c.categories : [], loadError: !c.success };
  },
  component: Categories,
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function Categories() {
  const { categories, loadError } = Route.useLoaderData();
  const router = useRouter();

  // Local mirror for snappy reordering; reconciled with the loader after writes.
  const [items, setItems] = useState<AdminCategory[]>(categories);
  useEffect(() => setItems(categories), [categories]);

  const [view, setView] = useState<"card" | "list">("card");
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.invalidate();

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next); // optimistic
    setBusy(true);
    const res = await reorderCategories({
      data: { items: next.map((c, idx) => ({ slug: c.slug, sortOrder: idx })) },
    });
    setBusy(false);
    if (!res.success) toast.error(res.error);
    await refresh();
  };

  const toggleActive = async (slug: string, active: boolean) => {
    setBusy(true);
    const res = await setCategoryActive({ data: { slug, active } });
    setBusy(false);
    if (res.success) toast.success(active ? "Category shown." : "Category hidden.");
    else toast.error(res.error);
    await refresh();
  };

  const removeCat = async (slug: string) => {
    setBusy(true);
    const res = await deleteCategoryFn({ data: { slug } });
    setBusy(false);
    setDeleteTarget(null);
    if (res.success) toast.success("Category deleted.");
    else toast.error(res.error);
    await refresh();
  };

  const onSaved = async () => {
    setAdding(false);
    setEditing(null);
    await refresh();
  };

  return (
    <div>
      <AdminHeader
        title="Categories"
        description="Organise the catalog taxonomy. Changes are saved to the database."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add category
          </Button>
        }
      />

      {loadError && (
        <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Categories could not be loaded. Refresh to try again.
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} categories</p>
        <ViewToggle
          value={view}
          onValueChange={setView}
          label="Category view"
          options={[
            { value: "card", label: "Cards", icon: LayoutGrid },
            { value: "list", label: "List", icon: List },
          ]}
        />
      </div>

      {view === "card" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c, i) => (
            <div
              key={c.slug}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card p-4",
                !c.isActive && "opacity-60",
              )}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="grid h-14 w-12 place-items-center rounded bg-secondary font-display text-lg text-muted-foreground">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-lg text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">/{c.slug}</p>
                </div>
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                <Badge variant="outline">{c.productCount} products</Badge>
                <Badge variant="outline">{c.isActive ? "Visible" : "Hidden"}</Badge>
              </div>
              <CatControls
                index={i}
                total={items.length}
                record={c}
                busy={busy}
                onMove={move}
                onToggleActive={toggleActive}
                onEdit={() => setEditing(c)}
                onDelete={() => setDeleteTarget(c)}
              />
            </div>
          ))}
          {items.length === 0 && (
            <p className="col-span-full py-10 text-center text-muted-foreground">
              No categories yet. Add your first category.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {items.map((c, i) => (
            <div
              key={c.slug}
              className={cn("flex flex-wrap items-center gap-3 p-3", !c.isActive && "opacity-60")}
            >
              <div className="grid h-10 w-9 place-items-center rounded bg-secondary text-sm text-muted-foreground">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  /{c.slug} · {c.productCount} products · {c.isActive ? "Visible" : "Hidden"}
                </p>
              </div>
              <CatControls
                index={i}
                total={items.length}
                record={c}
                busy={busy}
                onMove={move}
                onToggleActive={toggleActive}
                onEdit={() => setEditing(c)}
                onDelete={() => setDeleteTarget(c)}
              />
            </div>
          ))}
        </div>
      )}

      <CategoryDialog
        open={adding || !!editing}
        editing={editing}
        nextSortOrder={items.length}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaved={onSaved}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this category?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deleteTarget?.name}</strong>. A category that still
              has products cannot be deleted — reassign or remove its products first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && removeCat(deleteTarget.slug)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CatControls({
  index,
  total,
  record,
  busy,
  onMove,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  index: number;
  total: number;
  record: AdminCategory;
  busy: boolean;
  onMove: (i: number, d: -1 | 1) => void;
  onToggleActive: (slug: string, active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${record.name} up`}
        disabled={index === 0 || busy}
        onClick={() => onMove(index, -1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${record.name} down`}
        disabled={index === total - 1 || busy}
        onClick={() => onMove(index, 1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={record.isActive ? `Hide ${record.name}` : `Show ${record.name}`}
        disabled={busy}
        onClick={() => onToggleActive(record.slug, !record.isActive)}
      >
        {record.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Edit ${record.name}`} onClick={onEdit}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${record.name}`}
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function CategoryDialog({
  open,
  editing,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: AdminCategory | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setSlug(editing?.slug ?? "");
    }
  }, [editing, open]);

  const save = async () => {
    const category = {
      slug: slug.trim(),
      name: name.trim(),
      sortOrder: editing?.sortOrder ?? nextSortOrder,
      isActive: editing?.isActive ?? true,
    };
    const parsed = categoryInputSchema.safeParse(category);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    const res = await saveCategory({
      data: { mode: editing ? "update" : "create", slug: editing?.slug, category: parsed.data },
    });
    setSaving(false);
    if (res.success) {
      toast.success(editing ? "Category saved." : "Category created.");
      onSaved();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "Add category"}</DialogTitle>
          <DialogDescription>Saved to the catalog database.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!editing && (slug === "" || slug === slugify(name))) setSlug(slugify(v));
              }}
              placeholder="e.g. Kurti"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-slug">Slug</Label>
            <Input
              id="cat-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. kurti"
            />
            <p className="text-[0.7rem] text-muted-foreground">
              Lowercase letters, numbers and single hyphens.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={saving || !name.trim() || !slug.trim()} onClick={save}>
            {editing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
