import Link from 'next/link';
import Logo from './Logo';
import { SITE, getCategories } from '@/lib/catalog';

const QUICK_LINKS = [
  { href: '/podcast-studio', label: 'Podcast room calendar' },
  { href: '/total-expert', label: 'Total Expert sign-up' },
  { href: '/whats-new', label: 'What’s new' },
  { href: '/my-kit', label: 'My kit' },
];

export default function Footer() {
  const categories = getCategories();
  return (
    <footer className="mt-24 bg-navy-900 text-navy-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-5 lg:px-8">
        <div className="lg:col-span-1">
          <Logo variant="white" />
          <p className="mt-4 max-w-xs text-sm text-navy-300">
            The United Mortgage marketing hub — flyers, videos, social content, and
            print collateral for our loan officers.
          </p>
        </div>

        <div className="lg:col-span-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-navy-400">
            Categories
          </h3>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/category/${c.slug}`} className="text-navy-200 transition hover:text-white">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <nav aria-labelledby="footer-quick-links">
          <h3 id="footer-quick-links" className="text-xs font-semibold uppercase tracking-wider text-navy-300">
            Quick links
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-navy-200 transition hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-navy-400">
            Marketing Desk
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <a href={`mailto:${SITE.requestEmail}`} className="text-navy-200 hover:text-white">
                {SITE.requestEmail}
              </a>
            </li>
            <li>
              <a href={`mailto:${SITE.email}`} className="text-navy-200 hover:text-white">
                {SITE.email}
              </a>
            </li>
            <li>
              <a href={`tel:${SITE.phone.replace(/[^0-9]/g, '')}`} className="text-navy-200 hover:text-white">
                {SITE.phone}
              </a>
            </li>
            <li className="pt-2">
              <Link href="/custom-requests" className="font-semibold text-brand-300 hover:text-brand-200">
                Submit a custom request →
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-navy-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-navy-400 sm:flex-row sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} United Mortgage Corp. For internal loan-officer use.</p>
          <p>{SITE.domain}</p>
        </div>
      </div>
    </footer>
  );
}
