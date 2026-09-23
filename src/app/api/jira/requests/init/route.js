import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { requestSchema, simpleSchema } from '@/lib/requestSchema';
import { validateFileSet, messageForUploadError } from '@/lib/uploadRules';
import { isAllowedSubmitterEmail } from '@/lib/jira/config';
import { verifyTurnstileToken, TURNSTILE_RESULTS } from '@/lib/turnstile';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';
import {
  getUploadsConfig,
  createR2Client,
  createRequestUploadKey,
} from '@/lib/r2Uploads';
import { logFailure, logRejection, logSuccess, ROUTES, STAGES } from '@/lib/observability';
import {
  createFinalizeToken,
  hashPayload,
  getFinalizeSecret,
  isFinalizeConfigured,
  PRESIGN_TTL_SECONDS,
  FINALIZE_TOKEN_TTL_SECONDS,
} from '@/lib/uploadToken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stage 1 of 2 — the gate.
 * ------------------------
 * Nothing in this application issues an upload URL until a request has passed
 * through here. That is the whole point: the previous `/api/upload-url` endpoint
 * would presign a PUT for anyone who could reach it, which made the bucket a free
 * file host for any bot that found the route.
 *
 * Order is deliberate and runs cheapest-first, so an abusive caller is rejected
 * before it costs us an external call:
 *
 *   1. same-origin + body size
 *   2. honeypot                      (free, catches naive bots)
 *   3. rate limit                    (free, per IP)
 *   4. form + attachment validation  (free, local)
 *   5. submitter email domain        (free, local)
 *   6. Turnstile siteverify          <-- the only outbound call, and the last gate
 *   7. only now: mint keys, presign PUTs, sign the finalize token
 *
 * The response contains a presigned PUT per file and an opaque finalize token.
 * It never contains a readable URL, a bucket name, an account id, or anything
 * that would let the browser read back what it uploaded.
 */

const MAX_BODY_BYTES = 128 * 1024; // metadata only — bytes go straight to R2
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 8 };

const TURNSTILE_MESSAGES = {
  [TURNSTILE_RESULTS.MISSING]:
    'Please complete the “Verify you’re human” challenge before submitting.',
  [TURNSTILE_RESULTS.DUPLICATE]:
    'Your verification expired. Please complete the challenge again and resubmit.',
  [TURNSTILE_RESULTS.TIMEOUT]:
    'We couldn’t reach the verification service. Please try again in a moment.',
  [TURNSTILE_RESULTS.UNAVAILABLE]:
    'We couldn’t reach the verification service. Please try again in a moment.',
};
const TURNSTILE_GENERIC =
  'We couldn’t verify that submission. Please complete the challenge again and resubmit.';

