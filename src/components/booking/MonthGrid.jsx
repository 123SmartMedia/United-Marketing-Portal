'use client';

import { dateStatus, availableStartTimes, formatDate, MIN_DURATION_MINUTES } from '@/lib/booking/rules';

/**
 * Weekday-only month grid (the room is closed on weekends, so Saturday and
 * Sunday columns would only ever be disabled noise). Each day is a real button
 * with a full spoken label, e.g. "Monday, October 5, 2026 — 12 open times".
 */

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const pad = (n) => String(n).padStart(2, '0');

function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (!cells.length) for (let i = 1; i < weekday; i += 1) cells.push(null); // leading blanks
    cells.push(`${y}-${pad(m)}-${pad(d)}`);
  }
  return cells;
}

function monthTitle(month) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

export default function MonthGrid({ month, bookings, loading, selectedDate, onSelect, onPrev, onNext, canPrev, canNext, now }) {
  const cells = monthDays(month);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-navy-900" aria-live="polite">
          {monthTitle(month)}
        </h3>
        <div className="flex gap-2">
          <NavButton onClick={onPrev} disabled={!canPrev} label="Previous month" path="M12.5 15 7.5 10l5-5" />
          <NavButton onClick={onNext} disabled={!canNext} label="Next month" path="m7.5 15 5-5-5-5" />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1.5 sm:gap-2" role="group" aria-label={`Days in ${monthTitle(month)}`} aria-busy={loading}>
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="pb-1 text-center text-xs font-semibold uppercase tracking-wide text-navy-500" aria-hidden="true">
            {d}
          </div>
        ))}
        {cells.map((date, i) =>
          date ? (
            <DayCell
              key={date}
              date={date}
              bookings={bookings}
              loading={loading}
              selected={date === selectedDate}
              onSelect={onSelect}
              now={now}
            />
          ) : (
            <div key={`blank-${i}`} aria-hidden="true" />
          )
        )}
      </div>
    </div>
  );
}

function DayCell({ date, bookings, loading, selected, onSelect, now }) {
  const closed = dateStatus(date, now);
  const open = closed || loading ? 0 : availableStartTimes(date, MIN_DURATION_MINUTES, bookings, now).length;
  const disabled = Boolean(closed) || loading || open === 0;
  const day = Number(date.slice(8));

  let status = `${open} open ${open === 1 ? 'time' : 'times'}`;
  if (closed) status = 'not bookable';
  else if (loading) status = 'loading';
  else if (open === 0) status = 'fully booked';

  const tone = selected
    ? 'bg-brand-600 text-white shadow-md'
    : disabled
      ? 'cursor-not-allowed bg-navy-50/60 text-navy-300'
      : 'bg-white text-navy-900 ring-1 ring-navy-200 hover:ring-brand-500 hover:bg-brand-50';

  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${formatDate(date)} — ${status}`}
      className={`flex h-14 flex-col items-center justify-center rounded-xl text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:h-16 ${tone}`}
    >
      <span>{day}</span>
      {!closed && !loading && (
        <span className={`mt-0.5 text-[10px] font-medium ${selected ? 'text-brand-100' : open ? 'text-emerald-700' : 'text-navy-500'}`} aria-hidden="true">
          {open ? 'Open' : 'Full'}
        </span>
      )}
    </button>
  );
}

function NavButton({ onClick, disabled, label, path }) {
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
