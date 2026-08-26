import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader, ViewToggle } from "@/components/admin/AdminUI";
import {
  discardMediaUpload,
  getMediaOriginal,
  listMedia,
  registerMedia,
  removeMedia,
  requestMediaUpload,
} from "@/lib/media.api";
import {
  MEDIA_BUCKET,
  MEDIA_FILE_ACCEPT,
  MEDIA_SOURCE_BUCKET,
  MEDIA_SOURCE_FORMAT_LABEL,
  MAX_SOURCE_LABEL,
  validateMediaSourceFile,
  type MediaAsset,
} from "@/lib/media.schema";
import { ImagePreparationError, prepareImageForUpload } from "@/lib/image-convert";
import { suggestFocalFromFile } from "@/lib/image-saliency";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Download, LayoutGrid, List, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/media-library")({
  head: () => ({ meta: [{ title: "Media Library · Nongorr Admin" }] }),
  loader: () => listMedia(),
  component: MediaLibraryAdmin,
});

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Keep 4K canvas preparation responsive while still overlapping network work. */
const UPLOAD_CONCURRENCY = 2;

type UploadFailure = { name: string; error: string };
type UploadProgress = { done: number; total: number };

function MediaLibraryAdmin() {
  const res = Route.useLoaderData();
  const router = useRouter();
  const media: MediaAsset[] = res.success ? res.media : [];

  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [failures, setFailures] = useState<UploadFailure[]>([]);
  const confirm = useConfirm();

  const uploading = progress !== null;
  const visible = media.filter((asset) =>
    q ? asset.fileName.toLowerCase().includes(q.toLowerCase()) : true,
  );

  /** Upload one source + delivery pair; return a user-facing error on failure. */
  async function uploadOne(original: File): Promise<string | null> {
    const precheck = validateMediaSourceFile(original);
    if (!precheck.ok) return precheck.error;

    let prepared;
    try {
      prepared = await prepareImageForUpload(original);
    } catch (error) {
      return error instanceof ImagePreparationError
        ? error.message
        : "This image could not be prepared. Please try another file.";
    }

    // Native face detection is preferred where available; deterministic visual
    // saliency is the private fallback. Analysis never blocks an upload.
    const focal = await suggestFocalFromFile(prepared.delivery);
    const ticketResult = await requestMediaUpload({
      data: {
        source: {
          name: prepared.source.name,
          type: prepared.sourceType,
          size: prepared.source.size,
        },
        delivery: {
          name: prepared.delivery.name,
          type: prepared.delivery.type,
          size: prepared.delivery.size,
        },
      },
    });
    if (!ticketResult.success) return ticketResult.error;

    const { path, token, sourcePath, sourceToken } = ticketResult.ticket;
    const discard = async () => {
      await discardMediaUpload({ data: { path, sourcePath } }).catch(() => undefined);
    };

    const supabase = getSupabaseBrowserClient();
    const { error: sourceError } = await supabase.storage
      .from(MEDIA_SOURCE_BUCKET)
      .uploadToSignedUrl(sourcePath, sourceToken, prepared.source, {
        contentType: prepared.sourceType,
      });
    if (sourceError) {
      await discard();
      return "The private original could not be uploaded. Please try again.";
    }

    const { error: deliveryError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .uploadToSignedUrl(path, token, prepared.delivery, {
        contentType: prepared.delivery.type,
      });
    if (deliveryError) {
      await discard();
      return "The optimized image could not be uploaded. Please try again.";
    }

    const registered = await registerMedia({
      data: {
        path,
        sourcePath,
        fileName: prepared.delivery.name,
        contentType: prepared.delivery.type,
        sizeBytes: prepared.delivery.size,
        sourceFileName: prepared.source.name,
        sourceContentType: prepared.sourceType,
        sourceSizeBytes: prepared.source.size,
        width: prepared.width,
        height: prepared.height,
        processingMode: prepared.processingMode,
        suggestedFocalX: focal?.x ?? null,
        suggestedFocalY: focal?.y ?? null,
      },
    });
    if (!registered.success) {
      await discard();
      return registered.error;
    }
    return null;
  }

  /** Drain an unlimited selection through a bounded worker pool. */
  async function handleFiles(files: File[]) {
    if (files.length === 0 || uploading) return;
    setFailures([]);
    setProgress({ done: 0, total: files.length });

    const queue = [...files];
    const failed: UploadFailure[] = [];
    let done = 0;

    const worker = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        let error: string | null;
        try {
          error = await uploadOne(next);
        } catch {
          error = "The upload could not be completed. Please try again.";
        }
        if (error) failed.push({ name: next.name, error });
        done += 1;
        setProgress({ done, total: files.length });
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
    } finally {
      setProgress(null);
    }

    const succeeded = files.length - failed.length;
    setFailures(failed);
    if (succeeded > 0) {
      toast.success(succeeded === 1 ? "Image uploaded." : `${succeeded} images uploaded.`);
      router.invalidate();
    }
    if (failed.length > 0) {
      toast.error(
        failed.length === 1
          ? `${failed[0].name} failed: ${failed[0].error}`
          : `${failed.length} of ${files.length} images could not be uploaded.`,
      );
    }
  }

  function askDelete(target: MediaAsset) {
    return confirm({
      tone: "danger",
      title: "Delete this image?",
      description: target.usageCount
        ? `This image has ${target.usageCount} active reference(s). Remove it from products or banners before deleting it.`
        : "This permanently removes both the web image and its private original. This cannot be undone.",
      confirmText: "Delete",
      icon: <Trash2 className="h-6 w-6" />,
      onConfirm: async () => {
        const result = await removeMedia({ data: { id: target.id } });
        if (result.success) {
          toast.success("Media deleted.");
          router.invalidate();
        } else {
          toast.error(result.error);
        }
      },
    });
  }

  async function downloadOriginal(asset: MediaAsset) {
    const result = await getMediaOriginal({ data: { id: asset.id } });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const link = document.createElement("a");
    link.href = result.download.url;
    link.download = result.download.fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <div>
      <AdminHeader
        title="Media Library"
        description={`Premium, non-destructive product images. Upload ${MEDIA_SOURCE_FORMAT_LABEL} files up to ${MAX_SOURCE_LABEL}; originals stay private while exact web variants are delivered automatically.`}
        action={
          <Button asChild disabled={uploading}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4" />{" "}
              {progress ? `Uploading ${progress.done} / ${progress.total}…` : "Upload images"}
              <input
                type="file"
                accept={MEDIA_FILE_ACCEPT}
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void handleFiles(files);
                }}
              />
            </label>
          </Button>
        }
      />

      {failures.length > 0 && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-foreground">
            {failures.length} image{failures.length === 1 ? "" : "s"} could not be uploaded
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {failures.map((failure) => (
              <li key={failure.name}>
                <span className="font-medium">{failure.name}</span> — {failure.error}
              </li>
            ))}
          </ul>
        </div>
      )}

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
            onChange={(event) => setQ(event.target.value)}
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
          {visible.map((asset) => (
            <div
              key={asset.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-card"
            >
              <img
                src={asset.publicUrl}
                alt={asset.fileName}
                className="h-32 w-full object-cover"
              />
              {asset.processingMode === "normalized" && (
                <Badge
                  variant="secondary"
                  className="absolute right-2 top-2 z-10 gap-1 whitespace-nowrap text-[0.6rem] shadow-sm"
                >
                  <Sparkles className="h-2.5 w-2.5" /> Optimized
                </Badge>
              )}
              <div className="p-2">
                <p className="truncate text-xs font-medium text-foreground" title={asset.fileName}>
                  {asset.fileName}
                </p>
                <p className="text-[0.65rem] text-muted-foreground">
                  {asset.usageCount} use{asset.usageCount === 1 ? "" : "s"} ·{" "}
                  {formatSize(asset.sizeBytes)}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[0.6rem]">
                      {asset.width && asset.height ? `${asset.width}×${asset.height}` : "Image"}
                    </Badge>
                  </div>
                  <div className="flex items-center">
                    {asset.sourceStoragePath && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Download original ${asset.sourceFileName ?? asset.fileName}`}
                        title="Download private original"
                        onClick={() => void downloadOriginal(asset)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Delete ${asset.fileName}`}
                      onClick={() => askDelete(asset)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((asset) => (
            <div key={asset.id} className="flex flex-wrap items-center gap-3 p-3">
              <img
                src={asset.publicUrl}
                alt={asset.fileName}
                className="h-12 w-12 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{asset.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
                  {formatSize(asset.sizeBytes)} · {asset.contentType}
                </p>
                <p className="text-xs text-muted-foreground">
                  {asset.usageCount > 0
                    ? `${asset.usageCount} active reference${asset.usageCount === 1 ? "" : "s"}`
                    : "Not referenced by a product or banner"}
                  {asset.sourceSizeBytes ? ` · Original ${formatSize(asset.sourceSizeBytes)}` : ""}
                </p>
              </div>
              {asset.sourceStoragePath && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Download original ${asset.sourceFileName ?? asset.fileName}`}
                  title="Download private original"
                  onClick={() => void downloadOriginal(asset)}
                >
                  <Download className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${asset.fileName}`}
                onClick={() => askDelete(asset)}
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
    </div>
  );
}
