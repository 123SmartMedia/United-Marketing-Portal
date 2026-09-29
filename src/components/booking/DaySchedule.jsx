'use client';

import {
  allStartTimes,
  validateSlot,
  formatDate,
  formatTime,
  formatDuration,
  toMinutes,
  fromMinutes,
} from '@/lib/booking/rules';
import { DURATION_OPTIONS } from '@/lib/booking/schema';

/**
 * One day's schedule: pick a length, then a start time. Taken times stay
 * visible (struck through) so people can see how busy the room is, not just
 * what is left.
 */
export default function DaySchedule({ date, bookings, duration, onDuration, start, onStart, now }) {
  const dayBookings = bookings.filter((b) => b.date === date);
  const times = allStartTimes().map((t) => ({
    time: t,
    ok: validateSlot({ date, start: t, durationMinutes: duration }, bookings, now).ok,
  }));
  const openCount = times.filter((t) => t.ok).length;

  return (
    <div>
      <h3 className="text-lg font-bold text-navy-900">{formatDate(date)}</h3>

      <label htmlFor="booking-duration" className="mt-4 mb-1.5 block text-sm font-medium text-navy-800">
        How long do you need the room?
      </label>
      <select
        id="booking-duration"
        value={duration}
        onChange={(e) => onDuration(Number(e.target.value))}
        className="h-12 w-full rounded-xl border border-navy-200 bg-white px-4 text-[15px] text-navy-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus-visible:outline-none sm:w-56"
      >
        {DURATION_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {formatDuration(d)}
          </option>
        ))}
      </select>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium text-navy-800">
          Start time <span className="font-normal text-navy-500">(Eastern Time · {openCount} open)</span>
        </legend>
        {openCount === 0 ? (
          <p className="rounded-xl bg-navy-50 px-4 py-3 text-sm text-navy-600">
            No {formatDuration(duration)} openings on this day. Try a shorter length or another day.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {times.map(({ time, ok }) => {
              const selected = time === start;
              return (
                <button
                  key={time}
                  type="button"
                  disabled={!ok}
                  aria-pressed={selected}
                  aria-label={`${formatTime(time)} to ${formatTime(fromMinutes(toMinutes(time) + duration))}${ok ? '' : ', unavailable'}`}
                  onClick={() => onStart(time)}
                  className={`h-11 rounded-lg text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                    selected
                      ? 'bg-brand-600 text-white shadow'
                      : ok
                        ? 'bg-white text-navy-800 ring-1 ring-navy-200 hover:bg-brand-50 hover:ring-brand-500'
                        : 'cursor-not-allowed bg-navy-50 text-navy-400 line-through'
                  }`}
                >
                  {formatTime(time)}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      {dayBookings.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-500">Already booked</h4>
          <ul className="mt-2 flex flex-wrap gap-2">
            {dayBookings.map((b) => (
              <li key={`${b.start}-${b.end}`} className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                {formatTime(b.start)} – {formatTime(b.end)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
