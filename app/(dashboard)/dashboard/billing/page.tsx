'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, CheckCircle, Building2, Users, Package, Zap } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

const GESTORIA_PACKS = [
  {
    size: 10,
    price: 89,
    label: 'Pack Básico',
    description: 'Ideal para gestorías pequeñas',
    features: ['10 licencias de cliente', 'Portal de gestión incluido', 'Invitaciones por enlace', 'Soporte prioritario'],
  },
  {
    size: 20,
    price: 159,
    label: 'Pack Profesional',
    description: 'Para gestorías en crecimiento',
    features: ['20 licencias de cliente', 'Portal de gestión incluido', 'Invitaciones por enlace', 'Soporte prioritario', 'Ahorro vs. Pack Básico'],
    popular: true,
  },
  {
    size: 50,
    price: 349,
    label: 'Pack Business',
    description: 'Para grandes despachos',
    features: ['50 licencias de cliente', 'Portal de gestión incluido', 'Invitaciones por enlace', 'Gestor de cuenta dedicado', 'Mayor ahorro por licencia'],
  },
];

const PLAN_PRICES: Record<string, number> = {
  demo: 0,
  profesional: 14.99,
};
const PLAN_NAMES: Record<string, string> = {
  demo: 'Demo',
  profesional: 'Profesional',
  gestoria: 'Gestoría',
};

export default function BillingPage() {
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [purchasingPack, setPurchasingPack] = useState<number | null>(null);
  const { t } = useTranslation();
  const { data: session } = useSession();
  const isGestoria = (session?.user as any)?.companyType === 'gestoria';

  useEffect(() => {
    fetchSubscription();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSubscription = async () => {
    try {
      const response = await fetch('/api/subscription');
      const data = await response.json();
      setSubscription(data?.subscription);
    } catch (error: any) {
      toast.error(t.billing.fetchFailed);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
      </div>
    );
  }

  const currentPlanKey = (subscription?.plan_name || 'demo') as keyof typeof PLAN_PRICES;
  const currentPlanFeatures = t.planFeatures[currentPlanKey as keyof typeof t.planFeatures] || t.planFeatures.demo;
  // Only show "Available Plans" section when there's an upgrade path (demo → profesional).
  // Profesional users have no higher plan, so we hide the section to avoid showing Demo as a "downgrade" option.
  const showAvailablePlans = !isGestoria && currentPlanKey === 'demo';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.billing.title}</h1>
        <p className="text-gray-600 mt-1">{t.billing.subtitle}</p>
      </div>

      {/* Estado actual — gestoría */}
      {isGestoria ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center">
                <Building2 className="h-5 w-5 mr-2" />
                Plan Gestoría
              </span>
              <Badge variant="secondary">Gestoría activa</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">Packs de licencias</p>
            <p className="text-sm text-muted-foreground mt-1">
              Gestiona tus clientes comprando packs de licencias. Cada licencia se asigna a un cliente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Current Subscription — usuarios finales */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center">
                  <CreditCard className="h-5 w-5 mr-2" />
                  {t.billing.currentPlanTitle}
                </span>
                <Badge variant={subscription?.status === 'active' ? 'success' : 'warning'}>
                  {subscription?.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-2xl font-bold mb-2">{PLAN_NAMES[currentPlanKey] || 'Demo'}</h3>
                  <p className="text-3xl font-bold text-primary">
                    {currentPlanKey === 'demo'
                      ? 'Gratis'
                      : `${formatCurrency(PLAN_PRICES[currentPlanKey] ?? 0, 'EUR')}`}
                    {currentPlanKey === 'profesional' && (
                      <span className="text-lg font-normal text-gray-600">{t.common.perMonth}</span>
                    )}
                  </p>
                </div>
                {currentPlanKey === 'demo' && (
                  <a href="/signup?plan=profesional">
                    <Button size="sm">
                      <Zap className="h-4 w-4 mr-1.5" /> Pasar a Profesional — €14,99/mes
                    </Button>
                  </a>
                )}
              </div>
              <div className="mt-6">
                <p className="text-sm font-medium text-gray-700 mb-3">{t.billing.planFeatures}</p>
                <ul className="space-y-2">
                  {currentPlanFeatures.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-gray-600">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Upgrade a Profesional — solo si el plan actual es Demo */}
          {showAvailablePlans && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">{t.billing.availablePlans}</h2>
              <div className="max-w-sm">
                <Card className="border-2 border-primary shadow-md">
                  <CardHeader>
                    <CardTitle className="text-center">
                      {PLAN_NAMES.profesional}
                    </CardTitle>
                    <div className="text-center mt-4">
                      <span className="text-3xl font-bold">€{PLAN_PRICES.profesional}</span>
                      <span className="text-gray-600">{t.common.perMonth}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 mb-6">
                      {t.planFeatures.profesional.map((feature: string, idx: number) => (
                        <li key={idx} className="flex items-start">
                          <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-gray-600">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full"
                      onClick={async () => {
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
                            toast.error(data.error || t.billing.stripeKeysRequired);
                          }
                        } catch {
                          toast.error(t.billing.stripeKeysRequired);
                        }
                      }}
                    >
                      <Zap className="h-4 w-4 mr-1.5" /> {t.common.upgrade}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {/* Packs Gestoría — solo para cuentas gestoria */}
      {isGestoria && <div id="gestoria-packs">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">Packs para Gestorías</h2>
            <p className="text-sm text-gray-500">Compra licencias en bloque y asígnalas a tus clientes</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-4">
          {GESTORIA_PACKS.map((pack) => (
            <Card key={pack.size} className={`border-2 relative ${pack.popular ? 'border-primary' : ''}`}>
              {pack.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-white px-3">Más popular</Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-lg">{pack.label}</CardTitle>
                <CardDescription>{pack.description}</CardDescription>
                <div className="mt-3">
                  <span className="text-3xl font-bold">€{pack.price}</span>
                  <span className="text-gray-500 text-sm">/mes</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {(pack.price / pack.size).toFixed(0)}€ por licencia/mes
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 mb-5">
                  {pack.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-gray-600">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={pack.popular ? 'default' : 'outline'}
                  disabled={!!purchasingPack}
                  onClick={async () => {
                    setPurchasingPack(pack.size);
                    try {
                      const res = await fetch('/api/stripe/checkout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'gestoria_pack', pack_size: pack.size }),
                      });
                      const data = await res.json();
                      if (!res.ok || !data.url) {
                        toast.error(data.error || 'Error al iniciar el pago');
                        return;
                      }
                      window.location.href = data.url;
                    } catch {
                      toast.error('Error inesperado');
                    } finally {
                      setPurchasingPack(null);
                    }
                  }}
                >
                  {purchasingPack === pack.size ? (
                    <span className="flex items-center gap-2">
                      <Package className="h-4 w-4 animate-pulse" /> Procesando...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> Comprar pack
                    </span>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>}


    </div>
  );
}
