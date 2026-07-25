-- Raise the product-media bucket ceiling from 5 MB to 15 MB.
--
-- The 5 MB cap was measured against the file as it LEAVES the phone, not as it
-- lands in Storage: the admin client converts JPEG/PNG to WebP and (as of this
-- change) downscales the long edge to 2400px before uploading, so a 12 MP
-- camera shot lands at a few hundred KB. The old cap therefore rejected photos
-- that would have stored small, and pushed the owner into shrinking images by
-- hand — which is why some live product photos are only ~950px wide.
--
-- This is the LAST of the three places the limit is enforced; the other two are
-- MAX_MEDIA_BYTES in src/lib/media.schema.ts (client precheck + zod validators).
-- Keep all three in step.
UPDATE storage.buckets
SET file_size_limit = 15728640 -- 15 * 1024 * 1024
WHERE id = 'product-media';
