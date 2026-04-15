import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'https://totalfactu.com'),
  title: 'TotalFactu - Your Telegram Invoice Assistant for SMEs',
  description: 'Send your invoices via Telegram. AI processes them automatically. No ERP needed, no learning curve. Just send and forget.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'TotalFactu - Your Telegram Invoice Assistant for SMEs',
    description: 'Send your invoices via Telegram. AI processes them automatically. No ERP needed, no learning curve. Just send and forget.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
