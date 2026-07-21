import Link from 'next/link';
import RequestForm from '@/components/RequestForm';
import { getCardCategories } from '@/lib/catalog';

export const metadata = {
  title: 'Get Started',
  description: 'New to United Mortgage? Get set up with your marketing essentials.',
};

const STEPS = [
  {
    title: 'Order your business cards',
    body: 'Choose from four card styles — Headshot, No Photo, Profile, or Shield — plus matching letterhead.',
    href: '/category/business-cards-stationery',
    cta: 'Business Cards & Stationery',
  },
  {
    title: 'Grab your program flyers',
    body: 'Download generic or cobranded flyers for every loan program to start sharing right away.',
    href: '/category/program-flyers',
    cta: 'Program Flyers',
  },
  {
    title: 'Set up your social content',
    body: 'Program posts, testimonials, and holiday graphics ready to post to your channels.',
    href: '/category/social-media',
    cta: 'Social Media',
  },
];

export default function GetStartedPage() {
  const categories = getCardCategories();
  return (
    <div>
      <section className="bg-gradient-to-br from-navy-900 to-brand-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold sm:text-4xl">Get started with United Mortgage</h1>
          <p className="mt-4 max-w-2xl text-navy-100">
            Everything a new loan officer needs to start marketing on day one. Follow the steps
            below, or request a personalized setup from the marketing desk.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col rounded-2xl border border-navy-100 p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-navy-900">{step.title}</h3>
              <p className="mt-2 flex-1 text-sm text-navy-500">{step.body}</p>
              <Link
                href={step.href}
                className="mt-4 text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                {step.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy-50/60 py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-xl font-bold text-navy-900">Explore every category</h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="rounded-full border border-navy-200 bg-white px-4 py-2 text-sm font-medium text-navy-600 transition hover:border-brand-400 hover:text-brand-600"
              >
                {c.title}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-bold text-navy-900">Request a personalized setup</h2>
          <p className="mt-2 text-sm text-navy-500">
            Tell us who you are and what you need — the marketing desk will get you set up.
          </p>
          <div className="mt-6">
            <RequestForm defaultType="Business Cards" />
          </div>
        </div>
      </section>
    </div>
  );
}
