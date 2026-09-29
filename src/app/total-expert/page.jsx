import TotalExpertForm from '@/components/TotalExpertForm';
import { getTurnstileClientConfig } from '@/lib/turnstileClientConfig';

/**
 * Rendered per request so the Turnstile site key is read at runtime, not frozen
 * at build time — see src/app/custom-requests/page.jsx for the full reasoning.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Total Expert Sign-Up',
  description: 'Request a Total Expert account from the United Mortgage marketing desk.',
};

const NEXT_STEPS = [
  {
    title: 'Submit this form',
    body: 'Tell us who you are, your role, and whether you need a new, reactivated, or transferred account.',
  },
  {
    title: 'We set up your account',
    body: 'The marketing desk provisions your Total Expert access and connects you to the right team.',
  },
  {
    title: 'Check your inbox',
    body: 'You’ll get a welcome email from Total Expert with your login details.',
  },
];

export default function TotalExpertPage() {
  const turnstile = getTurnstileClientConfig();

  return (
    <div>
      <section className="bg-gradient-to-br from-navy-900 to-brand-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold sm:text-4xl">Sign up for Total Expert</h1>
          <p className="mt-4 max-w-2xl text-navy-100">
            Total Expert is the CRM and marketing automation platform United Mortgage loan officers use
            to stay in touch with clients and referral partners. Request your account below and the
            marketing desk will get you set up.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <h2 className="text-xl font-bold text-navy-900">What happens next</h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {NEXT_STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col rounded-2xl border border-navy-100 p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-navy-900">{step.title}</h3>
              <p className="mt-2 text-sm text-navy-500">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-bold text-navy-900">Request your account</h2>
          <p className="mt-2 text-sm text-navy-500">
            Use your United Mortgage work email. Fields marked <span className="text-brand-500">*</span> are required.
          </p>
          <div className="mt-6">
            <TotalExpertForm turnstileSiteKey={turnstile.siteKey} turnstileAction={turnstile.action} />
          </div>
        </div>
      </section>
    </div>
  );
}
