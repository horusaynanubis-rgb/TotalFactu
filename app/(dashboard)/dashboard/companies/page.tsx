'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, LogIn } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

interface CompanyRow {
  id: string;
  name: string;
  tax_id: string;
  company_type: string;
  is_beta: boolean;
  plan_name: string | null;
  status: string | null;
  role: string;
  updated_at: string;
  is_active: boolean;
}

export default function CompaniesPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/company/list')
      .then((r) => r.json())
      .then((data) => setCompanies(data?.companies ?? []))
      .catch(() => toast.error(t.companies.switchFailed))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnter = async (companyId: string) => {
    setSwitchingId(companyId);
    try {
      const response = await fetch('/api/company/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || t.companies.switchFailed);
      }

      toast.success(t.companies.switchSuccess);
      // Hard navigation: forces the server layout to re-read the session
      // (and therefore the freshly-set active-company cookie) from scratch.
      window.location.href = '/dashboard';
    } catch (error: any) {
      toast.error(error?.message || t.companies.switchFailed);
      setSwitchingId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.companies.title}</h1>
        <p className="text-gray-600 mt-1">{t.companies.subtitle}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Building2 className="h-5 w-5 mr-2" />
            {t.companies.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : companies.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.companies.company}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.companies.taxId}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.companies.type}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.status}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.companies.role}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.companies.lastActivity}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {c.name}
                          {c.is_active && (
                            <Badge variant="success">{t.companies.active}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{c.tax_id}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {c.company_type === 'gestoria' ? t.companies.typeGestoria : t.companies.typeIndividual}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={c.is_beta ? 'info' : 'secondary'}>
                          {c.is_beta ? 'Beta' : (c.plan_name ?? c.status ?? '—')}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600 capitalize">{c.role}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{formatDate(c.updated_at)}</td>
                      <td className="py-3 px-4">
                        <Button
                          size="sm"
                          variant={c.is_active ? 'outline' : 'default'}
                          disabled={c.is_active || switchingId === c.id}
                          onClick={() => handleEnter(c.id)}
                        >
                          <LogIn className="mr-1 h-4 w-4" />
                          {switchingId === c.id ? t.companies.switching : t.companies.enter}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">{t.common.noResults}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
