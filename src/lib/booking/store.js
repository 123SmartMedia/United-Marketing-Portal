import 'server-only';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

import { getUploadsConfig, createR2Client } from '../r2Uploads.js';
import { ROOM, monthKey, validateSlot, isValidDateString } from './rules.js';

/**
 * Podcast room bookings in Cloudflare R2.
 * ---------------------------------------
 * One JSON document per month at `bookings/podcast-room/YYYY-MM.json`, in the
 * PRIVATE uploads bucket (bookings hold names and emails, so they must never
 * sit in the public asset bucket). The request-upload lifecycle rule is scoped
 * to `marketing-requests/`, so it can never expire these.
 *
 * Double-booking is prevented with R2 conditional writes: every write carries
 * the ETag it read (or If-None-Match: * for a new month), so two people racing
 * for the same slot cannot both succeed — the loser re-reads, sees the
 * conflict, and is told the slot was just taken.
 *
 * Read errors other than "not found" are thrown, never treated as an empty
 * month: an empty read followed by a write would wipe real bookings.
 */

const PREFIX = `bookings/${ROOM.id}/`;
const MAX_WRITE_ATTEMPTS = 4;

export class BookingStoreError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function getBookingStoreConfig(env = process.env) {
  const config = getUploadsConfig(env);
  return { ...config, configured: config.configured && !config.usingPublicAssetBucket };
}

function keyFor(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new BookingStoreError('invalid_month');
  return `${PREFIX}${month}.json`;
}

function isNotFound(err) {
  return err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailure(err) {
  const status = err?.$metadata?.httpStatusCode;
  return status === 412 || status === 409 || err?.name === 'PreconditionFailed';
}

function deps(options = {}) {
  const config = options.config || getBookingStoreConfig();
  if (!config.configured) throw new BookingStoreError('not_configured');
  return { config, client: options.client || createR2Client(config) };
}

/** Read one month. Returns { bookings, etag } — etag is null when the month is new. */
export async function readMonth(month, options = {}) {
  const { config, client } = deps(options);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: keyFor(month) }));
    const parsed = JSON.parse(await res.Body.transformToString());
    return { bookings: Array.isArray(parsed) ? parsed : [], etag: res.ETag || null };
  } catch (err) {
    if (isNotFound(err)) return { bookings: [], etag: null };
    throw new BookingStoreError('read_failed', err?.name || 'unknown');
  }
}

async function writeMonth(month, bookings, etag, { config, client }) {
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: keyFor(month),
      Body: JSON.stringify(bookings, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
    })
  );
}

/**
 * Optimistic read-modify-write. `change(bookings)` returns
 * { bookings: next, result } to write, or { result } to stop without writing.
 */
async function mutateMonth(month, change, options) {
  const d = deps(options);
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { bookings, etag } = await readMonth(month, d);
    const outcome = change(bookings);
    if (!outcome.bookings) return outcome.result;
    try {
      await writeMonth(month, outcome.bookings, etag, d);
      return outcome.result;
    } catch (err) {
      if (!isPreconditionFailure(err)) throw new BookingStoreError('write_failed', err?.name || 'unknown');
    }
  }
  throw new BookingStoreError('write_contention');
}

const isActive = (b) => b.status !== 'cancelled';

/**
 * Create a booking if the slot is still free. Returns
 * { ok: true, booking } or { ok: false, error } (a SLOT_ERRORS code).
 */
export async function createBooking(input, { now = new Date(), ...options } = {}) {
  return mutateMonth(
    monthKey(input.date),
    (bookings) => {
      const check = validateSlot(input, bookings.filter(isActive), now);
      if (!check.ok) return { result: check };
      const booking = {
        id: randomUUID(),
        ...check.slot,
        name: input.name,
        email: input.email.toLowerCase(),
        purpose: input.purpose,
        attendees: input.attendees,
        notes: input.notes || '',
        status: 'confirmed',
        createdAt: now.toISOString(),
      };
      return { bookings: [...bookings, booking], result: { ok: true, booking } };
    },
    options
  );
}

/** Cancel by id. Returns the cancelled booking, or null if it was not found / already cancelled. */
export async function cancelBooking(id, date, { now = new Date(), ...options } = {}) {
  if (!isValidDateString(date)) return null;
  return mutateMonth(
    monthKey(date),
    (bookings) => {
      const target = bookings.find((b) => b.id === id);
      if (!target || !isActive(target)) return { result: null };
      const cancelled = { ...target, status: 'cancelled', cancelledAt: now.toISOString() };
      return {
        bookings: bookings.map((b) => (b.id === id ? cancelled : b)),
        result: cancelled,
      };
    },
    options
  );
}

/** Look up one booking without changing anything. */
export async function findBooking(id, date, options = {}) {
  if (!isValidDateString(date)) return null;
  const { bookings } = await readMonth(monthKey(date), options);
  return bookings.find((b) => b.id === id) || null;
}

/** Active bookings for the given months, sorted by date then start. */
export async function listBookings(months, options = {}) {
  const d = deps(options);
  const all = await Promise.all(months.map((m) => readMonth(m, d)));
  return all
    .flatMap((m) => m.bookings)
    .filter(isActive)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/** Public view of a booking: when, never who. The portal has no login. */
export function toPublicSlot(booking) {
  return { date: booking.date, start: booking.start, end: booking.end };
}
