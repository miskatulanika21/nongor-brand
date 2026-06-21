import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AdminHeader,
  PreviewNotice,
  AdminSectionCard,
  MockBadge,
  ViewToggle,
} from "@/components/admin/AdminUI";
import { PRODUCTS, CATEGORIES, type ProductType } from "@/lib/products";
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
  Star,
  LayoutGrid,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories · Nongorr Admin" }] }),
  component: Categories,
});

interface AdminCategoryRecord {
  name: string;
  slug: string;
  count: number;
  image?: string;
  visible: boolean;
  featured: boolean;
}

function imageForType(slug: string): string | undefined {
  return PRODUCTS.find((p) => p.type === slug)?.image;
}

function buildInitial(): AdminCategoryRecord[] {
  return CATEGORIES.map((c) => ({
    name: c.name,
    slug: c.slug,
    count: PRODUCTS.filter((p) => p.type === (c.slug as ProductType)).length,
    image: imageForType(c.slug),
    visible: true,
    featured: false,
  }));
}

interface CollectionRecord {
  key: string;
  title: string;
  count: number;
  visible: boolean;
  image?: string;
}

function buildCollections(): CollectionRecord[] {
  return [
    {
      key: "new",
      title: "New Arrivals",
      count: PRODUCTS.filter((p) => p.isNew).length,
      visible: true,
      image: PRODUCTS.find((p) => p.isNew)?.image,
    },
    {
      key: "best",
      title: "Best Sellers",
      count: PRODUCTS.filter((p) => p.isBestSeller).length,
      visible: true,
      image: PRODUCTS.find((p) => p.isBestSeller)?.image,
    },
    {
      key: "custom",
      title: "Custom Fit",
      count: PRODUCTS.filter((p) => p.customSize).length,
      visible: true,
      image: PRODUCTS.find((p) => p.customSize)?.image,
    },
    {
      key: "cosmetics",
      title: "Cosmetics",
      count: PRODUCTS.filter((p) => ["cosmetics", "makeup", "serum"].includes(p.type)).length,
      visible: true,
      image: PRODUCTS.find((p) => ["cosmetics", "makeup", "serum"].includes(p.type))?.image,
    },
  ];
}

