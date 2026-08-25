/**
 * set-r2-cors.mjs — one-time (idempotent) CORS policy for the R2 bucket so the
 * browser can PUT request-form attachments via presigned URLs. Run with the R2
 * creds in .env.local:  node --env-file=.env.local scripts/set-r2-cors.mjs
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!v) {
    console.error(`Missing ${k}. Run with: node --env-file=.env.local scripts/set-r2-cors.mjs`);
    process.exit(1);
  }
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
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedOrigins,
      AllowedHeaders: ['content-type'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

await client.send(new PutBucketCorsCommand({ Bucket: R2_BUCKET, CORSConfiguration: config }));
const check = await client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
console.log('[r2-cors] applied. Rules:');
console.log(JSON.stringify(check.CORSRules, null, 2));
console.log('Origins:', AllowedOrigins.join(', '));
