/**
 * Browser persistence for the request wizard — pure helpers, no React.
 *
 *  - Draft: the in-progress form, in sessionStorage, so an accidental refresh
 *    or back-navigation doesn't lose three steps of typing. Never holds File
 *    objects, the honeypot or a Turnstile token.
 *  - Contact: name/email/phone/NMLS/branch, in localStorage, remembered after a
 *    successful submit so the next request is prefilled (WCAG 3.3.7). Also
 *    reads what the Total Expert sign-up form remembered.
 *
 * Every access is wrapped: storage can be disabled, full, or throw in private
 * mode, and none of that may break the form.
 */

export const DRAFT_KEY = 'umd:request-draft';
export const CONTACT_KEY = 'umd:contact';
/** Written by src/components/TotalExpertForm.jsx — read-only here. */
export const TE_CONTACT_KEY = 'umd:te-signup:contact';

export const CONTACT_FIELDS = ['name', 'email', 'phone', 'nmls', 'branch'];

/** Fields that must never be persisted. */
const NEVER_PERSIST = new Set(['files', 'company', 'turnstileToken', 'submissionId']);

function storage(kind) {
  try {
    return typeof window !== 'undefined' ? window[kind] : null;
  } catch {
    return null;
  }
}

function readJson(store, key) {
  try {
    const raw = store?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(store, key, value) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full — persistence is a convenience only.
  }
}

/** Only plain string/boolean values, minus anything sensitive or non-serialisable. */
export function sanitizeDraft(values = {}) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (NEVER_PERSIST.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * True when a draft holds request content the user typed. Contact fields alone
 * don't count — those are prefilled anyway, so "restored your draft" would be noise.
 */
export function hasContent(draft) {
  if (!draft) return false;
  return Object.entries(draft).some(
    ([key, v]) => !CONTACT_FIELDS.includes(key) && (v === true || (typeof v === 'string' && v.trim()))
  );
}

export function readDraft(store = storage('sessionStorage')) {
  const draft = readJson(store, DRAFT_KEY);
  return hasContent(draft) ? sanitizeDraft(draft) : null;
}

export function writeDraft(values, store = storage('sessionStorage')) {
  const draft = sanitizeDraft(values);
  if (hasContent(draft)) writeJson(store, DRAFT_KEY, draft);
}

export function clearDraft(store = storage('sessionStorage')) {
  try {
    store?.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

function pickContact(source) {
  const out = {};
  for (const key of CONTACT_FIELDS) {
    if (typeof source?.[key] === 'string' && source[key].trim()) out[key] = source[key].trim();
  }
  return out;
}

/** Remembered contact details; this form's own record wins over the TE form's. */
export function readContact(store = storage('localStorage')) {
  return { ...pickContact(readJson(store, TE_CONTACT_KEY)), ...pickContact(readJson(store, CONTACT_KEY)) };
}

export function writeContact(values, store = storage('localStorage')) {
  const contact = pickContact(values);
  if (Object.keys(contact).length) writeJson(store, CONTACT_KEY, contact);
}
