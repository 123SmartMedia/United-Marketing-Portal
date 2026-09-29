import test from 'node:test';
import assert from 'node:assert/strict';

import { halfHourStatus, mondayOf, STATUS } from '../src/components/booking/WeekAvailability.jsx';

// Monday 5 October 2026, 10:10 AM in New York (EDT, UTC-4).
const NOW = new Date('2026-10-05T14:10:00Z');

test('mondayOf finds the Monday of the week, treating Sunday as the next week', () => {
  assert.equal(mondayOf('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(mondayOf('2026-10-09'), '2026-10-05'); // Friday
  assert.equal(mondayOf('2026-10-10'), '2026-10-05'); // Saturday
  assert.equal(mondayOf('2026-10-11'), '2026-10-12'); // Sunday -> upcoming week
  assert.equal(mondayOf('2026-11-01'), '2026-11-02'); // across a month boundary
});

test('half hours inside a booking are Booked; edges are Free', () => {
  const bookings = [{ date: '2026-10-06', start: '10:00', end: '11:30' }];
  const s = (time) => halfHourStatus('2026-10-06', time, bookings, NOW);
  assert.equal(s('09:30'), STATUS.FREE);
  assert.equal(s('10:00'), STATUS.BOOKED);
  assert.equal(s('11:00'), STATUS.BOOKED);
  assert.equal(s('11:30'), STATUS.FREE);
});

test('past half hours today, past days and out-of-window days are Unavailable', () => {
  assert.equal(halfHourStatus('2026-10-05', '10:00', [], NOW), STATUS.UNAVAILABLE); // started already
  assert.equal(halfHourStatus('2026-10-05', '10:30', [], NOW), STATUS.FREE);
  assert.equal(halfHourStatus('2026-10-02', '12:00', [], NOW), STATUS.UNAVAILABLE); // last Friday
  assert.equal(halfHourStatus('2026-12-15', '12:00', [], NOW), STATUS.UNAVAILABLE); // beyond 60 days
});

test('bookings on other days never mark a slot Booked', () => {
  const bookings = [{ date: '2026-10-07', start: '08:00', end: '18:00' }];
  assert.equal(halfHourStatus('2026-10-06', '12:00', bookings, NOW), STATUS.FREE);
  assert.equal(halfHourStatus('2026-10-07', '12:00', bookings, NOW), STATUS.BOOKED);
});
