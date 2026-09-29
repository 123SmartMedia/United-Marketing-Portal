'use client';

import {
  allStartTimes,
  addDays,
  dateStatus,
  roomNow,
  toMinutes,
  formatDate,
  formatTime,
  SLOT_MINUTES,
} from '@/lib/booking/rules';

/**
 * Week at a glance: every half hour, Monday–Friday, marked Free / Booked /
 * Unavailable. Anyone can read it — it shows WHEN the room is taken, never who
 * took it. Clicking a free block starts a booking at that time.
 */

const TIMES = allStartTimes();
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const STATUS = Object.freeze({ FREE: 'free', BOOKED: 'booked', UNAVAILABLE: 'unavailable' });

/** Status of the half hour starting at `time` on `date`. Pure; exported for tests. */
export function halfHourStatus(date, time, bookings, now = new Date()) {
  if (dateStatus(date, now)) return STATUS.UNAVAILABLE;
  const current = roomNow(now);
  const t = toMinutes(time);
  if (date === current.date && t <= current.minutes) return STATUS.UNAVAILABLE;
  const taken = bookings.some((b) => b.date === date && toMinutes(b.start) < t + SLOT_MINUTES && t < toMinutes(b.end));
  return taken ? STATUS.BOOKED : STATUS.FREE;
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function mondayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDays(date, weekday === 0 ? 1 : 1 - weekday);
}

const CELL = {
  [STATUS.FREE]: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 cursor-pointer',
  [STATUS.BOOKED]: 'bg-navy-700 text-white',
  [STATUS.UNAVAILABLE]: 'bg-navy-50 text-navy-400',
};
const WORD = { [STATUS.FREE]: 'Free', [STATUS.BOOKED]: 'Booked', [STATUS.UNAVAILABLE]: '—' };

export default function WeekAvailability({ weekStart, bookings, loading, now, onPick, onPrev, onNext, canPrev, canNext }) {
  const days = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
  const title = `${formatDate(days[0], { weekday: undefined, month: 'short' })} – ${formatDate(days[4], { weekday: undefined, month: 'short' })}`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-navy-900" aria-live="polite">
          Week of {title}
        </h3>
        <div className="flex gap-2">
          <WeekNav onClick={onPrev} disabled={!canPrev} label="Previous week" path="M12.5 15 7.5 10l5-5" />
          <WeekNav onClick={onNext} disabled={!canNext} label="Next week" path="m7.5 15 5-5-5-5" />
        </div>
      </div>

      <Legend />

      <div className="mt-3 overflow-hidden rounded-xl border border-navy-100" aria-busy={loading}>
        <table className="w-full table-fixed border-collapse text-xs">
          <caption className="sr-only">
            Podcast room availability, week of {title}, Eastern Time. Free times can be selected to book.
          </caption>
          <thead>
            <tr className="bg-navy-50">
              <th scope="col" className="w-14 py-2 text-left font-semibold text-navy-600 sm:w-20">
                <span className="pl-2">ET</span>
              </th>
              {days.map((d, i) => (
                <th key={d} scope="col" className="py-2 font-semibold text-navy-800">
                  <abbr title={formatDate(d)} className="no-underline">
                    {WEEKDAYS[i]} <span className="text-navy-600">{Number(d.slice(8))}</span>
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIMES.map((time) => (
              <tr key={time} className="border-t border-navy-50">
                <th scope="row" className="whitespace-nowrap py-0.5 pl-2 text-left font-medium text-navy-600">
                  {time.endsWith(':00') ? formatTime(time).replace(':00', '') : <span className="sr-only">{formatTime(time)}</span>}
                </th>
                {days.map((date) => {
                  const status = loading ? STATUS.UNAVAILABLE : halfHourStatus(date, time, bookings, now);
                  const label = `${formatDate(date)}, ${formatTime(time)}: ${loading ? 'loading' : WORD[status] === '—' ? 'unavailable' : WORD[status].toLowerCase()}`;
                  return (
                    <td key={date} className="p-0.5">
                      {status === STATUS.FREE ? (
                        <button
                          type="button"
                          onClick={() => onPick(date, time)}
                          aria-label={`${label}. Select to book.`}
                          className={`flex h-7 w-full items-center justify-center rounded text-[10px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 ${CELL[status]}`}
                        >
                          <span aria-hidden="true" className="hidden sm:inline">Free</span>
                        </button>
                      ) : (
                        <div role="img" aria-label={label} className={`flex h-7 w-full items-center justify-center rounded text-[10px] font-semibold ${CELL[status]}`}>
                          <span aria-hidden="true" className="hidden sm:inline">{loading ? '' : WORD[status]}</span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    [STATUS.FREE, 'Free — click to book'],
    [STATUS.BOOKED, 'Booked'],
    [STATUS.UNAVAILABLE, 'Past or not bookable'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-700" aria-label="Legend">
      {items.map(([status, text]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${CELL[status].split(' hover:')[0]}`} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}

function WeekNav({ onClick, disabled, label, path }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-navy-200 text-navy-700 transition hover:border-brand-500 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
