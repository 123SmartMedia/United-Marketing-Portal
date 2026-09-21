import RequestWizard from '@/components/RequestWizard';
import { SITE } from '@/lib/catalog';

// Customer-facing Jira portal link. Not a secret — it is the same URL a loan
// officer would be sent in a Jira notification. Read server-side so the value
// stays configurable per environment without a NEXT_PUBLIC_ variable.
const PORTAL_URL =
  (process.env.JIRA_PORTAL_URL || '').trim() ||
  'https://unitedmortgage.atlassian.net/servicedesk/customer/portal/68';

// Cloudflare Turnstile. The SITE key is public by design — it identifies the
// widget. The secret key stays server-side and is never referenced here.
const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
// The action name the widget declares; the server requires the same value.
// TURNSTILE_ACTION is the older name, kept as a fallback.
const TURNSTILE_ACTION =
  (process.env.TURNSTILE_EXPECTED_ACTION || process.env.TURNSTILE_ACTION || 'marketing_request').trim();

export const metadata = {
  title: 'Custom Requests',
  description: 'Request custom or cobranded marketing materials from the United Mortgage marketing desk.',
};

export default function CustomRequestsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="grid gap-12 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h1 className="text-3xl font-bold text-navy-900 sm:text-4xl">Custom requests</h1>
          <p className="mt-4 text-navy-500">
            Need something that isn't in the library, or a piece customized to your branding? Send it
            to the marketing desk and we'll take care of it.
          </p>

          <dl className="mt-8 space-y-4 text-sm">
            <div>
              <dt className="font-semibold text-navy-700">Email</dt>
              <dd>
                <a href={`mailto:${SITE.requestEmail}`} className="text-brand-600 hover:text-brand-700">
                  {SITE.requestEmail}
                </a>
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-navy-700">Phone</dt>
              <dd>
                <a href={`tel:${SITE.phone.replace(/[^0-9]/g, '')}`} className="text-brand-600 hover:text-brand-700">
                  {SITE.phone}
                </a>
              </dd>
            </div>
          </dl>

          <div className="mt-8 rounded-2xl bg-navy-50 p-5 text-sm text-navy-600">
            <p className="font-semibold text-navy-800">Common requests</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Personalized business cards & letterhead</li>
              <li>Cobranded flyers with a real-estate partner</li>
              <li>Printed banners, yard signs, door hangers</li>
              <li>A new asset or program not yet in the library</li>
            </ul>
          </div>

          <p className="mt-6 text-sm">
            <a
              href={PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Open Marketing Requests Portal &rarr;
            </a>
            <span className="mt-1 block text-xs text-navy-400">
              Track the status of requests you&rsquo;ve already submitted.
            </span>
          </p>
        </div>

        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
            <RequestWizard
              defaultType="Custom / Other"
              portalUrl={PORTAL_URL}
              turnstileSiteKey={TURNSTILE_SITE_KEY}
              turnstileAction={TURNSTILE_ACTION}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
