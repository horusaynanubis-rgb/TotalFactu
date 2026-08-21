'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Users, TrendingUp, CreditCard, Sparkles, AlertTriangle, FileText, Receipt, Copy, Check } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface Overview {
  kpis: {
    totalCompanies: number;
    activeCompanies: number;
    newThisMonth: number;
    payingCustomers: number;
    betaCount: number;
    incidentSubscriptions: number;
    documentsThisMonth: number;
    invoicesThisMonth: number;
  };
  charts: {
    distribution: { bucket: string; count: number }[];
  };
}

interface CompanyRow {
  id: string;
  name: string;
  taxId: string;
  companyType: string;
  bucket: string;
  createdAt: string;
  planName: string | null;
  isBeta: boolean;
  status: string;
  userCount: number;
  documentCount: number;
  invoiceCount: number;
  lastActivity: string | null;
}

const STATUS_BADGE: Record<string, 'success' | 'info' | 'warning' | 'destructive' | 'secondary'> = {
  Activa: 'success',
  Beta: 'info',
  'Pago pendiente': 'warning',
  Cancelada: 'destructive',
  Inactiva: 'secondary',
  Interna: 'secondary',
  'Sin suscripción': 'secondary',
};

const BUCKET_LABEL: Record<string, string> = {
  pago: 'Pago',
  beta: 'Beta',
  gestoria: 'Gestoría',
  grupo: 'Grupo empresarial',
};

const PIE_COLORS = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981'];

const FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'activas', label: 'Activas' },
  { value: 'beta', label: 'Beta' },
  { value: 'pago_pendiente', label: 'Pago pendiente' },
  { value: 'sin_pago', label: 'Sin pago' },
  { value: 'canceladas', label: 'Canceladas' },
  { value: 'gestorias', label: 'Gestorías' },
  { value: 'empresas', label: 'Empresas' },
  { value: 'grupos', label: 'Grupos empresariales' },
  { value: 'internas', label: 'Internas' },
];

function KpiCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-gray-500 mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyCompanyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-gray-400 hover:text-gray-700"
      title="Copiar companyId"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function AdminControlDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  useEffect(() => {
    fetch('/api/admin/overview')
      .then((r) => r.json())
      .then(setOverview)
      .catch(() => {});
  }, []);

  const loadCompanies = useCallback(() => {
    setLoadingCompanies(true);
    const params = new URLSearchParams({ page: String(page), filter });
    if (query) params.set('q', query);
    fetch(`/api/admin/companies?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data?.companies ?? []);
        setTotal(data?.total ?? 0);
        setPageSize(data?.pageSize ?? 50);
      })
      .catch(() => {})
      .finally(() => setLoadingCompanies(false));
  }, [page, filter, query]);

  useEffect(() => {
    const debounce = setTimeout(loadCompanies, 250);
    return () => clearTimeout(debounce);
  }, [loadCompanies]);

  useEffect(() => {
    setPage(1);
  }, [query, filter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      {overview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard icon={Building2} label="Empresas totales" value={overview.kpis.totalCompanies} />
            <KpiCard icon={TrendingUp} label="Empresas activas" value={overview.kpis.activeCompanies} />
            <KpiCard icon={Sparkles} label="Nuevas altas este mes" value={overview.kpis.newThisMonth} />
            <KpiCard icon={CreditCard} label="Clientes de pago" value={overview.kpis.payingCustomers} />
            <KpiCard icon={Users} label="Beta" value={overview.kpis.betaCount} />
            <KpiCard icon={AlertTriangle} label="Suscripciones con incidencia" value={overview.kpis.incidentSubscriptions} />
            <KpiCard icon={Receipt} label="Facturas procesadas (mes)" value={overview.kpis.invoicesThisMonth} />
            <KpiCard icon={FileText} label="Documentos procesados (mes)" value={overview.kpis.documentsThisMonth} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distribución de clientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={overview.charts.distribution.map((d) => ({ ...d, label: BUCKET_LABEL[d.bucket] ?? d.bucket }))}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {overview.charts.distribution.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Empresas ({total})
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Buscar por empresa, CIF, email o usuario..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="sm:w-72"
              />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingCompanies ? (
            <p className="text-center text-gray-500 py-8">Cargando...</p>
          ) : companies.length === 0 ? (
            <p className="text-center text-gray-500 py-8">Sin resultados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Empresa</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">CIF/NIF</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Tipo</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Alta</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Plan</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Estado</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Usuarios</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Docs</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Facturas</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-700">Últ. actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-3">
                        <Link href={`/dashboard/admin/companies/${c.id}`} className="font-medium text-primary hover:underline">
                          {c.name}
                        </Link>
                        <span className="ml-1.5 inline-flex align-middle">
                          <CopyCompanyId id={c.id} />
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{c.taxId}</td>
                      <td className="py-2 px-3 text-gray-600">{BUCKET_LABEL[c.bucket] ?? (c.companyType === 'gestoria' ? 'Gestoría' : 'Empresa')}</td>
                      <td className="py-2 px-3 text-gray-600">{formatDate(c.createdAt)}</td>
                      <td className="py-2 px-3 text-gray-600">{c.planName ?? '—'}</td>
                      <td className="py-2 px-3">
                        <Badge variant={STATUS_BADGE[c.status] ?? 'secondary'}>{c.status}</Badge>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{c.userCount}</td>
                      <td className="py-2 px-3 text-gray-600">{c.documentCount}</td>
                      <td className="py-2 px-3 text-gray-600">{c.invoiceCount}</td>
                      <td className="py-2 px-3 text-gray-600">{c.lastActivity ? formatDate(c.lastActivity) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-500">
                Página {page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
