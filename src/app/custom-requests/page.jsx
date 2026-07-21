import RequestForm from '@/components/RequestForm';
import { SITE } from '@/lib/catalog';

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
        </div>

        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
            <RequestForm defaultType="Custom / Other" />
          </div>
        </div>
      </div>
    </div>
  );
}
