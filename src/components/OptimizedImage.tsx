import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_CDN_ENABLED,
  IMAGE_SIZES,
  buildImageSrcSet,
  isOptimizable,
  vercelImageUrl,
} from "@/lib/image-cdn";

type OptimizedImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  /**
   * Device widths to offer in srcset — every value must exist in IMAGE_SIZES
   * (vercel.json images.sizes). Pick 2–3 that bracket the rendered size.
   */
  widths?: readonly number[];
  /** Must exist in IMAGE_QUALITIES. 75 default; 80 for hero/PDP fidelity. */
  quality?: number;
};

/**
 * `next/image`-style optimized <img> for this TanStack Start app: on Vercel
 * deployments it serves `/_vercel/image` URLs (on-demand resize + AVIF/WebP
 * negotiation + edge caching); everywhere else — dev, CI, unsupported srcs —
 * it renders a plain <img> with the original URL. Purely additive: layout,
 * class names and loading semantics are the caller's, exactly like <img>.
 */
export function OptimizedImage({
  src,
  widths,
  quality = DEFAULT_IMAGE_QUALITY,
  sizes,
  decoding,
  ...rest
}: OptimizedImageProps) {
  if (!IMAGE_CDN_ENABLED || !isOptimizable(src)) {
    return <img src={src} sizes={sizes} decoding={decoding} {...rest} />;
  }
  const ws = widths && widths.length > 0 ? widths : IMAGE_SIZES;
  return (
    <img
      src={vercelImageUrl(src, ws[ws.length - 1], quality)}
      srcSet={buildImageSrcSet(src, ws, quality)}
      sizes={sizes ?? "100vw"}
      decoding={decoding ?? "async"}
      {...rest}
    />
  );
}
