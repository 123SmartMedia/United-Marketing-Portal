import 'server-only';

import { jiraFetch, JiraError, JIRA_ERRORS } from './client.js';
import { getJiraConfig } from './config.js';
import { MAX_FILES, MAX_TOTAL_BYTES, MAX_FILE_BYTES, ACCEPTED_UPLOAD_TYPES } from '../requestSchema.js';
import {
  getUploadsConfig,
  createR2Client,
  readUploadObject,
  deleteUploadObject,
  isValidUploadKey,
  extensionFromKey,
} from '../r2Uploads.js';

/**
 * Jira attachment workflow.
 * -------------------------
 * The browser stages file bytes in a PRIVATE R2 bucket through a presigned PUT
 * (see /api/upload-url), which keeps large files off the serverless body limit.
 * Only `{name, key, size, type}` reaches the server — no URL exists client-side.
 *
 * Jira's supported sequence, in this order:
 *
 *   1. Create the customer request                 (submitRequest.js)
 *   2. POST .../servicedesk/{id}/attachTemporaryFile
 *      (multipart, with the mandatory `X-Atlassian-Token: no-check` header)
 *   3. POST .../request/{key}/attachment
 *      to permanently attach the temporary IDs to the created request.
 *
 * Bytes are read back from R2 with the server's own S3 credentials — never over
 * HTTP from a public host — so there is no fetch-by-URL SSRF surface and the
 * bucket needs no public access.
 *
 * Lifecycle: a staged object is deleted as soon as Jira has it. One that could
 * not be attached is left in place for the R2 lifecycle rule to expire (see
 * UPLOAD_RETENTION_DAYS), giving a short retry window. No public fallback link
 * is ever produced — not in the response, not in the Jira description, not in a
 * log line.
 */

/** Extensions that pair with the accepted MIME types. Executables are never allowed. */
const ALLOWED_EXTENSIONS = Object.freeze({
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
});

/** Defence in depth — rejected regardless of the declared MIME type. */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'ps1', 'sh', 'jar',
  'js', 'mjs', 'vbs', 'app', 'apk', 'deb', 'rpm', 'zip', 'rar', '7z', 'html', 'htm', 'svg',
]);

/**
 * Leading bytes each accepted type must actually start with. A declared MIME
 * type is a claim by the client; this is the check on the bytes themselves.
 */
const MAGIC_BYTES = Object.freeze({
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
});

const MAX_FILENAME_LENGTH = 120;

export const ATTACHMENT_ERRORS = Object.freeze({
  TOO_MANY: 'too_many_files',
  TOO_LARGE: 'total_size_exceeded',
  UNSUPPORTED_TYPE: 'unsupported_file_type',
  INVALID_FILE: 'invalid_file',
  UNTRUSTED_SOURCE: 'untrusted_file_source',
});

/** Strip path separators and anything unusual; keep it recognizable in Jira. */
export function sanitizeFilename(name) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_FILENAME_LENGTH);
  return base || 'attachment';
}

function extensionOf(name) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

/** Do the first bytes match what the declared content type promises? */
export function matchesDeclaredType(buffer, contentType) {
  const signatures = MAGIC_BYTES[contentType];
  if (!signatures) return false;
  return signatures.some((signature) =>
    signature.every((byte, index) => buffer[index] === byte)
  );
}

/**
 * Validate the file metadata the browser submitted.
 * Returns { ok: true, files } or { ok: false, error, fileName? }.
 * Reuses the existing form limits so server rules can never be looser than the UI.
 */
export function validateAttachments(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { ok: true, files: [] };
  if (list.length > MAX_FILES) return { ok: false, error: ATTACHMENT_ERRORS.TOO_MANY };

  let total = 0;
  const validated = [];
  const seenKeys = new Set();

  for (const file of list) {
    const name = sanitizeFilename(file?.name);
    const size = Number(file?.size);
    const type = String(file?.type || '');
    const key = String(file?.key || '');

    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
      return { ok: false, error: ATTACHMENT_ERRORS.INVALID_FILE, fileName: name };
    }
    if (!ACCEPTED_UPLOAD_TYPES.includes(type)) {
      return { ok: false, error: ATTACHMENT_ERRORS.UNSUPPORTED_TYPE, fileName: name };
    }
    const extension = extensionOf(name);
    if (BLOCKED_EXTENSIONS.has(extension) || !ALLOWED_EXTENSIONS[type].includes(extension)) {
      return { ok: false, error: ATTACHMENT_ERRORS.UNSUPPORTED_TYPE, fileName: name };
    }
    // The key must be one this server minted. Legacy keys embed an extension, so
    // it is cross-checked against the declared type; current keys are two bare
    // UUIDs by design, and the type is verified by HeadObject at finalize plus
    // the magic-byte check in loadVerifiedBytes().
    const keyExtension = extensionFromKey(key);
    if (!isValidUploadKey(key) || (keyExtension && !ALLOWED_EXTENSIONS[type].includes(keyExtension))) {
      return { ok: false, error: ATTACHMENT_ERRORS.UNTRUSTED_SOURCE, fileName: name };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: ATTACHMENT_ERRORS.INVALID_FILE, fileName: name };
    }
    seenKeys.add(key);

    total += size;
    if (total > MAX_TOTAL_BYTES) return { ok: false, error: ATTACHMENT_ERRORS.TOO_LARGE };

    validated.push({ name, size, type, key });
  }

  return { ok: true, files: validated };
}

