/**
 * File rules for request attachments — the single source of truth.
 * -----------------------------------------------------------------
 * Imported by the browser dropzone, by `/api/jira/requests/init` (metadata, before
 * any upload URL is issued) and by `/api/jira/requests/finalize` (again, against
 * what R2 actually stored). The client copy is a courtesy; the server copies are
 * the ones that hold, and none of them can be looser than another because they
 * all read these constants.
 *
 * This module is free of secrets, I/O and `server-only` so it can be unit tested
 * directly and imported from a client component.
 */

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file
export const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB combined
export const MAX_FILENAME_LENGTH = 120;

/** Accepted MIME types, each with the extensions that may pair with it. */
export const ALLOWED_TYPES = Object.freeze({
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
});

export const ACCEPTED_UPLOAD_TYPES = Object.freeze(Object.keys(ALLOWED_TYPES));
export const ACCEPTED_UPLOAD_EXT = '.pdf,.png,.jpg,.jpeg';

/**
 * Extensions rejected outright, whatever MIME type is declared. Executables,
 * scripts, archives and anything the browser would render as active content.
 */
export const BLOCKED_EXTENSIONS = Object.freeze(
  new Set([
    'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'cpl', 'hta',
    'ps1', 'psm1', 'sh', 'bash', 'zsh', 'jar', 'class', 'py', 'rb', 'pl',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'vbs', 'vbe', 'wsf', 'wsh', 'reg',
    'app', 'apk', 'ipa', 'deb', 'rpm', 'dmg', 'pkg', 'run', 'bin',
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab',
    'html', 'htm', 'xhtml', 'svg', 'xml', 'swf', 'php', 'asp', 'aspx', 'jsp',
    'lnk', 'url', 'scf', 'inf', 'sys', 'drv',
  ])
);

/**
 * Extensions recognized as "a file type". Used only to detect a DOUBLE
 * EXTENSION: `invoice.exe.pdf` must not pass just because it ends in `.pdf`.
 * A segment that is not a known extension (`report.v2.pdf`) is left alone, so
 * ordinary version-style names still work.
 */
const KNOWN_EXTENSIONS = Object.freeze(
  new Set([
    ...BLOCKED_EXTENSIONS,
    'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'rtf', 'odt',
    'mp3', 'mp4', 'mov', 'avi', 'wmv', 'mkv', 'wav',
  ])
);

export const UPLOAD_ERRORS = Object.freeze({
  TOO_MANY: 'too_many_files',
  TOTAL_TOO_LARGE: 'total_size_exceeded',
  EMPTY_FILE: 'empty_file',
  FILE_TOO_LARGE: 'file_too_large',
  UNSUPPORTED_TYPE: 'unsupported_file_type',
  BLOCKED_EXTENSION: 'blocked_extension',
  DOUBLE_EXTENSION: 'double_extension',
  EXTENSION_MISMATCH: 'extension_type_mismatch',
  INVALID_NAME: 'invalid_filename',
});

/**
 * Strip directory components and anything unusual, keeping the name recognizable
 * in Jira. Never used to build an object key — the key is random — only as the
 * display filename attached to the ticket.
 */
export function sanitizeFilename(name) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .replace(/_{3,}/g, '__')
    .slice(0, MAX_FILENAME_LENGTH);
  return base || 'attachment';
}

/** Lowercase final extension of a filename, or '' when it has none. */
export function extensionOf(name) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

/**
 * True when a non-final dot segment is itself a recognized file extension —
 * the `invoice.exe.pdf` / `photo.jpg.pdf` shape.
 */
export function hasDoubleExtension(name) {
  const parts = String(name || '').toLowerCase().split('.');
  if (parts.length < 3) return false;
  // Skip index 0 (the stem) and the last (the real extension).
  return parts.slice(1, -1).some((part) => KNOWN_EXTENSIONS.has(part));
}

/**
 * Validate one file's declared metadata.
 * Returns { ok: true, file } with a sanitized name, or { ok: false, error, fileName }.
 */
export function validateFileMetadata(input) {
  const fileName = sanitizeFilename(input?.name);

  if (!input?.name || fileName === 'attachment') {
    // A name that sanitizes away entirely tells us nothing and is not worth
    // guessing at — reject rather than silently rename.
    if (!String(input?.name || '').trim()) {
      return { ok: false, error: UPLOAD_ERRORS.INVALID_NAME, fileName };
    }
  }

  const size = Number(input?.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: UPLOAD_ERRORS.EMPTY_FILE, fileName };
  }
  if (size > MAX_FILE_BYTES) {
    return { ok: false, error: UPLOAD_ERRORS.FILE_TOO_LARGE, fileName };
  }

  const type = String(input?.type || '');
  if (!ALLOWED_TYPES[type]) {
    return { ok: false, error: UPLOAD_ERRORS.UNSUPPORTED_TYPE, fileName };
  }

  const extension = extensionOf(fileName);
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return { ok: false, error: UPLOAD_ERRORS.BLOCKED_EXTENSION, fileName };
  }
  if (hasDoubleExtension(fileName)) {
    return { ok: false, error: UPLOAD_ERRORS.DOUBLE_EXTENSION, fileName };
  }
  if (!ALLOWED_TYPES[type].includes(extension)) {
    return { ok: false, error: UPLOAD_ERRORS.EXTENSION_MISMATCH, fileName };
  }

  return { ok: true, file: { name: fileName, size, type } };
}

/**
 * Validate the whole attachment set.
 * Returns { ok: true, files } (sanitized, in submitted order) or
 * { ok: false, error, fileName? }.
 */
export function validateFileSet(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { ok: true, files: [] };
  if (list.length > MAX_FILES) return { ok: false, error: UPLOAD_ERRORS.TOO_MANY };

  const validated = [];
  let total = 0;

  for (const entry of list) {
    const result = validateFileMetadata(entry);
    if (!result.ok) return result;
    total += result.file.size;
    if (total > MAX_TOTAL_BYTES) return { ok: false, error: UPLOAD_ERRORS.TOTAL_TOO_LARGE };
    validated.push(result.file);
  }

  return { ok: true, files: validated };
}

/** User-facing wording. Never names an object key, a bucket or a URL. */
export function messageForUploadError(error, fileName) {
  const who = fileName ? `“${fileName}”` : 'That file';
  switch (error) {
    case UPLOAD_ERRORS.TOO_MANY:
      return `You can attach up to ${MAX_FILES} files.`;
    case UPLOAD_ERRORS.TOTAL_TOO_LARGE:
      return `Total upload size must stay under ${MAX_TOTAL_BYTES / 1024 / 1024}MB.`;
    case UPLOAD_ERRORS.FILE_TOO_LARGE:
      return `${who} is larger than ${MAX_FILE_BYTES / 1024 / 1024}MB.`;
    case UPLOAD_ERRORS.EMPTY_FILE:
      return `${who} looks empty. Please choose a different file.`;
    case UPLOAD_ERRORS.UNSUPPORTED_TYPE:
      return `${who} isn’t a supported type. Use PDF, PNG, or JPG.`;
    case UPLOAD_ERRORS.BLOCKED_EXTENSION:
    case UPLOAD_ERRORS.DOUBLE_EXTENSION:
    case UPLOAD_ERRORS.EXTENSION_MISMATCH:
      return `${who} can’t be accepted. Please upload a plain PDF, PNG, or JPG.`;
    case UPLOAD_ERRORS.INVALID_NAME:
      return 'Please rename that file and try again.';
    default:
      return 'That file couldn’t be accepted. Please try a different one.';
  }
}
