/**
 * Podcast room booking rules.
 * ---------------------------
 * Pure functions shared by the calendar UI and the booking API, so what the
 * browser offers and what the server accepts can never drift.
 *
 * Times are wall-clock times in the room's own time zone ("10:30" on
 * "2026-10-05" means 10:30 in New York), because the room is a physical place
 * and that is how people think about booking it. Conversion to an absolute
 * instant happens only where one is needed: "is this in the past?" and the
 * calendar invite.
 */

export const ROOM = Object.freeze({
  id: 'podcast-room',
  name: 'Corporate Podcast Room',
  timeZone: 'America/New_York',
});

export const OPEN_MINUTES = 8 * 60; // 8:00 AM
export const CLOSE_MINUTES = 18 * 60; // 6:00 PM
export const SLOT_MINUTES = 30;
export const MIN_DURATION_MINUTES = 30;
export const MAX_DURATION_MINUTES = 240;
export const MAX_DAYS_AHEAD = 60;
/** 0 = Sunday … 6 = Saturday. Monday–Friday. */
export const OPEN_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);

export const SLOT_ERRORS = Object.freeze({
  INVALID_DATE: 'invalid_date',
  CLOSED_DAY: 'closed_day',
  PAST: 'past',
  TOO_FAR: 'too_far',
  INVALID_TIME: 'invalid_time',
  OUTSIDE_HOURS: 'outside_hours',
  BAD_DURATION: 'bad_duration',
  CONFLICT: 'conflict',
});

export const SLOT_ERROR_MESSAGES = Object.freeze({
  [SLOT_ERRORS.INVALID_DATE]: 'Please choose a valid date.',
  [SLOT_ERRORS.CLOSED_DAY]: 'The podcast room can only be booked Monday through Friday.',
  [SLOT_ERRORS.PAST]: 'That time has already passed. Please pick a later time.',
  [SLOT_ERRORS.TOO_FAR]: `Bookings open ${MAX_DAYS_AHEAD} days in advance. Please pick an earlier date.`,
  [SLOT_ERRORS.INVALID_TIME]: 'Please choose a start time from the list.',
  [SLOT_ERRORS.OUTSIDE_HOURS]: 'Bookings must fit between 8:00 AM and 6:00 PM.',
  [SLOT_ERRORS.BAD_DURATION]: 'Bookings can be 30 minutes to 4 hours, in 30-minute steps.',
  [SLOT_ERRORS.CONFLICT]: 'Someone just booked part of that time. Please pick another slot.',
});

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const pad = (n) => String(n).padStart(2, '0');

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDateString(value) {
  const m = DATE_PATTERN.exec(typeof value === 'string' ? value : '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toMinutes(time) {
  const m = TIME_PATTERN.exec(typeof time === 'string' ? time : '');
  return m ? +m[1] * 60 + +m[2] : NaN;
}

export function fromMinutes(total) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Day of week for a YYYY-MM-DD date (0 = Sunday). */
export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** "2026-10" for "2026-10-05". Bookings are stored one document per month. */
export function monthKey(date) {
  return date.slice(0, 7);
}

/** Wall-clock date and minutes-past-midnight in the room's time zone. */
export function roomNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ROOM.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Offset (ms) of the room's time zone from UTC at a given instant. */
function zoneOffsetMs(instantMs) {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: ROOM.timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(instantMs))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name || '');
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60000;
}

/** The absolute instant of a room wall-clock time. DST-correct. */
export function roomTimeToUtc(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const minutes = toMinutes(time);
  const naive = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Two passes: the offset at the naive guess can differ from the offset at the
  // real instant when the guess straddles a DST change.
  const first = naive - zoneOffsetMs(naive);
  return new Date(naive - zoneOffsetMs(first));
}

/** Every start time the room offers, e.g. ["08:00", "08:30", …, "17:30"]. */
export function allStartTimes() {
  const times = [];
  for (let t = OPEN_MINUTES; t + MIN_DURATION_MINUTES <= CLOSE_MINUTES; t += SLOT_MINUTES) {
    times.push(fromMinutes(t));
  }
  return times;
}

export function durationOptions() {
  const out = [];
  for (let d = MIN_DURATION_MINUTES; d <= MAX_DURATION_MINUTES; d += SLOT_MINUTES) out.push(d);
  return out;
}

/** Is this date open for booking at all (weekday, not past, within the window)? */
export function dateStatus(date, now = new Date()) {
  if (!isValidDateString(date)) return SLOT_ERRORS.INVALID_DATE;
  const today = roomNow(now).date;
  if (date < today) return SLOT_ERRORS.PAST;
  if (date > addDays(today, MAX_DAYS_AHEAD)) return SLOT_ERRORS.TOO_FAR;
  if (!OPEN_WEEKDAYS.includes(weekdayOf(date))) return SLOT_ERRORS.CLOSED_DAY;
  return null;
}

/** Half-open interval overlap on the same date. */
export function overlaps(a, b) {
  return (
    a.date === b.date &&
    toMinutes(a.start) < toMinutes(b.end) &&
    toMinutes(b.start) < toMinutes(a.end)
  );
}

/**
 * Validate a requested slot against the rules and the existing bookings.
 * Returns { ok: true, slot: {date,start,end,durationMinutes} } or { ok: false, error }.
 */
export function validateSlot({ date, start, durationMinutes }, existing = [], now = new Date()) {
  const dayError = dateStatus(date, now);
  if (dayError) return { ok: false, error: dayError };

  const startMin = toMinutes(start);
  if (Number.isNaN(startMin) || (startMin - OPEN_MINUTES) % SLOT_MINUTES !== 0) {
    return { ok: false, error: SLOT_ERRORS.INVALID_TIME };
  }

  const duration = Number(durationMinutes);
  if (
    !Number.isInteger(duration) ||
    duration < MIN_DURATION_MINUTES ||
    duration > MAX_DURATION_MINUTES ||
    duration % SLOT_MINUTES !== 0
  ) {
    return { ok: false, error: SLOT_ERRORS.BAD_DURATION };
  }

  const endMin = startMin + duration;
  if (startMin < OPEN_MINUTES || endMin > CLOSE_MINUTES) {
    return { ok: false, error: SLOT_ERRORS.OUTSIDE_HOURS };
  }

  const current = roomNow(now);
  if (date === current.date && startMin <= current.minutes) {
    return { ok: false, error: SLOT_ERRORS.PAST };
  }

  const slot = { date, start: fromMinutes(startMin), end: fromMinutes(endMin), durationMinutes: duration };
  if (existing.some((b) => overlaps(slot, b))) return { ok: false, error: SLOT_ERRORS.CONFLICT };
  return { ok: true, slot };
}

/** Start times on `date` where a booking of `durationMinutes` would be accepted. */
export function availableStartTimes(date, durationMinutes, bookings = [], now = new Date()) {
  return allStartTimes().filter(
    (start) => validateSlot({ date, start, durationMinutes }, bookings, now).ok
  );
}

/** "1:30 PM" for "13:30". */
export function formatTime(time) {
  const minutes = toMinutes(time);
  const h = Math.floor(minutes / 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${pad(minutes % 60)} ${suffix}`;
}

/** "Monday, October 5, 2026" for "2026-10-05". */
export function formatDate(date, { weekday = 'long', month = 'long' } = {}) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday,
    month,
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`;
}
