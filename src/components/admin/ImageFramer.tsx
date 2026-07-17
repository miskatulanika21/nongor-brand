import { useCallback, useId, useRef, useState } from "react";
import { Crosshair, Eye, EyeOff, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { focalStyle, MAX_ZOOM, type ImageFocal } from "@/lib/image-focal";
import { suggestFocal } from "@/lib/image-saliency";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface FramerPreviewCopy {
  eyebrow?: string | null;
  title?: string | null;
  subtitle?: string | null;
  cardTitle?: string | null;
  cardSubtitle?: string | null;
}

interface ImageFramerProps {
  /** Public URL of the image being framed. */
  src: string;
  /** Current focal point, normalized 0..1 (x then y). */
  focalX: number;
  focalY: number;
  /** Current zoom, 1..{@link MAX_ZOOM}. */
  zoom: number;
  /** Called with the new focal point + zoom on any change. */
  onChange: (focal: ImageFocal) => void;
  /** Optional copy so the hero preview shows the real text + caption card. */
  preview?: FramerPreviewCopy;
  /** CSS aspect ratio of the preview surface (default the 4:5 hero card). */
  previewAspect?: string;
  /** Show the hero chrome (maroon gradient, caption card, text safe-zone). Off for
   *  plain surfaces like product images. Default on. */
  heroChrome?: boolean;
  className?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clampZoom = (n: number) => Math.min(MAX_ZOOM, Math.max(1, n));

/**
 * Focal Studio — set the point of an image that must always stay in frame, tune
 * zoom, and see the result rendered live (WYSIWYG). Non-destructive: it emits a
 * focal point + zoom (0..1, 1..3), never a crop.
 *
 * Left  — the whole source photo (object-contain) with a draggable reticle.
 * Right — the real cropped card (object-cover + object-position + scale), with
 *         optional hero chrome (gradient, caption, text safe-zone).
 *
 * Reusable on any object-cover surface — pass previewAspect + heroChrome=false
 * for product/category images.
 */
export function ImageFramer({
  src,
  focalX,
  focalY,
  zoom,
  onChange,
  preview,
  previewAspect = "4 / 5",
  heroChrome = true,
  className,
}: ImageFramerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [autoFraming, setAutoFraming] = useState(false);
  const hintId = useId();

  const emit = useCallback(
    (next: Partial<ImageFocal>) =>
      onChange({
        x: clamp01(next.x ?? focalX),
        y: clamp01(next.y ?? focalY),
        zoom: clampZoom(next.zoom ?? zoom),
      }),
    [onChange, focalX, focalY, zoom],
  );

  const pointToFocal = useCallback(
    (clientX: number, clientY: number) => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      emit({ x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height });
    },
    [emit],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        emit({ x: focalX - step });
        break;
      case "ArrowRight":
        e.preventDefault();
        emit({ x: focalX + step });
        break;
      case "ArrowUp":
        e.preventDefault();
        emit({ y: focalY - step });
        break;
      case "ArrowDown":
        e.preventDefault();
        emit({ y: focalY + step });
        break;
      case "Home":
        e.preventDefault();
        onChange({ x: 0.5, y: 0.5, zoom: 1 });
        break;
      default:
        break;
    }
  };

  const autoFrame = async () => {
    setAutoFraming(true);
    const spot = await suggestFocal(src);
    setAutoFraming(false);
    if (spot) {
      emit({ x: spot.x, y: spot.y });
      toast.success("Framed on the detected subject — adjust if needed.");
    } else {
      toast.error("Couldn't auto-detect a subject. Set the focal point by hand.");
    }
  };

  const css = focalStyle({ x: focalX, y: focalY, zoom });

  return (
    <div className={cn("grid gap-4 sm:grid-cols-[1.15fr_1fr]", className)}>
      {/* ── Editor: the whole photo + draggable focal reticle ─────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Drag to set the focal point
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={autoFrame}
              disabled={autoFraming}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-muted disabled:opacity-60"
            >
              {autoFraming ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Auto-frame
            </button>
            <button
              type="button"
              onClick={() => onChange({ x: 0.5, y: 0.5, zoom: 1 })}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>
        </div>

        {/* Centring wrapper — the stage shrink-wraps the image (`w-fit`) so its box
            is EXACTLY the rendered photo; that makes clicks map 1:1 to image
            coordinates (a `w-full` stage would letterbox and offset the focal
            point toward the centre). */}
        <div className="grid place-items-center">
          <div
            ref={stageRef}
            role="slider"
            tabIndex={0}
            aria-label="Image focal point"
            aria-describedby={hintId}
            aria-valuetext={`Focal point ${Math.round(focalX * 100)}% from left, ${Math.round(
              focalY * 100,
            )}% from top`}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
              pointToFocal(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (dragging) pointToFocal(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              setDragging(false);
            }}
            onPointerCancel={() => setDragging(false)}
            className={cn(
              "relative max-h-[22rem] w-fit max-w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-border outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-gold",
              dragging && "ring-2 ring-gold",
            )}
          >
            {/* The whole image is visible; the stage wraps it exactly. */}
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none block max-h-[22rem] max-w-full select-none object-contain"
            />

            {/* Rule-of-thirds guides */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {[33.33, 66.66].map((p) => (
                <span
                  key={`v${p}`}
                  className="absolute top-0 bottom-0 w-px bg-white/25"
                  style={{ left: `${p}%` }}
                />
              ))}
              {[33.33, 66.66].map((p) => (
                <span
                  key={`h${p}`}
                  className="absolute left-0 right-0 h-px bg-white/25"
                  style={{ top: `${p}%` }}
                />
              ))}
            </div>

            {/* Focal reticle */}
            <span
              aria-hidden
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
            >
              <span className="block h-8 w-8 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.45)]" />
              <Crosshair className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
            </span>
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[0.7rem] font-medium text-muted-foreground">Zoom</span>
          <Slider
            value={[zoom]}
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            onValueChange={([z]) => emit({ zoom: z })}
            aria-label="Zoom"
            className="flex-1"
          />
          <span className="w-9 text-right text-[0.7rem] tabular-nums text-muted-foreground">
            {zoom.toFixed(1)}×
          </span>
        </div>

        <p id={hintId} className="text-[0.7rem] text-muted-foreground">
          Click or drag on the photo, or focus it and use arrow keys (Shift for larger steps). This
          point stays in frame on every screen.
        </p>
      </div>

      {/* ── Live WYSIWYG preview ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Live preview</span>
          {heroChrome && (
            <button
              type="button"
              onClick={() => setShowSafeZone((v) => !v)}
              aria-pressed={showSafeZone}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {showSafeZone ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              Text safe-zone
            </button>
          )}
        </div>

        <div className="flex items-end gap-3">
          <PreviewCard
            src={src}
            css={css}
            aspect={previewAspect}
            preview={heroChrome ? preview : undefined}
            heroChrome={heroChrome}
            showSafeZone={showSafeZone}
            className="w-full max-w-[15rem]"
          />
          {/* Small echo — same crop at a smaller size */}
          <PreviewCard
            src={src}
            css={css}
            aspect={previewAspect}
            preview={heroChrome ? preview : undefined}
            heroChrome={heroChrome}
            showSafeZone={showSafeZone}
            compact
            className="w-24 shrink-0"
          />
        </div>
        {heroChrome && (
          <p className="text-[0.7rem] text-muted-foreground">
            The shaded band is where the gradient and caption card sit — keep your subject out of
            it.
          </p>
        )}
      </div>
    </div>
  );
}

/** One faithful preview card: image (object-cover + focal + zoom) + optional chrome. */
function PreviewCard({
  src,
  css,
  aspect,
  preview,
  heroChrome,
  showSafeZone,
  compact,
  className,
}: {
  src: string;
  css: React.CSSProperties;
  aspect: string;
  preview?: FramerPreviewCopy;
  heroChrome: boolean;
  showSafeZone: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-sm",
        className,
      )}
      style={{ aspectRatio: aspect }}
    >
      <img src={src} alt="" className="h-full w-full object-cover" style={css} />

      {heroChrome && (
        <>
          {/* Matches the hero's maroon gradient wash */}
          <div className="absolute inset-0 bg-gradient-to-t from-primary/40 via-transparent to-transparent" />

          {/* Text safe-zone: where the gradient + caption card obscure the photo */}
          {showSafeZone && (
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[46%] bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.16)_0,rgba(255,255,255,0.16)_6px,transparent_6px,transparent_12px)]"
            />
          )}

          {/* Caption card, mirroring HeroSection */}
          {(preview?.cardTitle || preview?.cardSubtitle) && (
            <div
              className={cn(
                "absolute inset-x-2 bottom-2 rounded-xl bg-card/85 backdrop-blur",
                compact ? "p-1.5" : "p-2.5",
              )}
            >
              {preview?.cardTitle && (
                <p
                  className={cn(
                    "truncate font-display text-foreground",
                    compact ? "text-[0.6rem]" : "text-sm",
                  )}
                >
                  {preview.cardTitle}
                </p>
              )}
              {!compact && preview?.cardSubtitle && (
                <p className="truncate text-[0.7rem] text-muted-foreground">
                  {preview.cardSubtitle}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
