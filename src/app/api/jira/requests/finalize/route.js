import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requestSchema, simpleSchema } from '@/lib/requestSchema';
import { validateFileSet, ALLOWED_TYPES, MAX_FILE_BYTES } from '@/lib/uploadRules';
import { submitJiraRequest } from '@/lib/jira/submitRequest';
import { getJiraConfig, isJiraConfigured, missingJiraConfig } from '@/lib/jira/config';
import { JIRA_ERRORS } from '@/lib/jira/client';
import { messageForError, statusForError } from '@/lib/jira/responseMessages';
import { attachFilesWithRetry } from '@/lib/jira/attachments';
import { checkRateLimit, clientIp, isSameOrigin } from '@/lib/rateLimit';
import { getIdempotencyStore } from '@/lib/idempotencyStore';
import { deliverSubmission, sendAcknowledgment } from '@/lib/submissions';
import {
  getUploadsConfig,
  createR2Client,
  headUploadObject,
  deleteUploadObject,
  keyBelongsToRequest,
} from '@/lib/r2Uploads';
import { logFailure, logRejection, logSuccess, ROUTES, STAGES } from '@/lib/observability';
import {
  verifyFinalizeToken,
  hashPayload,
  hashesMatch,
  getFinalizeSecret,
  isFinalizeConfigured,
} from '@/lib/uploadToken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stage 2 of 2 — the commit.
 * --------------------------
 * By the time a caller reaches here, `/api/jira/requests/init` has already
 * redeemed a Turnstile token, validated the form, and handed back a signed token
 * naming exactly which object keys this submission may use. This endpoint runs
 * NO challenge of its own; instead it proves the caller holds that token, that
 * the form has not changed since, and that the objects in R2 are the ones that
 * were promised.
 *
 * Failure handling is the substance of this route:
 *
 *   Jira creation fails      -> every staged object is deleted immediately.
 *   Attachment succeeds      -> that object is deleted immediately.
 *   Attachment fails N times -> the object is LEFT IN PLACE, private, for the
 *                               lifecycle rule to expire. The ticket exists and
 *                               the response says honestly how many files landed.
 *   Caller never returns     -> nothing runs here at all; the lifecycle rule
 *                               collects the abandoned objects.
 *
 * Nothing in the response, the Jira description, or any log line contains an
 * object key, a bucket name, a presigned URL or a credential.
 */

const MAX_BODY_BYTES = 128 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 8 };

/** Generic for every token problem: which part failed is not the caller's business. */
const TOKEN_REJECTED = {
  error: 'invalid_submission',
  message: 'Your session expired. Please complete the challenge again and resubmit.',
};

function reject(status, payload, correlationId) {
  return NextResponse.json({ ok: false, correlationId, ...payload }, { status });
}

/** Delete every staged object, best effort. Used on the failure paths. */
async function purge(keys, uploadsConfig, client) {
  if (!keys.length || !uploadsConfig.configured) return;
  await Promise.all(keys.map((key) => deleteUploadObject(key, { config: uploadsConfig, client })));
}

