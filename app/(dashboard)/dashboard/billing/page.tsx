'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, CheckCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

const PLAN_KEYS = ['starter', 'professional', 'enterprise'] as const;
const PLAN_PRICES: Record<string, number> = {
  starter: 29,
  professional: 79,
  enterprise: 199,
};
const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export default function BillingPage() {
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

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

  const currentPlanKey = (subscription?.plan_name || 'starter') as keyof typeof PLAN_PRICES;
  const currentPlanFeatures = t.planFeatures[currentPlanKey as keyof typeof t.planFeatures] || t.planFeatures.starter;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.billing.title}</h1>
        <p className="text-gray-600 mt-1">{t.billing.subtitle}</p>
      </div>

      {/* Current Subscription */}
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
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold mb-2">{PLAN_NAMES[currentPlanKey] || 'Starter'}</h3>
              <p className="text-3xl font-bold text-primary">
                {formatCurrency(PLAN_PRICES[currentPlanKey] ?? 29, 'EUR')}
                <span className="text-lg font-normal text-gray-600">{t.common.perMonth}</span>
              </p>
            </div>
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

      {/* Available Plans */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4">{t.billing.availablePlans}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {PLAN_KEYS.map((key) => {
            const isCurrent = key === subscription?.plan_name;
            const features = t.planFeatures[key];
            return (
              <Card
                key={key}
                className={`border-2 ${isCurrent ? 'border-primary' : ''}`}
              >
                <CardHeader>
                  <CardTitle className="text-center">
                    {PLAN_NAMES[key]}
                    {isCurrent && (
                      <Badge variant="success" className="ml-2">
                        {t.common.current}
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="text-center mt-4">
                    <span className="text-3xl font-bold">€{PLAN_PRICES[key]}</span>
                    <span className="text-gray-600">{t.common.perMonth}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-6">
                    {features.map((feature: string, idx: number) => (
                      <li key={idx} className="flex items-start">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-gray-600">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isCurrent}
                    onClick={() => {
                      if (!isCurrent) {
                        toast.error(t.billing.stripeKeysRequired);
                      }
                    }}
                  >
                    {isCurrent ? t.common.currentPlan : t.common.upgrade}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Billing Notice */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> {t.billing.stripeNotice}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
