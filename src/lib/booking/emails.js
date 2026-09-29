import 'server-only';

import { sendMail, DESK_EMAIL } from '../submissions.js';
import { buildIcs } from './ics.js';
import { ROOM, formatDate, formatTime, formatDuration } from './rules.js';
import { bookingNotifyEmails } from './config.js';

/**
 * Booking emails: a confirmation (with calendar invite and cancel link) to the
 * person who booked, a heads-up to BOOKING_NOTIFY_EMAIL (default
 * marketing@unitedmortgage.com), and matching notices on cancellation. All
 * best-effort — a booking stands even if email fails.
 */

function esc(value = '') {
  return String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
}

function when(b) {
  return `${formatDate(b.date)}, ${formatTime(b.start)} – ${formatTime(b.end)} ET`;
}

function detailRows(b, { includeContact = false } = {}) {
  const rows = [
    ['When', when(b)],
    ['Length', formatDuration(b.durationMinutes)],
    ['Recording', b.purpose],
    ['People', String(b.attendees)],
    ...(includeContact ? [['Booked by', `${b.name} <${b.email}>`]] : []),
    ['Notes', b.notes],
  ].filter(([, v]) => v);
  return rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 12px;color:#3a5c8f;font-weight:600;width:110px;vertical-align:top">${esc(k)}</td><td style="padding:5px 12px;color:#24395c">${esc(v).replace(/\n/g, '<br>')}</td></tr>`
    )
    .join('');
}

function layout(title, body) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#24395c;line-height:1.5">
    <div style="background:#14213d;padding:20px 24px;border-radius:10px 10px 0 0">
      <span style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.02em">UNITED</span>
      <span style="color:#a3c8ec;font-weight:600;font-size:11px;letter-spacing:.3em">&nbsp;MORTGAGE&nbsp;CORP</span>
    </div>
    <div style="border:1px solid #eef2f8;border-top:0;border-radius:0 0 10px 10px;padding:24px">
      <h2 style="margin:0 0 12px;color:#14213d;font-size:19px">${esc(title)}</h2>
      ${body}
      <p style="margin:20px 0 0;color:#3a5c8f;font-size:13px">— The United Marketing Desk</p>
    </div>
  </div>`;
}

const table = (rows) =>
  `<table style="border-collapse:collapse;background:#f7f9fc;border-radius:8px;margin:0 0 16px;width:100%">${rows}</table>`;

function icsAttachment(booking, cancelled) {
  return [
    {
      content: Buffer.from(buildIcs(booking, { cancelled, organizerEmail: DESK_EMAIL })).toString('base64'),
      filename: cancelled ? 'podcast-room-cancelled.ics' : 'podcast-room.ics',
      type: 'text/calendar',
      disposition: 'attachment',
    },
  ];
}

export async function sendBookingConfirmation(booking, { cancelLink }) {
  const firstName = booking.name.trim().split(/\s+/)[0];
  const body = `
    <p style="margin:0 0 16px">Hi ${esc(firstName)}, the ${esc(ROOM.name)} is yours. Open the attached invite to add it to your calendar.</p>
    ${table(detailRows(booking))}
    <p style="margin:0 0 16px">Plans changed? <a href="${esc(cancelLink)}" style="color:#245699;font-weight:600">Cancel this booking</a> so a teammate can use the room.</p>
    <p style="margin:0">Questions? Reply to this email.</p>`;
  return sendMail(
    {
      to: booking.email,
      toName: booking.name,
      subject: `Booked: ${ROOM.name} — ${formatDate(booking.date, { weekday: 'short', month: 'short' })}, ${formatTime(booking.start)}`,
      html: layout('Your podcast room booking is confirmed', body),
      replyTo: { email: DESK_EMAIL, name: 'United Marketing Desk' },
      attachments: icsAttachment(booking, false),
    },
    'booking-confirmation'
  );
}

export async function sendBookingDeskNotice(booking, { cancelled = false } = {}) {
  const title = cancelled ? 'Podcast room booking cancelled' : 'New podcast room booking';
  return sendMail(
    {
      to: bookingNotifyEmails(),
      subject: `[Podcast Room] ${cancelled ? 'Cancelled' : 'Booked'}: ${formatDate(booking.date, { weekday: 'short', month: 'short' })} ${formatTime(booking.start)} — ${booking.name}`,
      html: layout(title, table(detailRows(booking, { includeContact: true }))),
      replyTo: { email: booking.email, name: booking.name },
    },
    cancelled ? 'booking-desk-cancel' : 'booking-desk'
  );
}

export async function sendCancellationNotice(booking) {
  const body = `
    <p style="margin:0 0 16px">Your booking has been cancelled and the time is open for others.</p>
    ${table(detailRows(booking))}
    <p style="margin:0">Open the attached file to remove it from your calendar.</p>`;
  return sendMail(
    {
      to: booking.email,
      toName: booking.name,
      subject: `Cancelled: ${ROOM.name} — ${formatDate(booking.date, { weekday: 'short', month: 'short' })}, ${formatTime(booking.start)}`,
      html: layout('Podcast room booking cancelled', body),
      replyTo: { email: DESK_EMAIL, name: 'United Marketing Desk' },
      attachments: icsAttachment(booking, true),
    },
    'booking-cancellation'
  );
}
