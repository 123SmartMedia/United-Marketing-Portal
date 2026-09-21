/**
 * set-r2-cors.mjs — one-time (idempotent) CORS policy for the R2 bucket so the
 * browser can PUT request-form attachments via presigned URLs. Run with the R2
 * creds in .env.local:  node --env-file=.env.local scripts/set-r2-cors.mjs
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_UPLOADS_BUCKET, R2_BUCKET } = process.env;

// CORS belongs on the bucket the BROWSER uploads to — the private uploads bucket.
// It was previously applied to R2_BUCKET, which serves the public asset catalog
// and is never written to from a browser.
const bucket = (R2_UPLOADS_BUCKET || '').trim();

for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })) {
  if (!v) {
    console.error(`Missing ${k}. Run with: node --env-file=.env.local scripts/set-r2-cors.mjs`);
    process.exit(1);
  }
}
if (!bucket) {
  console.error(
    'Missing R2_UPLOADS_BUCKET.

' +
      'This script deliberately refuses to fall back to R2_BUCKET: that bucket serves the
' +
      'public asset catalog, and it must not be given browser PUT access.
' +
      'Create a dedicated PRIVATE uploads bucket first, then set R2_UPLOADS_BUCKET.'
  );
  process.exit(1);
}
if (R2_BUCKET && bucket === R2_BUCKET) {
  console.error(
    `Refusing to run: R2_UPLOADS_BUCKET ("${bucket}") is the same bucket as R2_BUCKET.
` +
      'The public asset bucket must not accept browser uploads. Use a separate private bucket.'
  );
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const AllowedOrigins = [
  'https://marketing.unitedmortgage.com',
  'https://united-marketing-portal.vercel.app',
  'http://localhost:3000',
];

const config = {
  CORSRules: [
    {
      // PUT only. The browser writes its upload and never reads an object back;
      // the server reads bytes through the S3 API with its own credentials.
      AllowedMethods: ['PUT'],
      AllowedOrigins,
      AllowedHeaders: ['content-type'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: config }));
const check = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`[r2-cors] applied to bucket "${bucket}". Rules:`);
console.log(JSON.stringify(check.CORSRules, null, 2));
console.log('Origins:', AllowedOrigins.join(', '));
