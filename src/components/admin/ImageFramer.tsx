import { useCallback, useId, useRef, useState } from "react";
import { Crosshair, Eye, EyeOff, RotateCcw } from "lucide-react";
import { focalPosition } from "@/lib/banners-shared";
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
  /** Called with the new normalized focal point as the pin moves. */
  onChange: (focal: { x: number; y: number }) => void;
  /** Optional copy so the live preview shows the real hero text + caption card. */
  preview?: FramerPreviewCopy;
  className?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Focal Studio — set the point of an image that must always stay in frame, and
 * see the storefront hero rendered live around it (WYSIWYG), with an optional
 * "text safe-zone" overlay showing where the gradient + caption card will cover
 * the photo. Non-destructive: it emits a focal point (0..1), never a crop.
 *
 * Left  — the whole source photo (object-contain) with a draggable reticle.
 * Right — the real 4:5 hero card cropped with object-cover + object-position,
 *         plus a scaled-down mobile echo.
 *
 * Reusable beyond banners: any object-cover surface can adopt the same pin.
 */
export function ImageFramer({
  src,
  focalX,
  focalY,
  onChange,
  preview,
  className,
}: ImageFramerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const hintId = useId();

  const pointToFocal = useCallback(
    (clientX: number, clientY: number) => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      onChange({
        x: clamp01((clientX - r.left) / r.width),
        y: clamp01((clientY - r.top) / r.height),
      });
    },
    [onChange],
  );

  const nudge = (dx: number, dy: number) =>
    onChange({ x: clamp01(focalX + dx), y: clamp01(focalY + dy) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        nudge(-step, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        nudge(step, 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        nudge(0, -step);
        break;
      case "ArrowDown":
        e.preventDefault();
        nudge(0, step);
        break;
      case "Home":
        e.preventDefault();
        onChange({ x: 0.5, y: 0.5 });
        break;
      default:
        break;
    }
  };

  const objectPosition = focalPosition(focalX, focalY);

  return (
    <div className={cn("grid gap-4 sm:grid-cols-[1.15fr_1fr]", className)}>
      {/* ── Editor: the whole photo + draggable focal reticle ─────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Drag to set the focal point
          </span>
          <button
            type="button"
            onClick={() => onChange({ x: 0.5, y: 0.5 })}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" /> Centre
          </button>
        </div>

        {/* Centring wrapper — the stage below shrink-wraps the image (`w-fit`) so
            its box is EXACTLY the rendered photo. That is what makes clicks map
            1:1 to image coordinates; a `w-full` stage would letterbox the photo
            and offset every focal point toward the centre. */}
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
        <p id={hintId} className="text-[0.7rem] text-muted-foreground">
          Click or drag on the photo, or focus it and use arrow keys (Shift for larger steps). This
          point stays in frame on every screen.
        </p>
      </div>

      {/* ── Live WYSIWYG preview ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Live preview</span>
          <button
            type="button"
            onClick={() => setShowSafeZone((v) => !v)}
            aria-pressed={showSafeZone}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          >
            {showSafeZone ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Text safe-zone
          </button>
        </div>

        <div className="flex items-end gap-3">
          {/* Desktop hero card (the real 4:5 shape) */}
          <HeroPreviewCard
            src={src}
            objectPosition={objectPosition}
            preview={preview}
            showSafeZone={showSafeZone}
            className="w-full max-w-[15rem]"
          />
          {/* Mobile echo — same crop, small, to check the caption at phone size */}
          <HeroPreviewCard
            src={src}
            objectPosition={objectPosition}
            preview={preview}
            showSafeZone={showSafeZone}
            compact
            className="w-24 shrink-0"
          />
        </div>
        <p className="text-[0.7rem] text-muted-foreground">
          The shaded band is where the gradient and caption card sit — keep your subject out of it.
        </p>
      </div>
    </div>
  );
}

/** One faithful hero-card preview: 4:5 image (object-cover + focal) + overlay. */
function HeroPreviewCard({
  src,
  objectPosition,
  preview,
  showSafeZone,
  compact,
  className,
}: {
  src: string;
  objectPosition: string;
  preview?: FramerPreviewCopy;
  showSafeZone: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/5] overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-sm",
        className,
      )}
    >
      <img src={src} alt="" className="h-full w-full object-cover" style={{ objectPosition }} />
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
            <p className="truncate text-[0.7rem] text-muted-foreground">{preview.cardSubtitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
