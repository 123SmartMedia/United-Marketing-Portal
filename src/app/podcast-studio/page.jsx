import BookingCalendar from '@/components/booking/BookingCalendar';
import { getTurnstileClientConfig } from '@/lib/turnstileClientConfig';
import { MAX_DAYS_AHEAD, MAX_DURATION_MINUTES, formatDuration } from '@/lib/booking/rules';
import { MAX_ATTENDEES } from '@/lib/booking/schema';

// Rendered per request so the Turnstile site key is read at runtime
// (see src/app/custom-requests/page.jsx for why).
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Podcast Studio',
  description: 'Reserve the United Mortgage corporate podcast room.',
};

const DETAILS = [
  ['Hours', 'Monday – Friday, 8:00 AM – 6:00 PM ET'],
  ['Length', `30 minutes to ${formatDuration(MAX_DURATION_MINUTES)}`],
  ['Capacity', `Up to ${MAX_ATTENDEES} people`],
  ['Book ahead', `Up to ${MAX_DAYS_AHEAD} days`],
];

const TIPS = [
  'Bookings confirm instantly. Your confirmation email has a calendar invite and a cancel link.',
  'Can’t make it? Cancel from that email so a teammate can use the room.',
  'Build in setup and wrap-up time when you choose a length.',
  'Leave the room ready for the next person.',
];

export default function PodcastStudioPage() {
  const turnstile = getTurnstileClientConfig();

  return (
    <div>
      <section className="bg-gradient-to-br from-navy-900 to-brand-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-200">United Studio</p>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Book the podcast room</h1>
          <p className="mt-4 max-w-2xl text-navy-100">
            Reserve the corporate podcast room for your next episode, interview, or video. Pick a day,
            choose a time, and you’re confirmed.
          </p>
          <dl className="mt-8 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
            {DETAILS.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white/10 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-brand-200">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" aria-labelledby="calendar-heading">
        <h2 id="calendar-heading" className="sr-only">
          Availability calendar
        </h2>
        <BookingCalendar turnstileSiteKey={turnstile.siteKey} turnstileAction={turnstile.action} />
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-navy-50/70 p-6 sm:p-8">
          <h2 className="text-lg font-bold text-navy-900">Good to know</h2>
          <ul className="mt-4 grid gap-3 text-sm text-navy-700 sm:grid-cols-2">
            {TIPS.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
