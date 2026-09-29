'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import MonthGrid from './MonthGrid';
import WeekAvailability, { mondayOf } from './WeekAvailability';
import DaySchedule from './DaySchedule';
import BookingForm from './BookingForm';
import BookingSuccess from './BookingSuccess';
import { roomNow, addDays, monthKey, validateSlot, MAX_DAYS_AHEAD, MIN_DURATION_MINUTES } from '@/lib/booking/rules';

/**
 * Podcast room availability + booking.
 *
 * Two public views of the same data: "Week" (every half hour, Free/Booked —
 * the at-a-glance answer to "is the room free at 2pm Thursday?") and "Month"
 * (which days have openings). Either leads to the day schedule and booking
 * form. Availability is fetched per month (times only — the API never reveals
 * who booked) and re-fetched after a booking or a conflict.
 *
 * Works on dynamic pages (Turnstile config passed as props) and on static ones
 * like the homepage (config fetched from /api/turnstile-config when omitted).
 */

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function useTurnstileConfig(siteKey, action) {
  const provided = siteKey !== undefined;
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (provided) return undefined;
    let cancelled = false;
    fetch('/api/turnstile-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((cfg) => !cancelled && setFetched({ siteKey: cfg.siteKey || '', action: cfg.action || '' }))
      .catch(() => !cancelled && setFetched({ siteKey: '', action: '' }));
    return () => {
      cancelled = true;
    };
  }, [provided]);
  if (provided) return { siteKey, action };
  return fetched || { siteKey: null, action: '' }; // null = still loading
}

