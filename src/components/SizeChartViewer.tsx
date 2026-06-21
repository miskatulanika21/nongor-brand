import { useState } from "react";
import { ZoomIn, ZoomOut, X, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type SizeChartViewerProps = {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
  imageClassName?: string;
};

/**
 * SizeChartViewer — a premium measurement-chart image with a fullscreen
 * lightbox and zoom controls so customers can inspect every measurement line.
 */
export function SizeChartViewer({
  src,
  alt,
  loading = "lazy",
  decoding = "async",
  imageClassName,
}: SizeChartViewerProps) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setZoom(1);
          setOpen(true);
        }}
        className="group relative block w-full overflow-hidden rounded-2xl border border-border shadow-soft"
        aria-label="Open measurement chart"
      >
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className={`w-full object-contain transition-transform duration-500 group-hover:scale-[1.03] ${imageClassName ?? ""}`}
        />
        <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-soft backdrop-blur">
          <Maximize2 className="h-3.5 w-3.5" /> View full chart
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Measurement chart</DialogTitle>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-display text-lg text-foreground">Measurement Chart</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Zoom in"
                disabled={zoom >= 3}
                onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="max-h-[75vh] overflow-auto bg-secondary/40 p-4">
            {open && (
              <img
                src={src}
                alt={alt}
                decoding="async"
                className="mx-auto origin-top transition-transform duration-200"
                style={{ transform: `scale(${zoom})`, width: zoom > 1 ? "100%" : undefined }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
