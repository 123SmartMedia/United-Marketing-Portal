'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import Logo from './Logo';
import SearchOverlay from './SearchOverlay';

const PRIMARY_NAV = [
  { href: '/category/program-flyers', label: 'Flyers' },
  { href: '/category/program-videos', label: 'Videos' },
  { href: '/category/social-media', label: 'Social' },
  { href: '/category/business-cards-stationery', label: 'Business Cards' },
  { href: '/browse', label: 'Browse All' },
];

export default function Header({ categories }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

          <nav className="ml-4 hidden items-center gap-6 lg:flex">
            {PRIMARY_NAV.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-navy-700 transition hover:text-brand-500"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-full border border-navy-200 px-3 py-2 text-sm text-navy-500 transition hover:border-brand-400 hover:text-brand-600"
              aria-label="Search the marketing catalog"
            >
              <SearchIcon />
              <span className="hidden sm:inline">Search assets</span>
              <kbd className="hidden rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-medium text-navy-400 md:inline">
                ⌘K
              </kbd>
            </button>

            <Link
              href="/custom-requests"
              className="hidden rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 sm:inline-block"
            >
              Custom Request
            </Link>

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="rounded-md p-2 text-navy-700 lg:hidden"
              aria-label="Toggle menu"
            >
              <MenuIcon />
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-navy-100 bg-white lg:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2 sm:px-6">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/category/${c.slug}`}
                  onClick={() => setMobileOpen(false)}
                  className="border-b border-navy-50 py-3 text-sm font-medium text-navy-700"
                >
                  {c.title}
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
