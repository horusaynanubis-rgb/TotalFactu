'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

/**
 * Placed inside /dashboard to redirect gestoria accounts to /dashboard/gestoria
 * unless the user has explicitly chosen 'empresa' mode via the mode selector.
 */
export function GestoriaRedirectGuard() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    const isGestoria = (session?.user as any)?.companyType === 'gestoria';
    if (!isGestoria) return;

    const stored = localStorage.getItem('totalfactu_dashboard_mode');
    if (stored !== 'empresa') {
      router.replace('/dashboard/gestoria');
    }
  }, [status, session, router]);

  return null;
}
