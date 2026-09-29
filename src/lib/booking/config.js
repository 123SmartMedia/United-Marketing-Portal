import { parseDomainList } from '../jira/config.js';

/**
 * Who may book the podcast room. Closed by default: unlike the request forms,
 * an empty setting does NOT mean "anyone" — it means United Mortgage only.
 * Override with BOOKING_ALLOWED_EMAIL_DOMAINS (comma-separated).
 */
export const DEFAULT_BOOKING_DOMAINS = Object.freeze(['unitedmortgage.com']);

export function bookingEmailDomains(env = process.env) {
  const configured = parseDomainList(env.BOOKING_ALLOWED_EMAIL_DOMAINS);
  return configured.length ? configured : [...DEFAULT_BOOKING_DOMAINS];
}

/**
 * Who is told about new and cancelled bookings. Separate from REQUEST_EMAIL
 * (the request-form inbox) so the two can point at different people.
 * BOOKING_NOTIFY_EMAIL takes one address or a comma-separated list; invalid
 * entries are ignored, and an empty or all-invalid value falls back to the
 * default rather than notifying no one.
 */
export const DEFAULT_BOOKING_NOTIFY_EMAILS = Object.freeze(['marketing@unitedmortgage.com']);

const EMAIL_PATTERN = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

export function bookingNotifyEmails(env = process.env) {
  const configured = String(env.BOOKING_NOTIFY_EMAIL || '')
    .split(/[,\r\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => EMAIL_PATTERN.test(e));
  return configured.length ? [...new Set(configured)] : [...DEFAULT_BOOKING_NOTIFY_EMAILS];
}

export function isAllowedBookingEmail(email, env = process.env) {
  if (typeof email !== 'string') return false;
  const domain = email.trim().split('@')[1]?.toLowerCase();
  return Boolean(domain) && bookingEmailDomains(env).includes(domain);
}
