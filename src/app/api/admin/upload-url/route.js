import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { isAuthed } from '@/lib/adminAuth';
import { r2Config, isR2Configured } from '@/lib/posts';

export const runtime = 'nodejs';

// Media the admin can upload (broader than the request form — includes video).
const ACCEPTED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};
const MAX_BYTES = 200 * 1024 * 1024; // 200MB (videos)

export async function POST(request) {
  if (!isAuthed(request.cookies)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isR2Configured()) {
    return NextResponse.json({ ok: false, error: 'uploads_not_configured' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { filename, contentType, size } = body || {};
  if (!filename || !ACCEPTED[contentType]) {
    return NextResponse.json({ ok: false, error: 'unsupported_type' }, { status: 400 });
  }
  if (typeof size !== 'number' || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'invalid_size' }, { status: 400 });
  }

  const { accountId, accessKeyId, secretAccessKey, bucket, publicBase } = r2Config();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const key = `admin/uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safe}`;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 600 }
    );
    const publicUrl = `${publicBase.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
    return NextResponse.json({ ok: true, uploadUrl, publicUrl, key, kind: fileKind(contentType) });
  } catch (err) {
    console.error('[admin/upload-url] presign failed:', err);
    return NextResponse.json({ ok: false, error: 'presign_failed' }, { status: 500 });
  }
}

function fileKind(ct) {
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct === 'application/pdf') return 'pdf';
  return 'file';
}