export default function BookingCalendar({ turnstileSiteKey, turnstileAction }) {
  const turnstile = useTurnstileConfig(turnstileSiteKey, turnstileAction);
  const [now, setNow] = useState(() => new Date());
  const today = roomNow(now).date;
  const lastDay = addDays(today, MAX_DAYS_AHEAD);
  const firstMonth = monthKey(today);
  const lastMonth = monthKey(lastDay);
  const firstWeek = mondayOf(today);
  const lastWeek = mondayOf(lastDay);

  const [view, setView] = useState('month');
  const [month, setMonth] = useState(firstMonth);
  const [weekStart, setWeekStart] = useState(firstWeek);
  const [slotsByMonth, setSlotsByMonth] = useState({});
  const [loadError, setLoadError] = useState('');
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState(60);
  const [chosenStart, setStart] = useState('');
  const [booked, setBooked] = useState(null); // { booking, confirmationSent }
  const detailsRef = useRef(null);
  const panelRef = useRef(null);

  const loadMonth = useCallback(async (m) => {
    try {
      const res = await fetch(`/api/podcast-room/bookings?month=${m}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.message || 'load_failed');
      setLoadError('');
      setSlotsByMonth((prev) => ({ ...prev, [m]: json.slots }));
    } catch (err) {
      setLoadError(err.message && err.message !== 'load_failed' ? err.message : 'We couldn’t load the calendar. Please refresh to try again.');
      setSlotsByMonth((prev) => ({ ...prev, [m]: prev[m] || [] }));
    }
  }, []);

  // Months the current view needs: the shown month, or both months a week spans.
  const neededMonths = useMemo(
    () => (view === 'week' ? [...new Set([monthKey(weekStart), monthKey(addDays(weekStart, 4))])] : [month]),
    [view, weekStart, month]
  );

  useEffect(() => {
    neededMonths.filter((m) => !slotsByMonth[m]).forEach(loadMonth);
  }, [neededMonths, slotsByMonth, loadMonth]);

  const bookings = useMemo(() => Object.values(slotsByMonth).flat(), [slotsByMonth]);
  const loading = neededMonths.some((m) => !slotsByMonth[m]);
  const dayLoading = date ? !slotsByMonth[monthKey(date)] : false;

  // A chosen start time can become invalid when the length changes or new
  // bookings arrive; treat it as unselected rather than submit something the
  // server would reject.
  const start =
    chosenStart && date && validateSlot({ date, start: chosenStart, durationMinutes: duration }, bookings, now).ok
      ? chosenStart
      : '';

  function selectDate(d) {
    setDate(d);
    setStart('');
    setBooked(null);
  }

  function pickFromWeek(d, time) {
    setDate(d);
    setBooked(null);
    // Keep the chosen length if it fits here; otherwise fall back to 30 minutes.
    if (!validateSlot({ date: d, start: time, durationMinutes: duration }, bookings, now).ok) {
      setDuration(MIN_DURATION_MINUTES);
    }
    setStart(time);
    requestAnimationFrame(() => (detailsRef.current || panelRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function selectStart(t) {
    setStart(t);
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function refresh() {
    setNow(new Date());
    setSlotsByMonth({});
  }

  function handleBooked(booking, { confirmationSent }) {
    setBooked({ booking, confirmationSent });
    setStart('');
    refresh();
  }

  const slot = start ? validateSlot({ date, start, durationMinutes: duration }, [], now).slot : null;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
        <ViewToggle view={view} onChange={setView} />
        {loadError && (
          <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </p>
        )}
        {view === 'week' ? (
          <WeekAvailability
            weekStart={weekStart}
            bookings={bookings}
            loading={loading}
            now={now}
            onPick={pickFromWeek}
            onPrev={() => setWeekStart((w) => addDays(w, -7))}
            onNext={() => setWeekStart((w) => addDays(w, 7))}
            canPrev={weekStart > firstWeek}
            canNext={weekStart < lastWeek}
          />
        ) : (
          <MonthGrid
            month={month}
            bookings={bookings}
            loading={loading}
            selectedDate={date}
            onSelect={selectDate}
            onPrev={() => setMonth((m) => shiftMonth(m, -1))}
            onNext={() => setMonth((m) => shiftMonth(m, 1))}
            canPrev={month > firstMonth}
            canNext={month < lastMonth}
            now={now}
          />
        )}
        <p className="mt-4 text-xs text-navy-600">
          Anyone can view availability. Weekdays 8:00 AM – 6:00 PM ET · book up to {MAX_DAYS_AHEAD} days ahead with your United Mortgage email.
        </p>
      </div>

      <div ref={panelRef} className="scroll-mt-24 rounded-2xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
        {booked ? (
          <BookingSuccess
            booking={booked.booking}
            confirmationSent={booked.confirmationSent}
            onBookAnother={() => setBooked(null)}
          />
        ) : date && !dayLoading ? (
          <>
            <DaySchedule
              date={date}
              bookings={bookings}
              duration={duration}
              onDuration={setDuration}
              start={start}
              onStart={selectStart}
              now={now}
            />
            {slot && (
              <div ref={detailsRef} className="mt-8 scroll-mt-24 border-t border-navy-100 pt-6">
                <h3 className="mb-4 text-lg font-bold text-navy-900">Your details</h3>
                {turnstile.siteKey === null ? (
                  <p className="text-sm text-navy-600">Loading the booking form…</p>
                ) : (
                  <BookingForm
                    slot={slot}
                    turnstileSiteKey={turnstile.siteKey}
                    turnstileAction={turnstile.action}
                    onBooked={handleBooked}
                    onConflict={refresh}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <p className="text-base font-semibold text-navy-900">
              {view === 'week' ? 'Click a free time to book it' : 'Pick a day to see open times'}
            </p>
            <p className="mt-1 text-sm text-navy-600">
              {view === 'week'
                ? 'Green blocks are open. Dark blocks are already booked.'
                : 'Days marked “Open” have at least one free half hour.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }) {
  return (
    <div className="mb-5 inline-flex rounded-full bg-navy-50 p-1" role="group" aria-label="Calendar view">
      {[
        ['month', 'Month'],
        ['week', 'Week at a glance'],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
            view === value ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-600 hover:text-navy-900'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
