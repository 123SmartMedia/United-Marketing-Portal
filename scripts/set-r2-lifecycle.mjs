#!/usr/bin/env node
/**
 * set-r2-lifecycle.mjs — expire staged request attachments automatically.
 *
 *   node --env-file=.env.local scripts/set-r2-lifecycle.mjs
 *   node --env-file=.env.local scripts/set-r2-lifecycle.mjs --show
 *
 * Objects under `marketing-requests/` are a staging area between the browser and
 * Jira.
 * The happy path deletes each one the moment Jira has the file; this rule is the
 * backstop for the rest:
 *
 *   - an upload the user abandoned before submitting
 *   - a file Jira refused, kept briefly so a retry is possible
 *   - anything orphaned by a crash mid-submission
 *
 * Idempotent: run it again to change the retention window.
 */

import {
  S3Client,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_UPLOADS_BUCKET, R2_BUCKET } = process.env;

const bucket = (R2_UPLOADS_BUCKET || R2_BUCKET || '').trim();
const required = { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, bucket };
for (const [name, value] of Object.entries(required)) {
  if (!value) {
    console.error(
      `Missing ${name === 'bucket' ? 'R2_UPLOADS_BUCKET (or R2_BUCKET)' : name}.\n` +
        'Run with: node --env-file=.env.local scripts/set-r2-lifecycle.mjs'
    );
    process.exit(1);
  }
}

if (!R2_UPLOADS_BUCKET) {
  console.warn(
    '[r2-lifecycle] R2_UPLOADS_BUCKET is not set — falling back to R2_BUCKET, which also serves the\n' +
      '               public asset catalog. Create a dedicated PRIVATE bucket for request uploads.\n'
  );
}

// Scoped to exactly the request-upload prefix. It is NOT bucket-wide: if this
// bucket ever also held public assets, a bucket-wide rule would delete them.
const RETENTION_DAYS = 1;
const PREFIX = 'marketing-requests/';
// The pre-hardening prefix. Kept as a second rule so objects staged by an older
// deploy still expire instead of lingering forever.
const LEGACY_PREFIX = 'requests/';

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function show() {
  try {
    const current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    console.log(JSON.stringify(current.Rules, null, 2));
  } catch (err) {
    if (err?.name === 'NoSuchLifecycleConfiguration') {
      console.log('[r2-lifecycle] no lifecycle rules are configured on this bucket.');
      return;
    }
    throw err;
  }
}

if (process.argv.includes('--show')) {
  await show();
  process.exit(0);
}

await client.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'expire-staged-request-attachments',
          Status: 'Enabled',
          Filter: { Prefix: PREFIX },
          Expiration: { Days: RETENTION_DAYS },
          // Clean up interrupted browser uploads too.
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        },
        {
          ID: 'expire-legacy-staged-request-attachments',
          Status: 'Enabled',
          Filter: { Prefix: LEGACY_PREFIX },
          Expiration: { Days: RETENTION_DAYS },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        },
      ],
    },
  })
);

console.log(`[r2-lifecycle] applied to bucket "${bucket}".`);
console.log(`  prefix    : ${PREFIX} (and legacy ${LEGACY_PREFIX})`);
console.log(`  expires   : ${RETENTION_DAYS} day(s) after upload`);
console.log('  scope     : these prefixes ONLY — no bucket-wide expiry rule was created');
console.log('\nCurrent rules:');
await show();
