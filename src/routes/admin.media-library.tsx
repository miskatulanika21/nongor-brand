import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdminHeader,
  PreviewNotice,
  MockBadge,
  ViewToggle,
  createPreviewId,
} from "@/components/admin/AdminUI";
import { PRODUCTS } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
import { LayoutGrid, List, Search, Upload, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/media-library")({
  head: () => ({ meta: [{ title: "Media Library · Nongorr Admin" }] }),
  component: MediaLibraryAdmin,
});

interface MediaAsset {
  id: string;
  url: string;
  name: string;
  source: "catalog" | "local";
  usedBy: string[];
  fileSize?: string;
  fileType?: string;
  dimensions?: string;
}

function buildAssets(): MediaAsset[] {
  const urls = Array.from(new Set(PRODUCTS.flatMap((p) => [p.image, ...(p.gallery ?? [])])));
  return urls.map((url, i) => ({
    id: `catalog-${i}`,
    url,
    name: url.split("/").pop()?.split("?")[0] ?? `asset-${i}`,
    source: "catalog",
    usedBy: PRODUCTS.filter((p) => p.image === url || (p.gallery ?? []).includes(url)).map(
      (p) => p.name,
    ),
  }));
}

function MediaLibraryAdmin() {
  const [assets, setAssets] = useState<MediaAsset[]>(buildAssets);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  // Track local object URLs for cleanup.
  const localUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = localUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const visible = assets.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (typeFilter === "catalog" && a.source !== "catalog") return false;
    if (typeFilter === "local" && a.source !== "local") return false;
    return true;
  });
  const visibleIds = new Set(visible.map((a) => a.id));
  const selectedVisible = [...selected].filter((id) => visibleIds.has(id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    if (selectedVisible.length === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((a) => a.id)));
  };

  const addLocal = (file: File) => {
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
    setAssets((a) => [
      {
        id: createPreviewId(),
        url,
        name: file.name,
        source: "local",
        usedBy: [],
        fileSize: `${(file.size / 1024).toFixed(0)} KB`,
        fileType: file.type,
        dimensions: "Reading…",
      },
      ...a,
    ]);
    // Read dimensions client-side.
    const img = new Image();
    img.onload = () => {
      setAssets((a) =>
        a.map((x) =>
          x.url === url ? { ...x, dimensions: `${img.naturalWidth}×${img.naturalHeight}` } : x,
        ),
      );
    };
    img.src = url;
    toast("Added to this local media preview.");
  };

  const removeAsset = (asset: MediaAsset) => {
    if (asset.source === "local") {
      URL.revokeObjectURL(asset.url);
      localUrls.current.delete(asset.url);
    }
    setAssets((a) => a.filter((x) => x.id !== asset.id));
    toast("Removed from this local media preview. Products using this asset are unchanged.");
  };

  const bulkRemove = () => {
    const targets = assets.filter((a) => selectedVisible.includes(a.id));
    targets.forEach((t) => {
      if (t.source === "local") {
        URL.revokeObjectURL(t.url);
        localUrls.current.delete(t.url);
      }
    });
    setAssets((a) => a.filter((x) => !selectedVisible.includes(x.id)));
    setSelected(new Set());
    setConfirmBulk(false);
    toast("Removed from this local media preview. Products using these assets are unchanged.");
  };

  return (
    <div>
      <AdminHeader
        title="Media Library"
        description="Browse demo media — local preview only."
        action={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Upload (preview)
          </Button>
        }
      />
      <PreviewNotice className="mb-5" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search media…"
              className="w-52 pl-9"
              aria-label="Search media"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]" aria-label="Filter by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="catalog">Bundled assets</SelectItem>
              <SelectItem value="local">Local preview</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={visible.length > 0 && selectedVisible.length === visible.length}
              onCheckedChange={toggleAll}
              aria-label="Select all visible media"
            />
            Select all
          </label>
          <ViewToggle
            value={view}
            onValueChange={setView}
            label="Media view"
            options={[
              { value: "grid", label: "Grid", icon: LayoutGrid },
              { value: "list", label: "List", icon: List },
            ]}
          />
        </div>
      </div>

      {view === "grid" ? (
        <div className="admin-media-grid">
          {visible.map((a) => (
            <div
              key={a.id}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card",
                selected.has(a.id) ? "border-primary" : "border-border",
              )}
            >
              <Checkbox
                className="absolute left-2 top-2 z-10 bg-background"
                checked={selected.has(a.id)}
                onCheckedChange={() => toggle(a.id)}
                aria-label={`Select ${a.name}`}
              />
              <img src={a.url} alt={a.name} className="h-32 w-full object-cover" />
              <div className="p-2">
                <p className="truncate text-xs font-medium text-foreground" title={a.name}>
                  {a.name}
                </p>
                <p className="text-[0.65rem] text-muted-foreground">
                  {a.usedBy.length} use{a.usedBy.length === 1 ? "" : "s"}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <Badge variant="outline" className="text-[0.6rem]">
                    {a.source === "catalog" ? "Bundled" : "Local"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => removeAsset(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 p-3">
              <Checkbox
                checked={selected.has(a.id)}
                onCheckedChange={() => toggle(a.id)}
                aria-label={`Select ${a.name}`}
              />
              <img src={a.url} alt={a.name} className="h-12 w-12 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {a.source === "catalog"
                    ? "Dimensions: Not available in current frontend · File size: Not available in current frontend · Source: Bundled product asset"
                    : `${a.dimensions ?? "—"} · ${a.fileSize ?? "—"} · ${a.fileType ?? "—"} · Local preview file`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.usedBy.length > 0
                    ? `Used by: ${a.usedBy.join(", ")}`
                    : "Not referenced by any product"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAsset(a)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No media matches your filters.
        </p>
      )}

      {selectedVisible.length > 0 && (
        <div className="admin-bulk-bar mt-4 flex items-center justify-between rounded-xl border border-border bg-card p-3 shadow-soft">
          <span className="flex items-center gap-2 text-sm">
            <MockBadge /> {selectedVisible.length} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => setConfirmBulk(true)}
            >
              Remove from preview
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Upload drawer */}
      <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Upload media (preview)</SheetTitle>
            <SheetDescription>
              Local preview only · Files are not uploaded to any storage and reset on reload.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4">
            <Label
              htmlFor="media-upload"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground hover:border-primary"
            >
              <Upload className="h-6 w-6" />
              Choose an image (max 5 MB)
              <input
                id="media-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addLocal(f);
                  e.target.value = "";
                }}
              />
            </Label>
            <p className="mt-3 text-xs text-muted-foreground">
              Replace/delete affect only the route-local preview list.
            </p>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              <X className="h-4 w-4" /> Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove selected media?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {selectedVisible.length} item(s) from the local preview list only. This
              demo does not update products using these assets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={bulkRemove}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