export async function POST(request) {
  const correlationId = randomUUID();

  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'forbidden_origin' }, { status: 403 });
  }

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload_too_large', correlationId }, { status: 413 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload_too_large', correlationId }, { status: 413 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'validation', correlationId }, { status: 400 });
  }

  // 2. Honeypot. Answer as though it worked, but mint nothing: a bot learns
  //    nothing from the response and gets no upload URL.
  if (body.company) {
    return NextResponse.json({ ok: true, requestId: null, uploads: [], finalizeToken: null, correlationId });
  }

  const ip = clientIp(request);

  // 3. Rate limit.
  const limit = checkRateLimit(`jira-init:${ip}`, RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many attempts. Please wait a moment and try again.',
        correlationId,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  // 4. Form validation.
  const schema = body.source === 'wizard' ? requestSchema : simpleSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'validation',
        message: 'Please check the highlighted fields and try again.',
        correlationId,
        // Field paths only — never the submitted values.
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      },
      { status: 400 }
    );
  }
  const submission = parsed.data;

  // 4b. Attachment metadata. Checked here, before any upload URL exists, so a
  //     disallowed file never gets a place to land.
  const fileCheck = validateFileSet(body.files);
  if (!fileCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: fileCheck.error,
        message: messageForUploadError(fileCheck.error, fileCheck.fileName),
        correlationId,
        fields: ['files'],
      },
      { status: 400 }
    );
  }
  const files = fileCheck.files;

  // 5. Submitter allow-list.
  if (!isAllowedSubmitterEmail(submission.email)) {
    logRejection({
      route: ROUTES.INIT,
      stage: STAGES.EMAIL_DOMAIN_VALIDATION,
      category: 'email_domain_not_allowed',
      status: 403,
      correlationId,
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'email_domain_not_allowed',
        message:
          'Please submit with your United Mortgage work email address. If you believe this is a mistake, email marketing@unitedmortgage.com.',
        correlationId,
        fields: ['email'],
      },
      { status: 403 }
    );
  }

  const submissionId =
    typeof body.submissionId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.submissionId)
      ? body.submissionId
      : null;

  // 6. Turnstile. The last gate, and the only one that costs an outbound call.
  const turnstile = await verifyTurnstileToken(body.turnstileToken, {
    remoteIp: ip,
    idempotencyKey: submissionId || correlationId,
  });
  if (!turnstile.ok) {
    // A timeout and an unreachable siteverify are both OUR problem, not the
    // caller's input: answer 503 so a monitor sees a dependency failure and the
    // browser does not report it as a validation error.
    const turnstileStatus =
      turnstile.result === TURNSTILE_RESULTS.UNAVAILABLE ||
      turnstile.result === TURNSTILE_RESULTS.TIMEOUT
        ? 503
        : 400;
    // The outcome code is safe to log. The token never is.
    logRejection({
      route: ROUTES.INIT,
      stage: STAGES.TURNSTILE_VALIDATION,
      category: turnstile.result,
      status: turnstileStatus,
      correlationId,
    });
    return NextResponse.json(
      {
        ok: false,
        error: turnstile.result,
        message: TURNSTILE_MESSAGES[turnstile.result] || TURNSTILE_GENERIC,
        correlationId,
        resetChallenge: true,
      },
      { status: turnstileStatus }
    );
  }

  // ---- Past every gate. Only now do we mint anything. ----

  if (!isFinalizeConfigured()) {
    logFailure({
      route: ROUTES.INIT,
      stage: STAGES.FINALIZE_TOKEN_SIGNING,
      category: 'uploads_not_configured',
      status: 503,
      correlationId,
      missingEnv: ['UPLOAD_FINALIZE_SECRET'],
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'uploads_not_configured',
        message: 'Submissions aren’t available right now. Please email marketing@unitedmortgage.com.',
        correlationId,
      },
      { status: 503 }
    );
  }

  const requestId = randomUUID();
  const uploadsConfig = getUploadsConfig();

  // A submission with no files needs no bucket at all, so it must not be blocked
  // by an unconfigured or misconfigured R2.
  if (files.length && !uploadsConfig.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: 'uploads_not_configured',
        message:
          'File uploads aren’t enabled yet. You can submit without files and email them to marketing@unitedmortgage.com.',
        correlationId,
        fields: ['files'],
      },
      { status: 503 }
    );
  }
  if (files.length && uploadsConfig.usingPublicAssetBucket) {
    // Staging attachments in the public catalog bucket would make them readable
    // by URL. The keys are still random, but this is a misconfiguration.
    logRejection({
      route: ROUTES.INIT,
      stage: STAGES.UPLOAD_CONFIGURATION,
      category: 'staging_in_public_bucket',
      status: 200,
      correlationId,
      requestId,
      missingEnv: ['R2_UPLOADS_BUCKET'],
    });
  }

  let uploads = [];
  if (files.length) {
    try {
      const client = createR2Client(uploadsConfig);
      uploads = await Promise.all(
        files.map(async (file, index) => {
          const key = createRequestUploadKey(requestId);
          const uploadUrl = await getSignedUrl(
            client,
            new PutObjectCommand({
              Bucket: uploadsConfig.bucket,
              Key: key,
              // Pins the content type into the signature: the browser cannot PUT
              // a different type than the one we validated.
              ContentType: file.type,
              ContentLength: file.size,
            }),
            { expiresIn: PRESIGN_TTL_SECONDS }
          );
          return { index, key, uploadUrl, name: file.name, type: file.type, size: file.size };
        })
      );
    } catch (err) {
      logFailure({
        route: ROUTES.INIT,
        stage: STAGES.R2_PRESIGN,
        category: 'presign_failed',
        status: 500,
        correlationId,
        requestId,
        reason: err?.name || 'unknown',
      });
      return NextResponse.json(
        {
          ok: false,
          error: 'presign_failed',
          message: 'We couldn’t prepare your file upload. Please try again, or submit without files.',
          correlationId,
        },
        { status: 500 }
      );
    }
  }

  const finalizeToken = createFinalizeToken({
    requestId,
    idempotencyKey: submissionId,
    keys: uploads.map((u) => u.key),
    payloadHash: hashPayload({ ...submission, files }, getFinalizeSecret()),
    ttlSeconds: FINALIZE_TOKEN_TTL_SECONDS,
  });

  // Never the keys, never the URLs — only how many were issued.
  logSuccess({
    route: ROUTES.INIT,
    stage: STAGES.R2_PRESIGN,
    category: 'upload_plan_issued',
    status: 200,
    correlationId,
    requestId,
    fileCount: files.length,
  });

  return NextResponse.json(
    {
      ok: true,
      requestId,
      finalizeToken,
      // Each entry carries the presigned PUT and the key the browser must echo
      // back at finalize. No readable URL, no bucket, no account id.
      uploads: uploads.map((u) => ({ index: u.index, key: u.key, uploadUrl: u.uploadUrl })),
      uploadExpiresInSeconds: PRESIGN_TTL_SECONDS,
      correlationId,
    },
    { status: 200 }
  );
}
