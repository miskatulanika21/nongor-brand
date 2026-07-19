/**
 * Pick an image from the media library, or clear it.
 *
 * The banner editor grew this interaction inline (admin.banners.tsx); this is
 * the same flow as a standalone field so the Settings logo picker does not
 * fork a second copy. The library is fetched lazily on first open — an admin
 * who never opens the picker never pays for it.
 *
 * `value` is a public media URL or null. Clearing sets null rather than "",
 * because the settings patch treats null as "fall back to the shipped asset".
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { listMedia } from "@/lib/media.api";
import type { MediaAsset } from "@/lib/media.schema";
import { Images, ImagePlus, Check, X } from "lucide-react";

export function MediaPickerField({
  value,
  onChange,
  previewAlt = "Selected image",
  emptyHint,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  previewAlt?: string;
  /** Shown next to the buttons when nothing is selected. */
  emptyHint?: string;
}) {
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    setOpen((v) => !v);
    if (library || loading) return;
    setLoading(true);
    const res = await listMedia();
    setLibrary(res.success ? res.media : []);
    setLoading(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        {value ? (
          <img
            src={value}
            alt={previewAlt}
            className="h-20 w-20 rounded-lg border border-border bg-background object-contain p-1"
          />
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-border text-muted-foreground">
            <Images className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={toggle}>
              <ImagePlus className="h-4 w-4" />
              {value ? "Change image" : "Pick from library"}
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
          {!value && emptyHint && <p className="text-xs text-muted-foreground">{emptyHint}</p>}
        </div>
      </div>

      {open && (
        <div className="rounded-lg border border-border p-2">
          {loading ? (
            <p className="p-2 text-xs text-muted-foreground">Loading media…</p>
          ) : library && library.length > 0 ? (
            <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {library.map((m) => {
                const selected = m.publicUrl === value;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onChange(m.publicUrl);
                      setOpen(false);
                    }}
                    className={`relative aspect-square overflow-hidden rounded-md border ${
                      selected ? "border-gold ring-2 ring-gold/40" : "border-border"
                    }`}
                    title={m.fileName}
                  >
                    <img
                      src={m.publicUrl}
                      alt={m.fileName}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {selected && (
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-gold text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              No media yet — upload images in the Media library first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
