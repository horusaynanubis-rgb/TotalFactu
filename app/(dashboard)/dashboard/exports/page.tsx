'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Download, FileText, Mail, CheckCircle, CalendarClock, SlidersHorizontal, FileStack } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { getCurrentFiscalQuarter, formatFiscalDate, FiscalQuarter } from '@/lib/fiscal-calendar';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

const FISCAL_BANNER_STYLES: Record<'open' | 'upcoming' | 'closed', string> = {
  open: 'bg-green-50 border-green-200 text-green-800',
  upcoming: 'bg-blue-50 border-blue-200 text-blue-800',
  closed: 'bg-gray-50 border-gray-200 text-gray-700',
};

export default function ExportsPage() {
  const [exports, setExports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customYear, setCustomYear] = useState<number>(new Date().getFullYear());
  const [customQuarter, setCustomQuarter] = useState<FiscalQuarter>(1);
  const { t } = useTranslation();

  // Computed once per page load — the "last completed quarter" doesn't
  // change within a session, and mirrors the same rule the quick quarterly
  // export uses server-side.
  const fiscalQuarter = useMemo(() => getCurrentFiscalQuarter(), []);
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i);
  }, []);

  // Aviso: documentación fiscal complementaria cargada para el trimestre en curso.
  // Info-only — never mixed into facturas.csv or the Export/A3 flow.
  const [fiscalDocsCount, setFiscalDocsCount] = useState<number | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({
      year: String(fiscalQuarter.year),
      period: `Q${fiscalQuarter.quarter}`,
      limit: '1',
    });
    fetch(`/api/fiscal-documents?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setFiscalDocsCount(data.total ?? 0); })
      .catch(() => {});
  }, [fiscalQuarter.year, fiscalQuarter.quarter]);

  const fetchExports = async () => {
    try {
      const response = await fetch('/api/exports');
      const data = await response.json();
      setExports(data?.exports ?? []);
    } catch (error: any) {
      toast.error(t.exports.fetchFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExports();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (
    exportType: 'monthly' | 'quarterly',
    customPeriod?: { year: number; quarter: FiscalQuarter },
  ) => {
    setGenerating(true);
    try {
      const response = await fetch('/api/exports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exportType, ...customPeriod }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || t.exports.generateFailed);
      }

      toast.success(t.exports.generateSuccess);
      fetchExports();
      if (customPeriod) setCustomOpen(false);
    } catch (error: any) {
      toast.error(error?.message || t.exports.generateFailed);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCustom = () =>
    handleGenerate('quarterly', { year: customYear, quarter: customQuarter });

  const handleDownload = async (exportId: string) => {
    try {
      const response = await fetch(`/api/exports/${exportId}/download`);
      const { downloadUrl } = await response.json();
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.click();
      
      toast.success(t.exports.downloadStarted);
    } catch (error: any) {
      toast.error(t.exports.downloadFailed);
    }
  };

  const typeLabels: Record<string, string> = {
    monthly: t.exports.monthlyExport,
    quarterly: t.exports.quarterlyExport,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.exports.title}</h1>
        <p className="text-gray-600 mt-1">{t.exports.subtitle}</p>
      </div>

      {/* Fiscal deadline banner */}
      <div className={`rounded-lg border p-4 flex items-start gap-3 ${FISCAL_BANNER_STYLES[fiscalQuarter.status]}`}>
        <CalendarClock className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">{t.exports.nextFilingTitle}</p>
          <p className="mt-0.5">
            {t.exports.modelo303} · {fiscalQuarter.quarter}º Trimestre {fiscalQuarter.year}
          </p>
          <p className="mt-1">
            {t.exports.periodLabel}: {formatFiscalDate(fiscalQuarter.period_start)} → {formatFiscalDate(fiscalQuarter.period_end)}
          </p>
          <p>
            {t.exports.filingUntilLabel}: {formatFiscalDate(fiscalQuarter.declaration_end)}
          </p>
          <p className="mt-1 font-medium">
            {fiscalQuarter.status === 'open' && t.exports.filingStatusOpen}
            {fiscalQuarter.status === 'closed' && t.exports.filingStatusClosed}
            {fiscalQuarter.status === 'upcoming' && t.exports.filingStatusUpcoming}
          </p>
        </div>
      </div>

      {/* Aviso: documentación fiscal complementaria del periodo */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-blue-800">
          <FileStack className="h-4 w-4 shrink-0" />
          <span>
            Documentación fiscal complementaria del periodo:{' '}
            <strong>{fiscalDocsCount ?? '…'}</strong> documento(s) este trimestre.
          </span>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href="/dashboard/fiscal-documents">Ver documentación fiscal</Link>
        </Button>
      </div>

      {/* Generate Section */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              {t.exports.monthlyExport}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              {t.exports.monthlyDescription}
            </p>
            <Button
              onClick={() => handleGenerate('monthly')}
              disabled={generating}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              {t.exports.generateMonthlyCSV}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              {t.exports.quarterlyExport}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              {t.exports.quarterlyDescription}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => handleGenerate('quarterly')}
                disabled={generating}
                className="w-full"
              >
                <Download className="mr-2 h-4 w-4" />
                {t.exports.generateQuarterlyCSV}
              </Button>
              <Button
                variant="outline"
                onClick={() => setCustomOpen(true)}
                disabled={generating}
                className="w-full"
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                {t.exports.customExport}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Custom period export modal */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.exports.customExportTitle}</DialogTitle>
            <DialogDescription>{t.exports.customExportDescription}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t.exports.yearLabel}</Label>
              <Select
                value={String(customYear)}
                onValueChange={(v) => setCustomYear(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t.exports.quarterLabel}</Label>
              <Select
                value={String(customQuarter)}
                onValueChange={(v) => setCustomQuarter(Number(v) as FiscalQuarter)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((q) => (
                    <SelectItem key={q} value={String(q)}>
                      Q{q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)} disabled={generating}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleGenerateCustom} disabled={generating}>
              <Download className="mr-2 h-4 w-4" />
              {t.exports.generateCustomCSV}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export History */}
      <Card>
        <CardHeader>
          <CardTitle>{t.exports.exportHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : exports && exports.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.exportDate}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.type}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.period}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.records}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.emailStatus}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((exp: any) => (
                    <tr key={exp?.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm">{formatDate(exp?.created_at)}</td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                          {typeLabels[exp?.export_type] || exp?.export_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {formatDate(exp?.period_start)} - {formatDate(exp?.period_end)}
                      </td>
                      <td className="py-3 px-4 text-sm">{exp?.record_count}</td>
                      <td className="py-3 px-4">
                        {exp?.email_sent ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <Mail className="h-5 w-5 text-gray-400" />
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(exp?.id)}
                        >
                          <Download className="mr-1 h-4 w-4" />
                          {t.common.download}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">{t.exports.noExports}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
