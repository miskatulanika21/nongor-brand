-- Stage 3 Pass 4e — private payment-evidence Storage bucket.
--
-- Customers submit payment proof (TrxID + screenshot) for manual (bKash/Nagad)
-- orders. The screenshot is PRIVATE: never public-read. There are deliberately
-- NO storage RLS policies, so anon/authenticated cannot read or write the bucket
-- at all — only the service role (which bypasses RLS) can. The app uploads the
-- bytes server-side (after authorizing owner/guest scope) and the admin views a
-- screenshot via a short-lived service-role signed URL. (Mirrors the media-
-- library bucket, but PRIVATE.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-evidence', 'payment-evidence', false, 5242880,
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
