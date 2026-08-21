'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface OverviewCharts {
  charts: {
    newCompaniesByMonth: { month: string; count: number }[];
    documentsInvoicesByMonth: { month: string; documents: number; invoices: number }[];
  };
}

interface ReportResponse {
  period: { year: number; month: number; label: string };
  isCurrentMonth: boolean;
  flow: {
    newCompanies: number;
    cancellations: number;
    documentsProcessed: number;
    invoicesProcessed: number;
    exportsPerformed: number;
  };
  snapshot: { activeCompanies: number; payingCustomers: number; betaCompanies: number } | null;
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

export function ReportsClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [overview, setOverview] = useState<OverviewCharts | null>(null);

  useEffect(() => {
    fetch('/api/admin/overview').then((r) => r.json()).then(setOverview).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/admin/reports?year=${year}&month=${month}`)
      .then((r) => r.json())
      .then(setReport)
      .catch(() => {});
  }, [year, month]);

  const years = useMemo(() => {
    const currentYear = now.getUTCFullYear();
    return [currentYear, currentYear - 1, currentYear - 2];
  }, [now]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base capitalize">{report?.period.label ?? 'Cargando...'}</CardTitle>
            <div className="flex gap-2">
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {report && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatBlock label="Nuevas empresas" value={report.flow.newCompanies} />
                <StatBlock label="Cancelaciones" value={report.flow.cancellations} />
                <StatBlock label="Documentos procesados" value={report.flow.documentsProcessed} />
                <StatBlock label="Facturas procesadas" value={report.flow.invoicesProcessed} />
                <StatBlock label="Exportaciones realizadas" value={report.flow.exportsPerformed} />
              </div>
              {report.snapshot ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 pt-6 border-t">
                  <StatBlock label="Clientes activos (ahora)" value={report.snapshot.activeCompanies} />
                  <StatBlock label="Clientes de pago (ahora)" value={report.snapshot.payingCustomers} />
                  <StatBlock label="Clientes beta (ahora)" value={report.snapshot.betaCompanies} />
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-6 pt-6 border-t">
                  Los recuentos de clientes activos/pago/beta solo se muestran para el mes en curso — no existe un
                  histórico de cambios de estado de suscripción para reconstruirlos en meses pasados.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {overview && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nuevas empresas por mes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview.charts.newCompaniesByMonth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Nuevas empresas" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos y facturas procesados por mes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview.charts.documentsInvoicesByMonth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="documents" name="Documentos" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="invoices" name="Facturas" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
