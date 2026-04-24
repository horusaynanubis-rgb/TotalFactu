'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Zap, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/context';
import toast from 'react-hot-toast';

export const DEMO_INVOICE_LIMIT = 5;

interface Props {
  invoiceCount: number;
  variant?: 'banner' | 'blocked';
}

export function DemoUpgradeBanner({ invoiceCount, variant = 'banner' }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const remaining = Math.max(0, DEMO_INVOICE_LIMIT - invoiceCount);
  const isBlocked = variant === 'blocked' || remaining === 0;

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'plan', plan: 'profesional' }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Error al iniciar el pago. Inténtalo de nuevo.');
        setLoading(false);
      }
    } catch {
      toast.error('Error inesperado. Inténtalo de nuevo.');
      setLoading(false);
    }
  };

  if (isBlocked) {
    return (
      <div className="rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-destructive text-sm">{t.landing.demoInvoiceLimit}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{t.landing.demoInvoiceLimitDesc}</p>
          </div>
        </div>
        <Button size="sm" onClick={handleUpgrade} disabled={loading} className="flex-shrink-0">
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
          {t.landing.demoInvoiceLimitButton}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-start gap-3 flex-1">
        <Zap className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-primary text-sm">{t.landing.demoUpgradeBannerTitle}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t.landing.demoUpgradeBannerDesc}{' '}
            <span className="font-medium text-foreground">
              ({invoiceCount}/{DEMO_INVOICE_LIMIT} facturas usadas)
            </span>
          </p>
        </div>
      </div>
      <Button size="sm" onClick={handleUpgrade} disabled={loading} className="flex-shrink-0">
        {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
        {t.landing.demoUpgradeBannerButton}
      </Button>
    </div>
  );
}
