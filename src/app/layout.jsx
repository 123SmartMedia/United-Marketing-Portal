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
        <Header categories={categories} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
