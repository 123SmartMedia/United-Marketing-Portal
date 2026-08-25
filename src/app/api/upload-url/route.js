import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { ACCEPTED_UPLOAD_TYPES, MAX_TOTAL_BYTES } from '@/lib/requestSchema';

export const runtime = 'nodejs';

/**
 * Issues a short-lived presigned PUT URL so the browser can upload a request
 * attachment straight to R2 — bypassing the 4.5MB serverless body limit. The
 * public URL (served from the R2 bucket) is returned for the request email.
 *
 * Requires R2_* env vars (same creds as scripts/upload-to-r2.mjs) plus
 * NEXT_PUBLIC_ASSET_BASE_URL. If uploads aren't configured, returns a clear
 * error the client turns into a friendly "email them instead" message.
 */
export async function POST(request) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  const publicBase = process.env.NEXT_PUBLIC_ASSET_BASE_URL;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !publicBase) {
    return NextResponse.json({ ok: false, error: 'uploads_not_configured' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { filename, contentType, size } = body || {};
  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing_filename' }, { status: 400 });
  }
  if (!ACCEPTED_UPLOAD_TYPES.includes(contentType)) {
    return NextResponse.json({ ok: false, error: 'unsupported_type' }, { status: 400 });
  }
  if (typeof size !== 'number' || size <= 0 || size > MAX_TOTAL_BYTES) {
    return NextResponse.json({ ok: false, error: 'invalid_size' }, { status: 400 });
  }

  // Namespaced, collision-proof key under requests/. Sanitize the filename.
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const key = `requests/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safe}`;

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  try {
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 300 }
    );
    const publicUrl = `${publicBase.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
    return NextResponse.json({ ok: true, uploadUrl, publicUrl, key });
  } catch (err) {
    console.error('[upload-url] presign failed:', err);
    return NextResponse.json({ ok: false, error: 'presign_failed' }, { status: 500 });
  }
}
