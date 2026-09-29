'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import SearchOverlay from './SearchOverlay';
import { useFavorites } from './useFavorites';

const PRIMARY_NAV = [
  { href: '/category/program-flyers', label: 'Flyers' },
  { href: '/category/program-videos', label: 'Videos' },
  { href: '/category/social-media', label: 'Social' },
  { href: '/category/business-cards-stationery', label: 'Business Cards' },
  { href: '/browse', label: 'Browse All' },
  { href: '/podcast-studio', label: 'Podcast Room' },
  { href: '/total-expert', label: 'Total Expert' },
];

// Shown at the bottom of the mobile menu, after the category list.
const MOBILE_EXTRAS = [
  { href: '/browse', label: 'Browse all assets' },
  { href: '/whats-new', label: 'What’s new' },
  { href: '/my-kit', label: 'My kit (saved pieces)' },
  { href: '/podcast-studio', label: 'Book the podcast room' },
  { href: '/total-expert', label: 'Total Expert sign-up' },
];

const isActive = (pathname, href) => pathname === href || pathname.startsWith(`${href}/`);

export default function Header({ categories }) {
  const pathname = usePathname() || '/';
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Navigating anywhere closes the mobile menu.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Cmd/Ctrl-K opens search.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-navy-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="shrink-0 py-2" aria-label="United Marketing Desk home">
            <Logo />
          </Link>

          <nav className="ml-4 hidden items-center gap-6 xl:flex" aria-label="Main">
            {PRIMARY_NAV.map((link) => {
              const current = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={current ? 'page' : undefined}
                  className={`border-b-2 py-1 text-sm font-medium transition hover:text-brand-600 ${
                    current ? 'border-brand-600 text-brand-700' : 'border-transparent text-navy-700'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-full border border-navy-200 px-3 py-2 text-sm text-navy-500 transition hover:border-brand-400 hover:text-brand-600"
              aria-label="Search the marketing catalog"
            >
              <SearchIcon />
              <span className="hidden sm:inline">Search assets</span>
              <kbd aria-hidden="true" className="hidden rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-medium text-navy-600 md:inline">
                ⌘K
              </kbd>
            </button>

            <MyKitLink current={isActive(pathname, '/my-kit')} />

            <Link
              href="/custom-requests"
              className="hidden rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 sm:inline-block"
            >
              Custom Request
            </Link>

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="rounded-md p-2 text-navy-700 xl:hidden"
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
            >
              <MenuIcon />
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div id="mobile-menu" className="border-t border-navy-100 bg-white xl:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2 sm:px-6" aria-label="Mobile">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setSearchOpen(true);
                }}
                className="flex items-center gap-2 border-b border-navy-50 py-3 text-left text-sm font-semibold text-navy-800"
              >
                <SearchIcon /> Search assets
              </button>
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/category/${c.slug}`}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(pathname, `/category/${c.slug}`) ? 'page' : undefined}
                  className="border-b border-navy-50 py-3 text-sm font-medium text-navy-700 aria-[current=page]:font-semibold aria-[current=page]:text-brand-700"
                >
                  {c.title}
                </Link>
              ))}
              {MOBILE_EXTRAS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(pathname, link.href) ? 'page' : undefined}
                  className="border-b border-navy-50 py-3 text-sm font-medium text-navy-700 aria-[current=page]:font-semibold aria-[current=page]:text-brand-700"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/custom-requests"
                onClick={() => setMobileOpen(false)}
                className="py-3 text-sm font-semibold text-brand-600"
              >
                Custom Request →
              </Link>
            </nav>
          </div>
        )}
      </header>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

/** Heart link to My kit, with a count of saved pieces on this device. */
function MyKitLink({ current }) {
  const { favorites } = useFavorites();
  const count = favorites.length;
  return (
    <Link
      href="/my-kit"
      aria-label={count ? `My kit, ${count} saved` : 'My kit'}
      aria-current={current ? 'page' : undefined}
      className="relative flex h-10 w-10 items-center justify-center rounded-full border border-navy-200 text-navy-600 transition hover:border-brand-400 hover:text-brand-600"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 20.5s-7.5-4.6-9.3-9.3C1.5 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.5 4.5 6.7-1.8 4.7-9.3 9.3-9.3 9.3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m14 14 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
