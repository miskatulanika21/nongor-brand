import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { OptimizedImage } from "@/components/OptimizedImage";
import { HIGH_IMAGE_QUALITY } from "@/lib/image-cdn";
import { cn } from "@/lib/utils";
import {
  ZOOM_MIN as MIN_SCALE,
  ZOOM_MAX as MAX_SCALE,
  clampNumber as clamp,
  clampPanBox,
  nextZoomStop,
  pinchScale,
  zoomAroundPoint,
} from "@/lib/zoom-math";

// Movement (px) beyond which a pointer sequence is a drag, not a tap.
const TAP_SLOP = 8;

type View = { scale: number; tx: number; ty: number };
type Pointer = { x: number; y: number; startX: number; startY: number };

export interface ProductImageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Base alt/label, e.g. the product name. */
  name: string;
  /** Element focus returns to when the viewer closes (the opening thumbnail). */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Fullscreen product image viewer with real, smooth zoom & pan. (AUD-01)
 *
 * Zoom: mouse wheel, +/- controls, tap/click cycles fit → 2× → 3× → fit at the
 * pointer, and two-finger pinch. Pan: drag while zoomed, clamped to the actual
 * rendered image so you can never drag into empty space. Reset returns to fit.
 * Zoom level is announced; every control is a ≥44px target; and focus returns
 * to the opening thumbnail on close.
 */
