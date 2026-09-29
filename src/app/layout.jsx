import { Inter } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { getCategories, SITE } from '@/lib/catalog';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  metadataBase: new URL('https://marketing.unitedmortgage.com'),
  title: {
    default: 'United Marketing Desk — United Mortgage',
    template: '%s · United Marketing Desk',
  },
  description:
    'The United Mortgage marketing hub. Download flyers, videos, social media content, and print collateral for every loan program.',
  robots: {
    // Quasi-internal hub for loan officers — keep it out of search indexes.
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'United Marketing Desk',
    description: 'Marketing assets for United Mortgage loan officers.',
    siteName: 'United Marketing Desk',
    type: 'website',
  },
};

export default function RootLayout({ children }) {
  const categories = getCategories();
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-navy-900 focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to main content
        </a>
        <Header categories={categories} />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
