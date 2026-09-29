/**
 * Business-day arithmetic for the "Rush request" hint. Pure; dates are
 * YYYY-MM-DD strings compared as calendar days (no time zone involved).
 */

export const RUSH_BUSINESS_DAYS = 7;

function toUtcDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Weekdays (Mon–Fri) after `fromIso` up to and including `toIso`.
 * Same day → 0; Friday → next Monday → 1. Returns null for invalid input or a
 * target date in the past.
 */
export function businessDaysBetween(fromIso, toIso) {
  const from = toUtcDate(fromIso);
  const to = toUtcDate(toIso);
  if (!from || !to || to < from) return null;
  let count = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/** Is `dateIso` fewer than RUSH_BUSINESS_DAYS business days after `todayIso`? */
export function isRushDate(dateIso, todayIso, threshold = RUSH_BUSINESS_DAYS) {
  const days = businessDaysBetween(todayIso, dateIso);
  return days !== null && days < threshold;
}

/** Today's date in the browser's local time zone, as YYYY-MM-DD. */
export function localTodayIso(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