/**
 * Upload one file to Jira's temporary store.
 * Returns the temporaryAttachmentId.
 */
async function uploadTemporaryFile(file, buffer, config) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: file.type }), file.name);

  const result = await jiraFetch(
    `/rest/servicedeskapi/servicedesk/${encodeURIComponent(config.serviceDeskId)}/attachTemporaryFile`,
    {
      method: 'POST',
      body: form,
      rawBody: true,
      // Mandatory for this endpoint; Jira rejects the upload without it.
      extraHeaders: { 'X-Atlassian-Token': 'no-check' },
      config,
    }
  );

  const id = result?.temporaryAttachments?.[0]?.temporaryAttachmentId;
  if (!id) throw new JiraError(JIRA_ERRORS.VALIDATION, { detail: 'no temporaryAttachmentId returned' });
  return id;
}

/**
 * Read a staged object and check the bytes really are what was declared.
 * Throws a short code; the caller logs only the code and the filename.
 */
async function loadVerifiedBytes(file, uploadsConfig, client) {
  const buffer = await readUploadObject(file.key, {
    config: uploadsConfig,
    client,
    maxBytes: MAX_FILE_BYTES,
  });

  // The declared size is a client claim; the object is the truth.
  if (buffer.length !== file.size) throw new Error('size_mismatch');
  if (!matchesDeclaredType(buffer, file.type)) throw new Error('content_type_mismatch');
  return buffer;
}

/**
 * Upload every validated file and attach it to `issueKey`.
 *
 * Never throws — returns { attached, failed, error } so a partial attachment
 * failure can be reported honestly without discarding a created request.
 * `attached` is the number Jira actually accepted, so the UI can say "2 of 3"
 * rather than implying everything landed.
 */
export async function attachFilesToRequest(
  issueKey,
  files,
  { config = getJiraConfig(), uploadsConfig = getUploadsConfig(), r2Client } = {}
) {
  if (!files.length) return { attached: 0, failed: 0, error: null };
  if (!config.attachmentsEnabled) return { attached: 0, failed: files.length, error: 'attachments_disabled' };
  if (!uploadsConfig.configured) return { attached: 0, failed: files.length, error: 'attachment_storage_unavailable' };

  const client = r2Client || createR2Client(uploadsConfig);
  const staged = []; // { file, temporaryId }
  let failed = 0;

  for (const file of files) {
    try {
      const buffer = await loadVerifiedBytes(file, uploadsConfig, client);
      staged.push({ file, temporaryId: await uploadTemporaryFile(file, buffer, config) });
    } catch (err) {
      failed += 1;
      // Filename only. Never the object key, never a URL.
      console.error('[jira] attachment staging failed', {
        issueKey,
        fileName: file.name,
        reason: err?.code || err?.message || 'unknown',
      });
    }
  }

  if (!staged.length) {
    // Leave the objects in place: the lifecycle rule expires them, and the short
    // window allows a manual retry.
    return { attached: 0, failed, error: 'attachment_upload_failed' };
  }

  try {
    await jiraFetch(`/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/attachment`, {
      method: 'POST',
      body: {
        temporaryAttachmentIds: staged.map((entry) => entry.temporaryId),
        // Visible to the reporter in the portal, like any file they'd attach there.
        public: true,
      },
      config,
    });
  } catch (err) {
    console.error('[jira] permanent attachment failed', {
      issueKey,
      reason: err?.code || 'unknown',
      status: err?.status,
    });
    return { attached: 0, failed: files.length, error: 'attachment_attach_failed' };
  }

  // Jira owns the bytes now — drop the staging copies.
  for (const entry of staged) {
    await deleteUploadObject(entry.file.key, { config: uploadsConfig, client });
  }

  return {
    attached: staged.length,
    failed,
    error: failed ? 'attachment_partial_failure' : null,
  };
}

/** How many times a transient Jira attachment failure is retried. */
export const ATTACHMENT_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

/**
 * `attachFilesToRequest` with a bounded retry.
 *
 * Jira's attachment endpoints fail transiently often enough (rate limiting, a
 * 5xx from the gateway) that one attempt is not a fair test, and the ticket
 * already exists by this point — giving up immediately would strand files the
 * user believes they sent.
 *
 * Only *whole-batch* failures are retried. A partial success is returned as-is:
 * the files Jira accepted have already had their staging objects deleted, and
 * retrying would re-upload duplicates of them.
 *
 * Never throws. The final result is whatever the last attempt produced.
 */
export async function attachFilesWithRetry(issueKey, files, options = {}) {
  const { maxAttempts = ATTACHMENT_MAX_ATTEMPTS, sleep = defaultSleep, ...rest } = options;
  let result = { attached: 0, failed: files.length, error: 'attachment_upload_failed' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await attachFilesToRequest(issueKey, files, rest);
    if (result.attached > 0) return { ...result, attempts: attempt };

    if (attempt < maxAttempts) {
      console.warn('[jira] attachment attempt failed, retrying', {
        issueKey,
        attempt,
        maxAttempts,
        reason: result.error,
      });
      // Linear backoff. The caller is a user-facing request, so this stays short.
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  return { ...result, attempts: maxAttempts };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
