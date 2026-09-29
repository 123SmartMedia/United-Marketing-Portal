import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSlot,
  availableStartTimes,
  allStartTimes,
  dateStatus,
  roomNow,
  roomTimeToUtc,
  isValidDateString,
  formatTime,
  formatDuration,
  SLOT_ERRORS,
} from '../src/lib/booking/rules.js';
import { bookingSchema } from '../src/lib/booking/schema.js';
import { createCancelToken, verifyCancelToken, getBookingSecret, cancelUrl } from '../src/lib/booking/token.js';
import { buildIcs } from '../src/lib/booking/ics.js';
import { isAllowedBookingEmail, bookingNotifyEmails } from '../src/lib/booking/config.js';
import { createBooking, cancelBooking, listBookings, readMonth, BookingStoreError } from '../src/lib/booking/store.js';

// Monday 5 October 2026, 8:00 AM in New York (EDT, UTC-4).
const NOW = new Date('2026-10-05T12:00:00Z');
const MONDAY = '2026-10-05';
const TUESDAY = '2026-10-06';
const SATURDAY = '2026-10-10';

// ---------------------------------------------------------------- rules

test('roomNow reports New York wall-clock date and minutes', () => {
  assert.deepEqual(roomNow(NOW), { date: MONDAY, minutes: 8 * 60 });
  // 02:00 UTC on the 6th is still the evening of the 5th in New York.
  assert.equal(roomNow(new Date('2026-10-06T02:00:00Z')).date, MONDAY);
});

test('roomTimeToUtc handles both sides of the November DST change', () => {
  assert.equal(roomTimeToUtc('2026-10-30', '10:00').toISOString(), '2026-10-30T14:00:00.000Z'); // EDT
  assert.equal(roomTimeToUtc('2026-11-02', '10:00').toISOString(), '2026-11-02T15:00:00.000Z'); // EST
});

