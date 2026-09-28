'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, AlertTriangle, PlusCircle } from 'lucide-react';

// Portal status UX for the NEW MODEL (plan section 5/25) — reads the single
// canonical getGestoriaEligibility() result via GET /api/gestoria/eligibility.
// Renders nothing for LEGACY firms (never show new-model messaging to a
// pack-based gestoria) and nothing while loading/on error, so it never
// blocks or breaks the rest of the dashboard.

interface EligibilityResponse {
  state: 'LEGACY' | 'INITIAL' | 'ELIGIBLE' | 'GRACE' | 'LIMITED';
  isLegacy: boolean;
  eligibleCompanies: number;
  requiredCompanies: number;
  isEligible: boolean;
  initialPeriod: { startedAt: string; endsAt: string; isActive: boolean } | null;
  grace: { lossDetectedAt: string; endsAt: string; daysRemaining: number } | null;
  accessLevel: 'FULL' | 'LIMITED';
}

interface Props {
  onAddCompany: () => void;
}

export function GestoriaEligibilityBanner({ onAddCompany }: Props) {
  const [data, setData] = useState<EligibilityResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/gestoria/eligibility')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !data || data.isLegacy) return null;

  const { state, eligibleCompanies, requiredCompanies } = data;
  const missing = Math.max(0, requiredCompanies - eligibleCompanies);

  const daysLeftInitial = data.initialPeriod
    ? Math.max(0, Math.ceil((new Date(data.initialPeriod.endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  if (state === 'INITIAL') {
    return (
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {eligibleCompanies} de {requiredCompanies} empresas activas
                {missing > 0 && ` · Te faltan ${missing} para mantener tu cuenta Gestoría gratis`}
              </p>
              <p className="text-xs text-muted-foreground">
                {daysLeftInitial !== null && `Acceso completo gratis — ${daysLeftInitial} días de prueba restantes`}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onAddCompany}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir empresa
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === 'ELIGIBLE') {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium">Tu cuenta Gestoría es gratuita</p>
            <p className="text-xs text-muted-foreground">{eligibleCompanies} empresas activas</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === 'GRACE') {
    return (
      <Card className="border-yellow-200 bg-yellow-50/50">
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">{eligibleCompanies} empresas activas</p>
              <p className="text-xs text-muted-foreground">
                Te quedan {data.grace?.daysRemaining ?? 0} días para volver a {requiredCompanies} y mantener el
                acceso completo.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onAddCompany}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir empresa
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === 'LIMITED') {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                Necesitas {requiredCompanies} empresas activas para recuperar el acceso completo
              </p>
              <p className="text-xs text-muted-foreground">
                Tienes {eligibleCompanies}. Tus datos e histórico siguen disponibles mientras tanto.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onAddCompany}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir empresa
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