export function ProductImageViewer({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
  name,
  triggerRef,
}: ProductImageViewerProps) {
  const multiImage = images.length > 1;

  const [view, setViewState] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef<View>(view);
  const setView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  // Transitions are on for discrete zoom (buttons/tap) and off during live
  // drag/pinch/wheel so the image tracks the finger 1:1.
  const [animating, setAnimating] = useState(true);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, Pointer>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  // Midpoint of the two pinch fingers on the previous frame, so a two-finger
  // drag pans the image even when the pinch distance stays constant (#10).
  const pinchMid = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const multiTouched = useRef(false);

  const reset = useCallback(() => {
    setAnimating(true);
    setView({ scale: 1, tx: 0, ty: 0 });
  }, [setView]);

  // Reset transform whenever the image or open-state changes.
  useEffect(() => {
    reset();
  }, [index, open, reset]);

  const step = useCallback(
    (dir: number) => {
      if (!multiImage) return;
      onIndexChange((index + dir + images.length) % images.length);
    },
    [multiImage, onIndexChange, index, images.length],
  );

  // Clamp pan to the *rendered* image box (clientWidth/Height are layout sizes,
  // unaffected by the CSS transform), so the image can't be dragged into the
  // surrounding letterbox.
  const clampPan = useCallback((x: number, y: number, s: number) => {
    const vp = viewportRef.current;
    const img = vp?.querySelector("img");
    if (!vp || !img) return { x: 0, y: 0 };
    return clampPanBox(x, y, s, img.clientWidth, img.clientHeight, vp.clientWidth, vp.clientHeight);
  }, []);

  // Zoom to `targetScale` keeping the given viewport point stationary.
  const zoomAround = useCallback(
    (clientX: number, clientY: number, targetScale: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const fx = clientX - rect.left - rect.width / 2;
      const fy = clientY - rect.top - rect.height / 2;
      const next = zoomAroundPoint(viewRef.current, targetScale, fx, fy);
      if (next === viewRef.current) return; // scale unchanged
      const clamped = clampPan(next.tx, next.ty, next.scale);
      setView({ scale: next.scale, tx: clamped.x, ty: clamped.y });
    },
    [clampPan, setView],
  );

  const zoomByCentered = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      setAnimating(true);
      zoomAround(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        viewRef.current.scale * factor,
      );
    },
    [zoomAround],
  );

  // A clean tap advances through the discrete zoom stops at the tapped point.
  const cycleZoomAt = useCallback(
    (clientX: number, clientY: number) => {
      const next = nextZoomStop(viewRef.current.scale);
      setAnimating(true);
      if (next === 1) reset();
      else zoomAround(clientX, clientY, next);
    },
    [zoomAround, reset],
  );

  // Wheel-zoom needs preventDefault to stop the page scrolling, but React
  // attaches wheel listeners as passive (preventDefault would throw). Bind a
  // native non-passive listener while the viewer is open.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !open) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setAnimating(false);
      zoomAround(e.clientX, e.clientY, viewRef.current.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    vp.addEventListener("wheel", handler, { passive: false });
    return () => vp.removeEventListener("wheel", handler);
  }, [open, zoomAround]);

  const pdist = (a: Pointer, b: Pointer) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
    });
    moved.current = false;
    if (pointers.current.size === 2) {
      multiTouched.current = true;
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: pdist(a, b), scale: viewRef.current.scale };
      pinchMid.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const curr: Pointer = { ...prev, x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, curr);

    // Two-finger pinch: scale around the midpoint AND translate with it, so a
    // constant-distance two-finger drag still pans (#10).
    if (pointers.current.size === 2 && pinchStart.current) {
      moved.current = true;
      setAnimating(false);
      const vp = viewportRef.current;
      const img = vp?.querySelector("img");
      const [a, b] = [...pointers.current.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const target = pinchScale(pinchStart.current.scale, pinchStart.current.dist, pdist(a, b));
      if (vp && img) {
        const rect = vp.getBoundingClientRect();
        const fx = mx - rect.left - rect.width / 2;
        const fy = my - rect.top - rect.height / 2;
        const scaled = zoomAroundPoint(viewRef.current, target, fx, fy);
        const prevMid = pinchMid.current ?? { x: mx, y: my };
        const clamped = clampPanBox(
          scaled.tx + (mx - prevMid.x),
          scaled.ty + (my - prevMid.y),
          scaled.scale,
          img.clientWidth,
          img.clientHeight,
          vp.clientWidth,
          vp.clientHeight,
        );
        pinchMid.current = { x: mx, y: my };
        setView({ scale: scaled.scale, tx: clamped.x, ty: clamped.y });
      }
      return;
    }

    // Track movement at every zoom level so a swipe is never mistaken for a tap.
    if (Math.hypot(curr.x - curr.startX, curr.y - curr.startY) > TAP_SLOP) moved.current = true;

    // Single-pointer drag pans only when zoomed in.
    if (viewRef.current.scale > 1) {
      setAnimating(false);
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const { scale, tx, ty } = viewRef.current;
      const p = clampPan(tx + dx, ty + dy, scale);
      setView({ scale, tx: p.x, ty: p.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      pinchStart.current = null;
      pinchMid.current = null;
    }

    if (pointers.current.size === 0) {
      const wasPinch = multiTouched.current;
      multiTouched.current = false;
      // A clean single tap (no drag, no pinch) cycles the zoom.
      if (!moved.current && !wasPinch) cycleZoomAt(e.clientX, e.clientY);
    }
  };

  // Keyboard pan step (px) when zoomed in.
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const { scale, tx, ty } = viewRef.current;
      if (scale <= 1) return;
      setAnimating(true);
      const p = clampPan(tx + dx, ty + dy, scale);
      setView({ scale, tx: p.x, ty: p.y });
    },
    [clampPan, setView],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const vp = viewportRef.current;
    const zoomedIn = viewRef.current.scale > 1;
    const STEP = 60;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomByCentered(1.25);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomByCentered(1 / 1.25);
    } else if (e.key === "0") {
      e.preventDefault();
      reset();
    } else if (e.key === "Enter" || e.key === " ") {
      // Activate the focusable viewport like a click-to-zoom.
      e.preventDefault();
      if (vp) {
        const r = vp.getBoundingClientRect();
        cycleZoomAt(r.left + r.width / 2, r.top + r.height / 2);
      }
    } else if (e.key === "ArrowLeft") {
      if (zoomedIn) {
        e.preventDefault();
        panBy(STEP, 0);
      } else if (multiImage) {
        step(-1);
      }
    } else if (e.key === "ArrowRight") {
      if (zoomedIn) {
        e.preventDefault();
        panBy(-STEP, 0);
      } else if (multiImage) {
        step(1);
      }
    } else if (e.key === "ArrowUp" && zoomedIn) {
      e.preventDefault();
      panBy(0, STEP);
    } else if (e.key === "ArrowDown" && zoomedIn) {
      e.preventDefault();
      panBy(0, -STEP);
    }
  };

  const pct = Math.round(view.scale * 100);
  const zoomed = view.scale > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="max-w-5xl gap-0 overflow-hidden border-none bg-background/98 p-0"
        onOpenAutoFocus={(e) => {
          // Focus the interactive viewport, not the first toolbar control.
          e.preventDefault();
          viewportRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          // Deterministically return focus to the opening thumbnail.
          e.preventDefault();
          triggerRef?.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{name} image viewer</DialogTitle>

        <div
          ref={viewportRef}
          role="group"
          aria-roledescription="Zoomable image"
          aria-label={`${name} — image ${index + 1} of ${images.length}. Press Enter or plus and minus to zoom, 0 to reset, and arrow keys to pan when zoomed${multiImage ? " or change image" : ""}.`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={cn(
            "relative flex h-[82vh] touch-none select-none items-center justify-center overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
          )}
        >
          <OptimizedImage
            src={images[index]}
            alt={`${name} — view ${index + 1}`}
            widths={[1080, 1920]}
            sizes="100vw"
            quality={HIGH_IMAGE_QUALITY}
            draggable={false}
            className={cn(
              "max-h-full w-auto max-w-full object-contain will-change-transform",
              animating && "transition-transform duration-200 ease-out",
            )}
            style={{
              transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`,
            }}
          />

          {multiImage && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-foreground shadow-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-foreground shadow-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-card/90 px-3 py-1 text-xs text-muted-foreground">
                {index + 1} / {images.length}
              </div>
            </>
          )}
        </div>

        {/* Zoom toolbar + close, each a ≥44px target */}
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-card/90 p-1 shadow-soft backdrop-blur">
          <button
            type="button"
            onClick={() => zoomByCentered(1 / 1.25)}
            disabled={view.scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="grid h-11 w-11 place-items-center rounded-full text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Minus className="h-5 w-5" />
          </button>
          <span
            aria-live="polite"
            aria-label={`Zoom ${pct} percent`}
            className="min-w-[3.25rem] text-center text-sm tabular-nums text-foreground"
          >
            {pct}%
          </span>
          <button
            type="button"
            onClick={() => zoomByCentered(1.25)}
            disabled={view.scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="grid h-11 w-11 place-items-center rounded-full text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!zoomed}
            aria-label="Reset zoom"
            className="grid h-11 w-11 place-items-center rounded-full text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close image viewer"
            className="grid h-11 w-11 place-items-center rounded-full text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