function Categories() {
  const [records, setRecords] = useState<AdminCategoryRecord[]>(buildInitial);
  const [collections, setCollections] = useState<CollectionRecord[]>(buildCollections);
  const [view, setView] = useState<"card" | "list">("card");
  const [editing, setEditing] = useState<AdminCategoryRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategoryRecord | null>(null);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= records.length) return;
    setRecords((rs) => {
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    toast("Reordered in this local preview.");
  };

  const toggleVisible = (slug: string) =>
    setRecords((rs) => rs.map((r) => (r.slug === slug ? { ...r, visible: !r.visible } : r)));
  const toggleFeatured = (slug: string) =>
    setRecords((rs) => rs.map((r) => (r.slug === slug ? { ...r, featured: !r.featured } : r)));

  const removeCat = (slug: string) => {
    setRecords((rs) => rs.filter((r) => r.slug !== slug));
    setDeleteTarget(null);
    toast("Removed from this local preview. Reloading restores the original mock data.");
  };

  return (
    <div>
      <AdminHeader
        title="Categories & Collections"
        description="Organise the catalog display — local preview only."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add category
          </Button>
        }
      />
      <PreviewNotice className="mb-5" />

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {records.length} categories · counts derived from products
        </p>
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
          {records.map((c, i) => (
            <div
              key={c.slug}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card p-4",
                !c.visible && "opacity-60",
              )}
            >
              <div className="mb-3 flex items-center gap-3">
                {c.image ? (
                  <img
                    src={c.image}
                    alt={`${c.name} category`}
                    className="h-14 w-12 rounded object-cover"
                  />
                ) : (
                  <div className="grid h-14 w-12 place-items-center rounded bg-secondary text-xs text-muted-foreground">
                    No image
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-lg text-foreground">{c.name}</p>
                  <Badge variant="outline">{c.count} products</Badge>
                </div>
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                {c.featured && <Badge className="bg-gold/15 text-primary">Featured</Badge>}
                <Badge variant="outline">{c.visible ? "Visible" : "Hidden"}</Badge>
              </div>
              <CatControls
                index={i}
                total={records.length}
                record={c}
                onMove={move}
                onToggleVisible={toggleVisible}
                onToggleFeatured={toggleFeatured}
                onEdit={() => setEditing(c)}
                onDelete={() => setDeleteTarget(c)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {records.map((c, i) => (
            <div
              key={c.slug}
              className={cn("flex flex-wrap items-center gap-3 p-3", !c.visible && "opacity-60")}
            >
              {c.image ? (
                <img
                  src={c.image}
                  alt={`${c.name} category`}
                  className="h-10 w-9 rounded object-cover"
                />
              ) : (
                <div className="grid h-10 w-9 place-items-center rounded bg-secondary text-[0.6rem] text-muted-foreground">
                  N/A
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.count} products · {c.visible ? "Visible" : "Hidden"}
                  {c.featured ? " · Featured" : ""}
                </p>
              </div>
              <CatControls
                index={i}
                total={records.length}
                record={c}
                onMove={move}
                onToggleVisible={toggleVisible}
                onToggleFeatured={toggleFeatured}
                onEdit={() => setEditing(c)}
                onDelete={() => setDeleteTarget(c)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Collections */}
      <div className="mt-8">
        <AdminSectionCard
          title="Collections"
          description="Membership is derived from the current mock product flags. Editing a card only changes its local display."
          action={<MockBadge label="Derived" />}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {collections.map((col) => (
              <div
                key={col.key}
                className={cn(
                  "rounded-xl border border-border bg-background p-4",
                  !col.visible && "opacity-60",
                )}
              >
                {col.image ? (
                  <img
                    src={col.image}
                    alt={`${col.title} collection`}
                    className="mb-3 h-24 w-full rounded object-cover"
                  />
                ) : (
                  <div className="mb-3 grid h-24 w-full place-items-center rounded bg-secondary text-xs text-muted-foreground">
                    No preview
                  </div>
                )}
                <p className="font-medium text-foreground">{col.title}</p>
                <p className="text-xs text-muted-foreground">{col.count} matching products</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() =>
                    setCollections((cs) =>
                      cs.map((x) => (x.key === col.key ? { ...x, visible: !x.visible } : x)),
                    )
                  }
                >
                  {col.visible ? (
                    <>
                      <EyeOff className="h-4 w-4" /> Hide (preview)
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" /> Show (preview)
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </AdminSectionCard>
      </div>

      {/* Add / Edit dialog */}
      <CategoryDialog
        open={adding || !!editing}
        editing={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={(rec) => {
          if (editing) {
            setRecords((rs) => rs.map((r) => (r.slug === editing.slug ? { ...r, ...rec } : r)));
            toast("Updated in this local preview. Reloading restores the original mock data.");
          } else {
            setRecords((rs) => [...rs, { ...rec, count: 0, visible: true, featured: false }]);
            toast("Added to this local preview. Reloading restores the original mock data.");
          }
          setAdding(false);
          setEditing(null);
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from preview?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{deleteTarget?.name}</strong> from this local preview only.
              Product taxonomy is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && removeCat(deleteTarget.slug)}
            >
              Remove
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
  onMove,
  onToggleVisible,
  onToggleFeatured,
  onEdit,
  onDelete,
}: {
  index: number;
  total: number;
  record: AdminCategoryRecord;
  onMove: (i: number, d: -1 | 1) => void;
  onToggleVisible: (slug: string) => void;
  onToggleFeatured: (slug: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${record.name} up`}
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${record.name} down`}
        disabled={index === total - 1}
        onClick={() => onMove(index, 1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={record.visible ? `Hide ${record.name}` : `Show ${record.name}`}
        onClick={() => onToggleVisible(record.slug)}
      >
        {record.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={record.featured ? `Unfeature ${record.name}` : `Feature ${record.name}`}
        onClick={() => onToggleFeatured(record.slug)}
      >
        <Star className={cn("h-4 w-4", record.featured && "fill-gold text-gold")} />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Edit ${record.name}`} onClick={onEdit}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Delete ${record.name}`} onClick={onDelete}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function CategoryDialog({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: AdminCategoryRecord | null;
  onClose: () => void;
  onSave: (rec: { name: string; slug: string; image?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  // Reset fields whenever the target changes or the dialog opens.
  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setSlug(editing?.slug ?? "");
    }
  }, [editing, open]);

  const valid = name.trim().length > 0 && slug.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "Add category"}</DialogTitle>
          <DialogDescription>
            Local preview only · Changes reset when this page reloads.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kurti"
            />
            {name.trim().length === 0 && (
              <p className="text-xs text-destructive">Name is required.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-slug">Slug</Label>
            <Input
              id="cat-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. kurti"
            />
            {slug.trim().length === 0 && (
              <p className="text-xs text-destructive">Slug is required.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onSave({ name: name.trim(), slug: slug.trim(), image: imageForType(slug.trim()) })
            }
          >
            {editing ? "Save (preview)" : "Add (preview)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
