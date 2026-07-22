/**
 * upload-to-r2.mjs
 * ----------------
 * Uploads the UnitedMarketingDesk-Assets library to a Cloudflare R2 bucket,
 * preserving the exact `Folder/filename` structure so the keys match the URLs
 * baked into src/content/catalog.json (built with ASSET_BASE_URL=<r2 public url>).
 *
 * R2 is S3-compatible, so this uses the AWS S3 SDK pointed at the R2 endpoint.
 *
 * Required env (put in .env.local or export before running):
 *   R2_ACCOUNT_ID         Cloudflare account ID
 *   R2_ACCESS_KEY_ID      R2 API token access key id
 *   R2_SECRET_ACCESS_KEY  R2 API token secret
 *   R2_BUCKET             bucket name (e.g. united-marketing-assets)
 *
 * Usage:
 *   node scripts/upload-to-r2.mjs            # upload new/changed files (skips identical)
 *   node scripts/upload-to-r2.mjs --force    # re-upload everything
 *   node scripts/upload-to-r2.mjs --dry-run  # list what would upload, no writes
 */
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mime from 'mime-types';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'UnitedMarketingDesk-Assets');

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 6;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n[r2] Missing required env var: ${name}`);
    console.error('     Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.');
    process.exit(1);
  }
  return v;
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      // Key = posix relative path from the assets dir (matches catalog URLs).
      const key = path.relative(base, full).split(path.sep).join('/');
      out.push({ full, key });
    }
  }
  return out;
}

async function main() {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const bucket = requireEnv('R2_BUCKET');
  requireEnv('R2_ACCESS_KEY_ID');
  requireEnv('R2_SECRET_ACCESS_KEY');

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const files = await walk(ASSETS_DIR);
  const totalBytes = (await Promise.all(files.map((f) => fs.stat(f.full)))).reduce(
    (a, s) => a + s.size,
    0
  );
  console.log(
    `[r2] ${files.length} files (${(totalBytes / 1e9).toFixed(2)} GB) → bucket "${bucket}"${
      FORCE ? ' (force)' : ''
    }${DRY_RUN ? ' (dry-run)' : ''}`
  );

  let done = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  async function processOne(file) {
    const stat = await fs.stat(file.full);
    const contentType = mime.lookup(file.full) || 'application/octet-stream';

    if (!FORCE && !DRY_RUN) {
      // Skip if an object with the same size already exists.
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: file.key }));
        if (head.ContentLength === stat.size) {
          skipped++;
          done++;
          return;
        }
      } catch {
        // Not found → upload below.
      }
    }

    if (DRY_RUN) {
      console.log(`  would upload  ${file.key}  (${contentType})`);
      uploaded++;
      done++;
      return;
    }

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: file.key,
          Body: createReadStream(file.full),
          ContentType: contentType,
          ContentLength: stat.size,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );
      uploaded++;
    } catch (err) {
      failed++;
      console.error(`  FAILED  ${file.key}: ${err.message}`);
    }
    done++;
    if (done % 20 === 0 || done === files.length) {
      console.log(`  ${done}/${files.length}  (${uploaded} up, ${skipped} skip, ${failed} fail)`);
    }
  }

  // Simple concurrency pool.
  const queue = [...files];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const file = queue.shift();
      await processOne(file);
    }
  });
  await Promise.all(workers);

  console.log(
    `\n[r2] done — ${uploaded} uploaded, ${skipped} skipped, ${failed} failed of ${files.length}.`
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[r2] upload failed:', err);
  process.exit(1);
});
