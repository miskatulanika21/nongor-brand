import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader, ViewToggle } from "@/components/admin/AdminUI";
import { listMedia, requestMediaUpload, registerMedia, removeMedia } from "@/lib/media.api";
import { validateMediaFile, MEDIA_BUCKET, type MediaAsset } from "@/lib/media.schema";
import { convertImageToWebP } from "@/lib/image-convert";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { LayoutGrid, List, Search, Upload, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/media-library")({
  head: () => ({ meta: [{ title: "Media Library · Nongorr Admin" }] }),
  loader: () => listMedia(),
  component: MediaLibraryAdmin,
});

/** Read an image's natural dimensions client-side (best-effort). */
function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function MediaLibraryAdmin() {
  const res = Route.useLoaderData();
  const router = useRouter();
  const media: MediaAsset[] = res.success ? res.media : [];

  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null);

  const visible = media.filter((a) => !q || a.fileName.toLowerCase().includes(q.toLowerCase()));

  async function handleFile(original: File) {
    const precheck = validateMediaFile({
      name: original.name,
      type: original.type,
      size: original.size,
    });
    if (!precheck.ok) {
      toast.error(precheck.error);
      return;
    }
    setUploading(true);
    try {
      // JPEG/PNG are converted to WebP in the browser (best-effort — falls
      // back to the original) so the storefront always serves the small format.
      const file = await convertImageToWebP(original);
      if (file !== original) {
        const check = validateMediaFile({ name: file.name, type: file.type, size: file.size });
        if (!check.ok) {
          toast.error(check.error);
          return;
        }
      }
      const dims = await readDimensions(file);
      const ticketRes = await requestMediaUpload({
        data: { name: file.name, type: file.type, size: file.size },
      });
      if (!ticketRes.success) {
        toast.error(ticketRes.error);
        return;
      }
      const { path, token, publicUrl } = ticketRes.ticket;

      const sb = getSupabaseBrowserClient();
      const { error: upErr } = await sb.storage
        .from(MEDIA_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (upErr) {
        toast.error("The upload could not be completed. Please try again.");
        return;
      }

      const reg = await registerMedia({
        data: {
          path,
          publicUrl,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        },
      });
      if (!reg.success) {
        toast.error(reg.error);
        return;
      }
      toast.success("Image uploaded.");
      router.invalidate();
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    const result = await removeMedia({ data: { id: target.id } });
    if (result.success) {
      toast.success("Media deleted.");
      router.invalidate();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div>
      <AdminHeader
        title="Media Library"
        description="Upload and manage product images. JPEG/PNG uploads are converted to WebP automatically for faster loading."
        action={
          <Button asChild disabled={uploading}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        }
      />

      {!res.success && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-muted-foreground">
          {res.error}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

      {view === "grid" ? (
        <div className="admin-media-grid">
          {visible.map((a) => (
            <div
              key={a.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-card"
            >
              <img src={a.publicUrl} alt={a.fileName} className="h-32 w-full object-cover" />
              <div className="p-2">
                <p className="truncate text-xs font-medium text-foreground" title={a.fileName}>
                  {a.fileName}
                </p>
                <p className="text-[0.65rem] text-muted-foreground">
                  {a.usageCount} use{a.usageCount === 1 ? "" : "s"} · {formatSize(a.sizeBytes)}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <Badge variant="outline" className="text-[0.6rem]">
                    {a.width && a.height ? `${a.width}×${a.height}` : "Image"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Delete ${a.fileName}`}
                    onClick={() => setPendingDelete(a)}
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
              <img src={a.publicUrl} alt={a.fileName} className="h-12 w-12 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{a.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {a.width && a.height ? `${a.width}×${a.height} · ` : ""}
                  {formatSize(a.sizeBytes)} · {a.contentType}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.usageCount > 0
                    ? `Used by ${a.usageCount} product${a.usageCount === 1 ? "" : "s"}`
                    : "Not referenced by any product"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${a.fileName}`}
                onClick={() => setPendingDelete(a)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {media.length === 0
            ? "No media yet. Upload your first image to get started."
            : "No media matches your search."}
        </p>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.usageCount
                ? `This image is used by ${pendingDelete.usageCount} product(s). Deleting it removes the file from storage; those products will lose this image.`
                : "This permanently removes the file from storage. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
