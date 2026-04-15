'use client';

import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'react-hot-toast';
import { LanguageProvider } from '@/lib/i18n/context';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LanguageProvider>
        {children}
        <Toaster position="top-right" />
      </LanguageProvider>
    </SessionProvider>
  );
}