export async function POST(request) {
  const correlationId = randomUUID();
  const store = getIdempotencyStore();

  if (!isSameOrigin(request)) {
    return reject(403, { error: 'forbidden_origin' }, correlationId);
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return reject(413, { error: JIRA_ERRORS.PAYLOAD_TOO_LARGE }, correlationId);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return reject(413, { error: JIRA_ERRORS.PAYLOAD_TOO_LARGE }, correlationId);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reject(400, { error: 'validation' }, correlationId);
  }

  const limit = checkRateLimit(`jira-finalize:${clientIp(request)}`, RATE_LIMIT);
  if (!limit.allowed) {
    return reject(
      429,
      { error: 'rate_limited', message: messageForError('rate_limited') },
      correlationId
    );
  }

  if (!isFinalizeConfigured()) {
    logFailure({
      route: ROUTES.FINALIZE,
      stage: STAGES.UPLOAD_CONFIGURATION,
      category: 'uploads_not_configured',
      status: 503,
      correlationId,
      missingEnv: ['UPLOAD_FINALIZE_SECRET'],
    });
    return reject(
      503,
      {
        error: 'uploads_not_configured',
        message: 'Submissions aren’t available right now. Please email marketing@unitedmortgage.com.',
      },
      correlationId
    );
  }

  // 1. The signed token: signature, structure and expiry.
  const verified = verifyFinalizeToken(body.finalizeToken);
  if (!verified.ok) {
    logRejection({
      route: ROUTES.FINALIZE,
      stage: STAGES.FINALIZE_TOKEN_VERIFICATION,
      category: verified.error,
      status: 400,
      correlationId,
    });
    return reject(400, { ...TOKEN_REJECTED, resetChallenge: true }, correlationId);
  }
  const { rid: requestId, keys: permittedKeys, hash: expectedHash, idem } = verified.payload;

  // 2. Re-validate the form on its own terms. The token proves the payload is
  //    unchanged, but a token minted against a payload that was valid then must
  //    still parse now — schema and token are independent checks.
  const schema = body.source === 'wizard' ? requestSchema : simpleSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return reject(
      400,
      {
        error: 'validation',
        message: messageForError('validation'),
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      },
      correlationId
    );
  }
  const submission = parsed.data;

  const fileCheck = validateFileSet(body.files);
  if (!fileCheck.ok) {
    return reject(400, { error: fileCheck.error, fields: ['files'] }, correlationId);
  }
  const files = fileCheck.files;

  // 3. The payload hash. Any edited field between init and finalize lands here.
  const actualHash = hashPayload({ ...submission, files }, getFinalizeSecret());
  if (!hashesMatch(actualHash, expectedHash)) {
    logRejection({
      route: ROUTES.FINALIZE,
      stage: STAGES.PAYLOAD_HASH_VERIFICATION,
      category: 'payload_hash_mismatch',
      status: 400,
      correlationId,
      requestId,
    });
    return reject(400, { ...TOKEN_REJECTED, resetChallenge: true }, correlationId);
  }

  // 4. The object keys. Each submitted key must be in the token's permitted set
  //    AND inside this request's own namespace. Two independent checks, because
  //    a key that passes one and not the other is an attack, not a mistake.
  const submittedKeys = (Array.isArray(body.files) ? body.files : []).map((f) => String(f?.key || ''));
  const permitted = new Set(permittedKeys);

  if (submittedKeys.length !== files.length) {
    return reject(400, { ...TOKEN_REJECTED }, correlationId);
  }
  for (const key of submittedKeys) {
    if (!permitted.has(key) || !keyBelongsToRequest(key, requestId)) {
      logRejection({
        route: ROUTES.FINALIZE,
        stage: STAGES.OBJECT_KEY_VERIFICATION,
        category: 'unexpected_object_key',
        status: 400,
        correlationId,
        requestId,
      });
      return reject(400, { ...TOKEN_REJECTED }, correlationId);
    }
  }
  if (new Set(submittedKeys).size !== submittedKeys.length) {
    return reject(400, { ...TOKEN_REJECTED }, correlationId);
  }

  // Pair each validated file with the key it was uploaded under.
  const staged = files.map((file, index) => ({ ...file, key: submittedKeys[index] }));

  // 5. Idempotency — after validation, so a bad payload never burns the slot.
  const submissionId =
    typeof idem === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(idem) ? idem : null;

  const cached = store.get(submissionId);
  if (cached) {
    return NextResponse.json({ ...cached, duplicate: true }, { status: 200 });
  }
  if (!store.claim(submissionId)) {
    return reject(
      409,
      { error: 'in_progress', message: 'Your request is still being submitted…' },
      correlationId
    );
  }

  const uploadsConfig = getUploadsConfig();
  const r2Client = staged.length && uploadsConfig.configured ? createR2Client(uploadsConfig) : null;
  const allKeys = staged.map((f) => f.key);

  try {
    // 6. HeadObject every staged file. R2 is the source of truth about what was
    //    actually stored; the browser's metadata is only a claim.
    for (const file of staged) {
      const head = await headUploadObject(file.key, { config: uploadsConfig, client: r2Client });
      if (!head.ok) {
        await purge(allKeys, uploadsConfig, r2Client);
        return reject(
          400,
          {
            error: head.error === 'not_found' ? 'upload_missing' : 'upload_unverifiable',
            message:
              head.error === 'not_found'
                ? 'One of your files didn’t finish uploading. Please try attaching it again.'
                : 'We couldn’t verify your uploaded files. Please try again.',
            fields: ['files'],
          },
          correlationId
        );
      }
      // Size must match exactly. A larger object than declared is how a caller
      // would try to turn a 10MB allowance into unbounded storage.
      if (head.size !== file.size || head.size <= 0 || head.size > MAX_FILE_BYTES) {
        logRejection({
          route: ROUTES.FINALIZE,
          stage: STAGES.R2_VERIFICATION,
          category: 'upload_size_mismatch',
          status: 400,
          correlationId,
          requestId,
        });
        await purge(allKeys, uploadsConfig, r2Client);
        return reject(
          400,
          { error: 'upload_size_mismatch', message: 'One of your files changed during upload. Please try again.', fields: ['files'] },
          correlationId
        );
      }
      // Content type is pinned by the presigned PUT, so a mismatch means the
      // signature was bypassed or the object was replaced.
      const storedType = head.contentType.split(';')[0].trim().toLowerCase();
      if (storedType !== file.type || !ALLOWED_TYPES[storedType]) {
        logRejection({
          route: ROUTES.FINALIZE,
          stage: STAGES.R2_VERIFICATION,
          category: 'upload_type_mismatch',
          status: 400,
          correlationId,
          requestId,
        });
        await purge(allKeys, uploadsConfig, r2Client);
        return reject(
          400,
          { error: 'upload_type_mismatch', message: 'One of your files couldn’t be accepted. Please try again.', fields: ['files'] },
          correlationId
        );
      }
    }

    // 7. Jira.
    const config = getJiraConfig();
    if (!isJiraConfigured(config)) {
      // The missing variable NAMES are the whole point of this line: an
       // operator with only the Reference ID can see exactly what to set.
      logFailure({
        route: ROUTES.FINALIZE,
        stage: STAGES.JIRA_CONFIGURATION,
        category: JIRA_ERRORS.NOT_CONFIGURED,
        status: statusForError(JIRA_ERRORS.NOT_CONFIGURED),
        correlationId,
        requestId,
        missingEnv: missingJiraConfig(config),
      });
      await purge(allKeys, uploadsConfig, r2Client);
      return reject(
        statusForError(JIRA_ERRORS.NOT_CONFIGURED),
        { error: JIRA_ERRORS.NOT_CONFIGURED, message: messageForError(JIRA_ERRORS.NOT_CONFIGURED) },
        correlationId
      );
    }

    // Attachments are handled below, not inside submitJiraRequest, so this route
    // owns the retry and the cleanup on both outcomes.
    const result = await submitJiraRequest(
      { ...submission, files: staged },
      {
        correlationId,
        submittedFrom: new URL(request.url).host,
        uploadsConfig,
        r2Client,
        skipAttachments: true,
      }
    );

    if (!result.ok) {
      // Jira creation failed: there is no ticket these files could ever belong
      // to, so they are deleted now rather than left for the lifecycle rule.
      await purge(allKeys, uploadsConfig, r2Client);

      if (config.emailFallbackEnabled) {
        const delivery = await deliverSubmission(submission);
        if (delivery.delivered) {
          logRejection({
            route: ROUTES.FINALIZE,
            stage: STAGES.JIRA_REQUEST_CREATION,
            category: result.error,
            status: 200,
            upstreamStatus: result.status,
            correlationId,
            outcome: 'email_fallback',
          });
          const payload = {
            ok: true,
            requestKey: null,
            requestUrl: null,
            portalUrl: config.portalUrl,
            correlationId,
            fallback: 'email',
          };
          store.remember(submissionId, payload);
          return NextResponse.json(payload, { status: 200 });
        }
      }

      return reject(
        result.status === 429 ? 502 : statusForError(result.error),
        {
          error: result.error,
          message: messageForError(result.error, {
            attachmentError: result.attachmentError,
            fileName: result.fileName,
          }),
        },
        correlationId
      );
    }

    // 8. Attach, with a bounded retry. attachFilesWithRetry reads each object
    //    server-side through the S3 API, uploads it to Jira, permanently attaches
    //    it, and deletes the staging object on success.
    let attachments = { total: 0, attached: 0, failed: 0, warning: null };
    if (staged.length) {
      const outcome = await attachFilesWithRetry(result.issueKey, staged, {
        config,
        uploadsConfig,
        r2Client,
      });
      attachments = {
        total: staged.length,
        attached: outcome.attached,
        failed: staged.length - outcome.attached,
        warning: outcome.error,
      };
      // Anything Jira never accepted stays private until the lifecycle rule
      // expires it, which keeps a short manual-retry window open.
      if (outcome.attached === 0) {
        logFailure({
          route: ROUTES.FINALIZE,
          stage: STAGES.JIRA_ATTACHMENT,
          category: outcome.error || 'attachment_upload_failed',
          status: 201,
          correlationId,
          attempts: outcome.attempts,
          fileCount: staged.length,
          attachedCount: 0,
          failedCount: staged.length,
        });
      }
    }

    if (config.ackEmailEnabled && submission.email) {
      try {
        await sendAcknowledgment({ ...submission, requestKey: result.issueKey });
      } catch (err) {
        logFailure({
          route: ROUTES.FINALIZE,
          stage: STAGES.ACKNOWLEDGMENT_EMAIL,
          category: 'ack_email_failed',
          status: 201,
          correlationId,
          reason: err?.message,
        });
      }
    }

    const payload = {
      ok: true,
      requestKey: result.issueKey,
      requestUrl: result.webUrl,
      portalUrl: result.portalUrl,
      correlationId,
      attachments,
    };
    store.remember(submissionId, payload);
    return NextResponse.json(payload, { status: 201 });
  } catch (err) {
    logFailure({
      route: ROUTES.FINALIZE,
      stage: STAGES.UNHANDLED,
      category: JIRA_ERRORS.UNAVAILABLE,
      status: statusForError(JIRA_ERRORS.UNAVAILABLE),
      correlationId,
      reason: err?.message,
    });
    // An unknown failure leaves objects behind rather than deleting files that
    // may already belong to a created ticket. The lifecycle rule collects them.
    return reject(
      statusForError(JIRA_ERRORS.UNAVAILABLE),
      { error: JIRA_ERRORS.UNAVAILABLE, message: messageForError(JIRA_ERRORS.UNAVAILABLE) },
      correlationId
    );
  } finally {
    store.release(submissionId);
  }
}
