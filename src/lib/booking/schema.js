import { z } from '../zod.js';
import { durationOptions } from './rules.js';

/**
 * Podcast room booking form schema — shared by the booking form (client
 * validation) and POST /api/podcast-room/bookings (server validation).
 * Slot rules (hours, weekdays, conflicts) live in rules.js and are checked by
 * the server against live bookings, not here.
 */

export const DURATION_OPTIONS = durationOptions();
export const MAX_ATTENDEES = 6;

const nonEmpty = (msg, max) => z.string().trim().min(1, msg).max(max, `Please keep this under ${max} characters.`);

export const bookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a date.'),
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Please choose a start time.'),
  durationMinutes: z.coerce
    .number()
    .refine((n) => DURATION_OPTIONS.includes(n), 'Please choose a length.'),
  name: nonEmpty('Please enter your full name.', 100),
  email: z.string().trim().max(200).email('Please enter a valid work email.'),
  purpose: nonEmpty('Please tell us what you’re recording.', 120),
  attendees: z.coerce
    .number()
    .int()
    .min(1, 'At least 1 person.')
    .max(MAX_ATTENDEES, `The room fits up to ${MAX_ATTENDEES} people.`),
  notes: z.string().trim().max(1000, 'Please keep notes under 1,000 characters.').optional().default(''),
  // Honeypot
  company: z.string().optional().default(''),
});

export const cancelSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  token: z.string().min(20).max(200),
});
