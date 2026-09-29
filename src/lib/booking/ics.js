import { ROOM, roomTimeToUtc } from './rules.js';

/**
 * Calendar invite (.ics) for a booking. Times are written in UTC, which every
 * calendar client resolves correctly without a VTIMEZONE block. A cancellation
 * reuses the same UID with METHOD:CANCEL so clients remove the original event.
 */

const PRODID = '-//United Mortgage//Marketing Desk Podcast Room//EN';

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 text escaping. */
function text(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const bytes = (s) => new TextEncoder().encode(s).length;

/** Fold lines at 75 octets, as RFC 5545 requires. */
function fold(line) {
  const out = [];
  let rest = line;
  while (bytes(rest) > 75) {
    let cut = 75;
    while (bytes(rest.slice(0, cut)) > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(booking, { cancelled = false, organizerEmail, now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${booking.id}@marketing.unitedmortgage.com`,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(roomTimeToUtc(booking.date, booking.start))}`,
    `DTEND:${stamp(roomTimeToUtc(booking.date, booking.end))}`,
    `SUMMARY:${text(`${ROOM.name}: ${booking.purpose}`)}`,
    `LOCATION:${text(ROOM.name)}`,
    `DESCRIPTION:${text(`Booked by ${booking.name} for ${booking.attendees} ${booking.attendees === 1 ? 'person' : 'people'}.`)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (organizerEmail) lines.push(`ORGANIZER;CN=United Marketing Desk:mailto:${organizerEmail}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
