import RequestWizard from '@/components/RequestWizard';
import { SITE } from '@/lib/catalog';
import { getTurnstileClientConfig } from '@/lib/turnstileClientConfig';

/**
 * Rendered per request, not at build time.
 *
 * Turnstile is configured from the environment at REQUEST time, so adding or
 * rotating the site key takes effect on the next request rather than on the next
 * build. Two things are required for that, and both matter:
 *
 *  1. This page must be dynamic. Left static, "read the environment" would mean
 *     "read it once during `next build`" — which is how production ended up
 *     serving an empty site key long after the key had been added in Vercel.
 *
 *  2. The variable must NOT be `NEXT_PUBLIC_*`. Next inlines those as literals
 *     during the build, in server code too, so a dynamic page would still serve
 *     the frozen build-time value. `TURNSTILE_SITE_KEY` stays a real runtime
 *     `process.env` lookup — see src/lib/turnstileClientConfig.js.
 *
 * The page is a form, not a content page, so nothing meaningful is lost by not
 * prerendering it.
 *
 * TURNSTILE_SECRET_KEY is never read here and never becomes a prop. Only
 * src/lib/turnstile.js touches it, server-side, when redeeming a token.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Custom Requests',
  description: 'Request custom or cobranded marketing materials from the United Mortgage marketing desk.',
};

export default function CustomRequestsPage() {
  // Read inside the component, not at module scope: module scope is evaluated
  // once per lambda cold start, the component body on every request.
  const portalUrl =
    (process.env.JIRA_PORTAL_URL || '').trim() ||
    'https://unitedmortgage.atlassian.net/servicedesk/customer/portal/68';
  const turnstile = getTurnstileClientConfig();

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
              href={portalUrl}
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
              portalUrl={portalUrl}
              turnstileSiteKey={turnstile.siteKey}
              turnstileAction={turnstile.action}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
