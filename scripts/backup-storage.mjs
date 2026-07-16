#!/usr/bin/env node
/**
 * Storage bucket backup (Stage 7 / P6).
 *
 * Downloads the contents of one or more Supabase Storage buckets to a local
 * directory and writes a manifest. Used by `.github/workflows/backup.yml`; also
 * runnable by hand for an ad-hoc snapshot or the restore drill.
 *
 * WHY this exists: `payment-evidence` (customer bKash/Nagad screenshots) is
 * NOT re-derivable — if the bucket is lost, the evidence is gone. `product-media`
 * IS re-derivable from `public/assets`, so it is excluded by default (pass
 * --include-media to snapshot it too).
 *
 * READ-ONLY against Storage: it only lists and downloads. It never deletes or
 * mutates a bucket.
 *
 * Env (required):
 *   SUPABASE_URL                 e.g. https://<ref>.supabase.co  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY    service role — needed to read the PRIVATE bucket
 *
 * Usage:
 *   node scripts/backup-storage.mjs --out <dir> [--buckets a,b] [--include-media]
 *
 * Output layout:
 *   <dir>/<bucket>/<object path…>          the downloaded objects
 *   <dir>/manifest.json                    { generatedAt, buckets:[{bucket, objectCount,
 *                                            totalBytes, objects:[{path,size,etag,
 *                                            lastModified,contentType}]}], totals }
 *
 * Exit 0 on success; non-zero (with a printed reason) on any download/list error
 * so CI fails loudly rather than shipping a partial backup.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = { out: null, buckets: null, includeMedia: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--buckets") args.buckets = argv[++i];
    else if (a === "--include-media") args.includeMedia = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.out) {
  console.log(
    "usage: node scripts/backup-storage.mjs --out <dir> [--buckets a,b] [--include-media]",
  );
  process.exit(args.help ? 0 : 1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "backup-storage: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
  process.exit(1);
}

// Default set: the non-re-derivable bucket only. product-media is re-derivable
// from public/assets, so it is opt-in.
const DEFAULT_BUCKETS = ["payment-evidence"];
const buckets = args.buckets
  ? args.buckets
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean)
  : args.includeMedia
    ? [...DEFAULT_BUCKETS, "product-media"]
    : DEFAULT_BUCKETS;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE = 100;

/**
 * Recursively list every object under a bucket. Supabase `list` is folder-aware:
 * an entry with a null `id` is a prefix (folder) to recurse into; an entry with
 * an `id` is a real object. Paginates each prefix in pages of PAGE.
 */
async function listAll(bucket, prefix = "") {
  /** @type {{path:string,size:number,etag:string|null,lastModified:string|null,contentType:string|null}[]} */
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) {
        // A folder placeholder — recurse.
        out.push(...(await listAll(bucket, path)));
      } else {
        out.push({
          path,
          size: entry.metadata?.size ?? 0,
          etag: entry.metadata?.eTag ?? null,
          lastModified: entry.metadata?.lastModified ?? entry.updated_at ?? null,
          contentType: entry.metadata?.mimetype ?? null,
        });
      }
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function download(bucket, path, destRoot) {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) throw new Error(`download ${bucket}/${path}: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const dest = join(destRoot, bucket, path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  const started = Date.now();
  await mkdir(args.out, { recursive: true });

  const manifestBuckets = [];
  let grandObjects = 0;
  let grandBytes = 0;

  for (const bucket of buckets) {
    process.stdout.write(`backup-storage: listing ${bucket}… `);
    const objects = await listAll(bucket);
    console.log(`${objects.length} object(s)`);

    let bytes = 0;
    for (const obj of objects) {
      const n = await download(bucket, obj.path, args.out);
      bytes += n;
    }
    grandObjects += objects.length;
    grandBytes += bytes;
    manifestBuckets.push({
      bucket,
      objectCount: objects.length,
      totalBytes: bytes,
      objects,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: SUPABASE_URL,
    buckets: manifestBuckets,
    totals: { objectCount: grandObjects, totalBytes: grandBytes },
  };
  await writeFile(join(args.out, "manifest.json"), JSON.stringify(manifest, null, 2));

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `backup-storage: OK — ${grandObjects} object(s), ${(grandBytes / 1024).toFixed(1)} KiB across ${buckets.length} bucket(s) in ${secs}s → ${args.out}`,
  );
}

main().catch((err) => {
  console.error(`backup-storage: FAILED — ${err.message}`);
  process.exit(1);
});