test('isValidDateString rejects impossible dates', () => {
  assert.equal(isValidDateString('2026-02-28'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('10/05/2026'), false);
});

test('start times run 8:00 AM to 5:30 PM in half hours', () => {
  const times = allStartTimes();
  assert.equal(times[0], '08:00');
  assert.equal(times.at(-1), '17:30');
  assert.equal(times.length, 20);
});

test('dateStatus enforces weekdays, no past dates and the 60-day window', () => {
  assert.equal(dateStatus(TUESDAY, NOW), null);
  assert.equal(dateStatus(SATURDAY, NOW), SLOT_ERRORS.CLOSED_DAY);
  assert.equal(dateStatus('2026-10-02', NOW), SLOT_ERRORS.PAST);
  assert.equal(dateStatus('2026-12-07', NOW), SLOT_ERRORS.TOO_FAR);
  assert.equal(dateStatus('nope', NOW), SLOT_ERRORS.INVALID_DATE);
});

test('validateSlot accepts a valid slot and computes its end', () => {
  const res = validateSlot({ date: TUESDAY, start: '10:00', durationMinutes: 90 }, [], NOW);
  assert.deepEqual(res, { ok: true, slot: { date: TUESDAY, start: '10:00', end: '11:30', durationMinutes: 90 } });
});

test('validateSlot rejects bad times, lengths and hours', () => {
  const v = (start, durationMinutes) => validateSlot({ date: TUESDAY, start, durationMinutes }, [], NOW).error;
  assert.equal(v('10:15', 60), SLOT_ERRORS.INVALID_TIME);
  assert.equal(v('07:30', 60), SLOT_ERRORS.OUTSIDE_HOURS);
  assert.equal(v('10:00', 45), SLOT_ERRORS.BAD_DURATION);
  assert.equal(v('10:00', 270), SLOT_ERRORS.BAD_DURATION);
  assert.equal(v('17:00', 90), SLOT_ERRORS.OUTSIDE_HOURS);
  assert.equal(v('17:30', 30), undefined);
});

test('validateSlot rejects times already past today', () => {
  const at = new Date('2026-10-05T14:10:00Z'); // 10:10 AM EDT
  assert.equal(validateSlot({ date: MONDAY, start: '10:00', durationMinutes: 30 }, [], at).error, SLOT_ERRORS.PAST);
  assert.equal(validateSlot({ date: MONDAY, start: '10:30', durationMinutes: 30 }, [], at).ok, true);
});

test('validateSlot detects overlaps but allows back-to-back bookings', () => {
  const existing = [{ date: TUESDAY, start: '10:00', end: '11:00' }];
  const v = (start, durationMinutes) => validateSlot({ date: TUESDAY, start, durationMinutes }, existing, NOW);
  assert.equal(v('10:30', 60).error, SLOT_ERRORS.CONFLICT);
  assert.equal(v('09:00', 120).error, SLOT_ERRORS.CONFLICT);
  assert.equal(v('09:00', 60).ok, true);
  assert.equal(v('11:00', 60).ok, true);
});

test('availableStartTimes excludes times that would overlap', () => {
  const existing = [{ date: TUESDAY, start: '09:00', end: '17:00' }];
  assert.deepEqual(availableStartTimes(TUESDAY, 60, existing, NOW), ['08:00', '17:00']);
  assert.deepEqual(availableStartTimes(TUESDAY, 30, existing, NOW), ['08:00', '08:30', '17:00', '17:30']);
});

test('formatting helpers', () => {
  assert.equal(formatTime('08:00'), '8:00 AM');
  assert.equal(formatTime('12:30'), '12:30 PM');
  assert.equal(formatTime('17:30'), '5:30 PM');
  assert.equal(formatDuration(30), '30 min');
  assert.equal(formatDuration(60), '1 hr');
  assert.equal(formatDuration(150), '2 hr 30 min');
  assert.equal(formatDuration(240), '4 hrs');
});

// ---------------------------------------------------------------- schema + config

const VALID_FORM = {
  date: TUESDAY,
  start: '10:00',
  durationMinutes: '60',
  name: 'Jane Officer',
  email: 'jofficer@unitedmortgage.com',
  purpose: 'FTHB tips episode',
  attendees: '2',
};

test('bookingSchema coerces numbers and requires the essentials', () => {
  const ok = bookingSchema.safeParse(VALID_FORM);
  assert.equal(ok.success, true);
  assert.equal(ok.data.durationMinutes, 60);
  assert.equal(ok.data.attendees, 2);

  const bad = bookingSchema.safeParse({ ...VALID_FORM, purpose: ' ', attendees: '9', durationMinutes: '45' });
  const paths = bad.error.issues.map((i) => i.path[0]).sort();
  assert.deepEqual(paths, ['attendees', 'durationMinutes', 'purpose']);
});

test('booking email allow-list is closed by default', () => {
  assert.equal(isAllowedBookingEmail('a@unitedmortgage.com', {}), true);
  assert.equal(isAllowedBookingEmail('a@UnitedMortgage.com', {}), true);
  assert.equal(isAllowedBookingEmail('a@gmail.com', {}), false);
  assert.equal(isAllowedBookingEmail('a@partner.com', { BOOKING_ALLOWED_EMAIL_DOMAINS: 'partner.com' }), true);
  assert.equal(isAllowedBookingEmail(undefined, {}), false);
});

test('booking notifications go to marketing@ by default and honour BOOKING_NOTIFY_EMAIL', () => {
  assert.deepEqual(bookingNotifyEmails({}), ['marketing@unitedmortgage.com']);
  assert.deepEqual(bookingNotifyEmails({ BOOKING_NOTIFY_EMAIL: '  ' }), ['marketing@unitedmortgage.com']);
  assert.deepEqual(bookingNotifyEmails({ BOOKING_NOTIFY_EMAIL: 'Studio@UnitedMortgage.com' }), ['studio@unitedmortgage.com']);
  assert.deepEqual(
    bookingNotifyEmails({ BOOKING_NOTIFY_EMAIL: 'a@unitedmortgage.com, not-an-email ,b@unitedmortgage.com,a@unitedmortgage.com' }),
    ['a@unitedmortgage.com', 'b@unitedmortgage.com']
  );
  // Nothing valid → fall back rather than notify no one.
  assert.deepEqual(bookingNotifyEmails({ BOOKING_NOTIFY_EMAIL: 'oops' }), ['marketing@unitedmortgage.com']);
});

// ---------------------------------------------------------------- cancel tokens

const SECRET = 'test-secret-that-is-long-enough';

test('cancel tokens verify only for the booking they were issued for', () => {
  const ref = { id: '11111111-1111-4111-8111-111111111111', date: TUESDAY };
  const token = createCancelToken(ref, SECRET);
  assert.equal(verifyCancelToken({ ...ref, token }, SECRET), true);
  assert.equal(verifyCancelToken({ ...ref, date: MONDAY, token }, SECRET), false);
  assert.equal(verifyCancelToken({ ...ref, token }, 'another-secret-entirely-xx'), false);
  assert.equal(verifyCancelToken({ ...ref, token: 'short' }, SECRET), false);
  assert.equal(verifyCancelToken({ ...ref, token }, ''), false);
  assert.match(cancelUrl('https://x.test', ref, SECRET), /^https:\/\/x\.test\/podcast-studio\/cancel\?id=.+&date=2026-10-06&t=/);
});

test('getBookingSecret prefers BOOKING_SECRET and refuses short secrets', () => {
  assert.equal(getBookingSecret({ BOOKING_SECRET: SECRET, UPLOAD_FINALIZE_SECRET: 'other-long-secret-value' }), SECRET);
  assert.equal(getBookingSecret({ UPLOAD_FINALIZE_SECRET: SECRET }), SECRET);
  assert.equal(getBookingSecret({ BOOKING_SECRET: 'short' }), '');
  assert.equal(getBookingSecret({}), '');
});

// ---------------------------------------------------------------- ics

test('buildIcs writes UTC times, escapes text and folds long lines', () => {
  const ics = buildIcs(
    {
      id: 'abc',
      date: '2026-11-02',
      start: '10:00',
      end: '11:30',
      name: 'Jane Officer',
      attendees: 2,
      purpose: 'Rates, refis; and a very long episode title that will certainly need folding across lines',
    },
    { now: NOW }
  );
  assert.match(ics, /DTSTART:20261102T150000Z/);
  assert.match(ics, /DTEND:20261102T163000Z/);
  assert.match(ics, /Rates\\, refis\\; and/);
  assert.ok(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75));
  assert.match(buildIcs({ id: 'abc', date: TUESDAY, start: '10:00', end: '11:00', name: 'J', attendees: 1, purpose: 'x' }, { cancelled: true }), /METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
});

// ---------------------------------------------------------------- store

/** In-memory stand-in for R2 that honours If-Match / If-None-Match like the real thing. */
function fakeR2() {
  const objects = new Map(); // key -> { body, etag }
  let version = 0;
  const client = {
    reads: 0,
    failNextRead: false,
    async send(command) {
      await new Promise((r) => setImmediate(r)); // let concurrent callers interleave
      const { Key, Body, IfMatch, IfNoneMatch } = command.input;
      if (command.constructor.name === 'GetObjectCommand') {
        client.reads += 1;
        if (client.failNextRead) {
          client.failNextRead = false;
          throw Object.assign(new Error('boom'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } });
        }
        const obj = objects.get(Key);
        if (!obj) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { ETag: obj.etag, Body: { transformToString: async () => obj.body } };
      }
      const current = objects.get(Key);
      const mismatch = (IfNoneMatch === '*' && current) || (IfMatch && current?.etag !== IfMatch);
      if (mismatch) throw Object.assign(new Error('precondition'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      version += 1;
      objects.set(Key, { body: Body, etag: `"v${version}"` });
      return {};
    },
  };
  return { client, objects };
}

const STORE_CONFIG = { configured: true, bucket: 'private-bucket' };
const INPUT = { date: TUESDAY, start: '10:00', durationMinutes: 60, name: 'Jane', email: 'Jane@UnitedMortgage.com', purpose: 'Ep 1', attendees: 2, notes: '' };

test('createBooking stores a confirmed booking in the month document', async () => {
  const { client, objects } = fakeR2();
  const res = await createBooking(INPUT, { now: NOW, client, config: STORE_CONFIG });
  assert.equal(res.ok, true);
  assert.equal(res.booking.end, '11:00');
  assert.equal(res.booking.email, 'jane@unitedmortgage.com');
  assert.ok(objects.has('bookings/podcast-room/2026-10.json'));
});

test('two people racing for the same slot: exactly one wins', async () => {
  const { client } = fakeR2();
  const opts = { now: NOW, client, config: STORE_CONFIG };
  const results = await Promise.all([createBooking(INPUT, opts), createBooking({ ...INPUT, name: 'Bob' }, opts)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok).error, SLOT_ERRORS.CONFLICT);
  assert.equal((await listBookings(['2026-10'], opts)).length, 1);
});

test('racing for different slots in the same month: both succeed', async () => {
  const { client } = fakeR2();
  const opts = { now: NOW, client, config: STORE_CONFIG };
  const results = await Promise.all([createBooking(INPUT, opts), createBooking({ ...INPUT, start: '14:00' }, opts)]);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.equal((await listBookings(['2026-10'], opts)).length, 2);
});

test('a failed read is an error, never an empty month that could be overwritten', async () => {
  const { client } = fakeR2();
  const opts = { now: NOW, client, config: STORE_CONFIG };
  await createBooking(INPUT, opts);
  client.failNextRead = true;
  await assert.rejects(createBooking({ ...INPUT, start: '14:00' }, opts), (err) => err instanceof BookingStoreError && err.code === 'read_failed');
  assert.equal((await readMonth('2026-10', opts)).bookings.length, 1);
});

test('cancelBooking frees the slot and is idempotent', async () => {
  const { client } = fakeR2();
  const opts = { now: NOW, client, config: STORE_CONFIG };
  const { booking } = await createBooking(INPUT, opts);
  const cancelled = await cancelBooking(booking.id, booking.date, opts);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await cancelBooking(booking.id, booking.date, opts), null);
  assert.equal((await listBookings(['2026-10'], opts)).length, 0);
  assert.equal((await createBooking({ ...INPUT, name: 'Bob' }, opts)).ok, true);
});

test('store refuses to run without a private bucket', async () => {
  await assert.rejects(
    createBooking(INPUT, { now: NOW, config: { configured: false } }),
    (err) => err.code === 'not_configured'
  );
});
