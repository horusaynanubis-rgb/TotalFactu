'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Download, FileText, Mail, CheckCircle, CalendarClock, SlidersHorizontal, FileStack,
  Calculator, Landmark, Wallet, Loader2, Package, History, AlertCircle,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { getCurrentFiscalQuarter, formatFiscalDate, FiscalQuarter } from '@/lib/fiscal-calendar';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

const FISCAL_BANNER_STYLES: Record<'open' | 'upcoming' | 'closed', string> = {
  open: 'bg-green-50 border-green-200 text-green-800',
  upcoming: 'bg-blue-50 border-blue-200 text-blue-800',
  closed: 'bg-gray-50 border-gray-200 text-gray-700',
};

type FiscalExportMode = 'csv' | 'fiscal' | 'complete';

interface BatchInfo {
  batchIndex: number;
  fromItem: number;
  toItem: number;
  documentCount: number;
  estimatedSizeMB: number;
  token: string;
}

interface FiscalExportPlan {
  mode: FiscalExportMode;
  year: number;
  quarter: number | 'annual';
  periodLabel: string;
  totalDocuments: number;
  batchCount: number;
  batches: BatchInfo[];
}

interface ExportLogRow {
  id: string;
  export_type: string;
  format: string;
  period_label: string;
  record_count: number;
  status: string;
  created_at: string;
  user: { name: string | null; email: string } | null;
}

const EXPORT_TYPE_LABELS: Record<string, string> = {
  monthly_csv: 'CSV mensual',
  quarterly_csv: 'CSV trimestral',
  custom_csv: 'CSV personalizado',
  fiscal_summary: 'Resumen fiscal',
  detalle_iva: 'Detalle de IVA',
  caja_csv: 'Caja / TPV',
  control_tpv: 'Control TPV vs facturación',
  fiscal_documents_zip: 'Documentación fiscal (ZIP)',
  paquete_trimestral: 'Paquete trimestral',
};

function downloadFile(url: string, fallbackName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  a.click();
}

async function downloadBlobFrom(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Error ${res.status}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  downloadFile(objectUrl, fallbackName);
  URL.revokeObjectURL(objectUrl);
}

export default function ExportsPage() {
  const { t } = useTranslation();

  // ── CSV history (existing Export model) ──────────────────────────────────
  const [exports, setExports] = useState<any[]>([]);
  const [loadingExports, setLoadingExports] = useState(true);

  // ── Unified action history (new ExportLog) ────────────────────────────────
  const [logs, setLogs] = useState<ExportLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  const fiscalQuarter = useMemo(() => getCurrentFiscalQuarter(), []);
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => current - i);
  }, []);

  const refreshHistory = () => {
    setLoadingExports(true);
    fetch('/api/exports')
      .then((r) => r.json())
      .then((data) => setExports(data?.exports ?? []))
      .catch(() => toast.error(t.exports.fetchFailed))
      .finally(() => setLoadingExports(false));

    setLoadingLogs(true);
    fetch('/api/exports/history')
      .then((r) => r.json())
      .then((data) => setLogs(data?.logs ?? []))
      .catch(() => {})
      .finally(() => setLoadingLogs(false));
  };

  useEffect(() => {
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Aviso: documentación fiscal complementaria del periodo ────────────────
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

  // ── Aviso: clasificación fiscal (IVA) del periodo — solo lectura; el botón
  // de reprocesar vive en el panel de gestoría, no aquí ────────────────────
  const [fiscalClassification, setFiscalClassification] = useState<{
    classified: number; pendingClassification: number; mixedVat: number; manualReview: number; total: number;
  } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({ year: String(fiscalQuarter.year), quarter: String(fiscalQuarter.quarter) });
    fetch(`/api/fiscal-summary/classification-status?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setFiscalClassification(data); })
      .catch(() => {});
  }, [fiscalQuarter.year, fiscalQuarter.quarter]);

  // ── Contabilidad: monthly / quarterly / custom invoice CSV (existing) ────
  const [contabilidadOpen, setContabilidadOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customYear, setCustomYear] = useState<number>(new Date().getFullYear());
  const [customQuarter, setCustomQuarter] = useState<FiscalQuarter>(1);

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
      refreshHistory();
      if (customPeriod) setCustomOpen(false);
    } catch (error: any) {
      toast.error(error?.message || t.exports.generateFailed);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCustom = () => handleGenerate('quarterly', { year: customYear, quarter: customQuarter });

  const handleDownloadCsvExport = async (exportId: string) => {
    try {
      const response = await fetch(`/api/exports/${exportId}/download`);
      const { downloadUrl } = await response.json();
      downloadFile(downloadUrl, 'export.csv');
      toast.success(t.exports.downloadStarted);
    } catch {
      toast.error(t.exports.downloadFailed);
    }
  };

  // ── Fiscal: resumen fiscal trimestral (standalone) ────────────────────────
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [fiscalYear, setFiscalYear] = useState<number>(fiscalQuarter.year);
  const [fiscalQuarterSel, setFiscalQuarterSel] = useState<number>(fiscalQuarter.quarter);
  const [downloadingFiscalSummary, setDownloadingFiscalSummary] = useState(false);
  const [downloadingIvaDetalle, setDownloadingIvaDetalle] = useState(false);

  const handleDownloadFiscalSummary = async () => {
    setDownloadingFiscalSummary(true);
    try {
      const url = `/api/fiscal-summary/csv?year=${fiscalYear}&quarter=${fiscalQuarterSel}`;
      await downloadBlobFrom(url, `resumen_fiscal_Q${fiscalQuarterSel}_${fiscalYear}.csv`);
      toast.success('Resumen fiscal descargado');
      refreshHistory();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo generar el resumen fiscal');
    } finally {
      setDownloadingFiscalSummary(false);
    }
  };

  const handleDownloadIvaDetalle = async () => {
    setDownloadingIvaDetalle(true);
    try {
      const url = `/api/fiscal-summary/detalle-iva?year=${fiscalYear}&quarter=${fiscalQuarterSel}`;
      await downloadBlobFrom(url, `detalle_iva_Q${fiscalQuarterSel}_${fiscalYear}.csv`);
      toast.success('Detalle de IVA descargado');
      refreshHistory();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo generar el detalle de IVA');
    } finally {
      setDownloadingIvaDetalle(false);
    }
  };

  // ── Caja y TPV ─────────────────────────────────────────────────────────────
  const [cajaOpen, setCajaOpen] = useState(false);
  const [cajaScope, setCajaScope] = useState<'daily' | 'monthly' | 'quarterly'>('monthly');
  const [cajaYear, setCajaYear] = useState<number>(new Date().getFullYear());
  const [cajaMonth, setCajaMonth] = useState<number>(new Date().getMonth() + 1);
  const [cajaQuarter, setCajaQuarter] = useState<number>(fiscalQuarter.quarter);
  const [downloadingCaja, setDownloadingCaja] = useState(false);
  const [controlYear, setControlYear] = useState<number>(fiscalQuarter.year);
  const [controlQuarter, setControlQuarter] = useState<number>(fiscalQuarter.quarter);
  const [downloadingControl, setDownloadingControl] = useState(false);

  const handleDownloadCaja = async () => {
    setDownloadingCaja(true);
    try {
      const params = new URLSearchParams({ scope: cajaScope, year: String(cajaYear) });
      if (cajaScope !== 'quarterly') params.set('month', String(cajaMonth));
      else params.set('quarter', String(cajaQuarter));
      await downloadBlobFrom(`/api/caja-cobros/export?${params}`, `caja_${cajaScope}.csv`);
      toast.success('Caja/TPV descargado');
      refreshHistory();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo generar el export de caja');
    } finally {
      setDownloadingCaja(false);
    }
  };

  const handleDownloadControlTpv = async () => {
    setDownloadingControl(true);
    try {
      const url = `/api/caja-cobros/control-tpv?year=${controlYear}&quarter=${controlQuarter}`;
      await downloadBlobFrom(url, `control_tpv_Q${controlQuarter}_${controlYear}.csv`);
      toast.success('Control TPV vs facturación descargado');
      refreshHistory();
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo generar el informe');
    } finally {
      setDownloadingControl(false);
    }
  };

  // ── Documentación fiscal ZIP + Paquete trimestral (shared plan/zip flow) ──
  const [docOpen, setDocOpen] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [planYear, setPlanYear] = useState<number>(fiscalQuarter.year);
  const [planQuarter, setPlanQuarter] = useState<number | 'annual'>(fiscalQuarter.quarter);
  const [plan, setPlan] = useState<FiscalExportPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [downloadingBatch, setDownloadingBatch] = useState<number | null>(null);
  const [batchErrors, setBatchErrors] = useState<Record<number, string>>({});

  const preparePlan = async (mode: FiscalExportMode) => {
    setLoadingPlan(true);
    setPlan(null);
    setBatchErrors({});
    try {
      const res = await fetch('/api/fiscal-export/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: planYear, quarter: planQuarter, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'TOO_MANY_DOCUMENTS') {
          toast.error(`Demasiados documentos (${(data.totalDocuments as number).toLocaleString('es-ES')}). Reduce el periodo.`);
        } else {
          toast.error(data.error || 'Error al preparar la exportación');
        }
        return;
      }
      setPlan(data as FiscalExportPlan);
      refreshHistory();
    } catch {
      toast.error('Error al preparar la exportación');
    } finally {
      setLoadingPlan(false);
    }
  };

  const downloadBatch = async (batch: BatchInfo) => {
    setDownloadingBatch(batch.batchIndex);
    setBatchErrors((prev) => { const next = { ...prev }; delete next[batch.batchIndex]; return next; });
    try {
      const url = `/api/fiscal-export/zip?token=${encodeURIComponent(batch.token)}`;
      const batchLabel = String(batch.batchIndex + 1).padStart(3, '0');
      await downloadBlobFrom(url, `exportacion_lote${batchLabel}.zip`);
    } catch (err: any) {
      setBatchErrors((prev) => ({ ...prev, [batch.batchIndex]: err?.message ?? 'Error desconocido' }));
    } finally {
      setDownloadingBatch(null);
    }
  };

  const typeLabels: Record<string, string> = {
    monthly: t.exports.monthlyExport,
    quarterly: t.exports.quarterlyExport,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Centro de Exportación</h1>
        <p className="text-gray-600 mt-1">
          Descarga tus datos de contabilidad, fiscalidad, caja y documentación en un único lugar.
        </p>
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
          <p>{t.exports.filingUntilLabel}: {formatFiscalDate(fiscalQuarter.declaration_end)}</p>
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

      {/* Aviso: clasificación fiscal (IVA) del periodo — solo lectura */}
      {fiscalClassification && fiscalClassification.total > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-center gap-2 text-slate-800">
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span>
              Clasificación fiscal (Q{fiscalQuarter.quarter} {fiscalQuarter.year}):{' '}
              <strong>{fiscalClassification.classified}</strong> clasificadas ·{' '}
              <strong className={fiscalClassification.pendingClassification + fiscalClassification.mixedVat > 0 ? 'text-amber-600' : ''}>
                {fiscalClassification.pendingClassification + fiscalClassification.mixedVat}
              </strong> pendientes ·{' '}
              <strong className={fiscalClassification.manualReview > 0 ? 'text-red-600' : ''}>
                {fiscalClassification.manualReview}
              </strong> revisión manual.
            </span>
          </div>
        </div>
      )}

      {/* 4 category cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-5 w-5 text-primary" />Contabilidad</CardTitle>
            <CardDescription>CSV mensual, trimestral o personalizado de tus facturas.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button className="w-full" onClick={() => setContabilidadOpen(true)}>Ver opciones</Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-5 w-5 text-primary" />Fiscal</CardTitle>
            <CardDescription>Resumen fiscal trimestral: bases e IVA por tipo, informativo.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button className="w-full" onClick={() => setFiscalOpen(true)}>Ver opciones</Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-5 w-5 text-primary" />Caja y TPV</CardTitle>
            <CardDescription>Caja diaria/mensual/trimestral y control TPV vs facturación.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button className="w-full" onClick={() => setCajaOpen(true)}>Ver opciones</Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FileStack className="h-5 w-5 text-primary" />Documentación fiscal</CardTitle>
            <CardDescription>ZIP e índice de la documentación fiscal complementaria del periodo.</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button className="w-full" onClick={() => { setPlan(null); setDocOpen(true); }}>Ver opciones</Button>
          </CardContent>
        </Card>
      </div>

      {/* Paquete trimestral para gestoría — featured, not a 5th category */}
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Package className="h-5 w-5 text-primary" />Paquete trimestral para gestoría</CardTitle>
          <CardDescription>
            Un ZIP con resumen fiscal, facturas, caja/TPV, control TPV vs facturación y documentación fiscal —
            combina las exportaciones anteriores, no las duplica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => { setPlan(null); setPkgOpen(true); }}>
            <Package className="mr-2 h-4 w-4" />
            Generar paquete trimestral
          </Button>
        </CardContent>
      </Card>

      {/* ── Contabilidad dialog ─────────────────────────────────────────────── */}
      <Dialog open={contabilidadOpen} onOpenChange={setContabilidadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contabilidad</DialogTitle>
            <DialogDescription>CSV mensual, trimestral rápido o personalizado por año/trimestre.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button className="w-full" onClick={() => handleGenerate('monthly')} disabled={generating}>
              <Download className="mr-2 h-4 w-4" />{t.exports.generateMonthlyCSV}
            </Button>
            <Button className="w-full" onClick={() => handleGenerate('quarterly')} disabled={generating}>
              <Download className="mr-2 h-4 w-4" />{t.exports.generateQuarterlyCSV}
            </Button>
            <Button className="w-full" variant="outline" onClick={() => setCustomOpen(true)} disabled={generating}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />{t.exports.customExport}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom period export modal (nested) */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.exports.customExportTitle}</DialogTitle>
            <DialogDescription>{t.exports.customExportDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t.exports.yearLabel}</Label>
              <Select value={String(customYear)} onValueChange={(v) => setCustomYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t.exports.quarterLabel}</Label>
              <Select value={String(customQuarter)} onValueChange={(v) => setCustomQuarter(Number(v) as FiscalQuarter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)} disabled={generating}>{t.common.cancel}</Button>
            <Button onClick={handleGenerateCustom} disabled={generating}>
              <Download className="mr-2 h-4 w-4" />{t.exports.generateCustomCSV}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fiscal dialog ───────────────────────────────────────────────────── */}
      <Dialog open={fiscalOpen} onOpenChange={setFiscalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resumen fiscal trimestral</DialogTitle>
            <DialogDescription>
              Ingresos y compras por mes, bases e IVA por tipo (4%/10%/21%), gastos especiales.
              Documento informativo para revisión por la empresa o gestoría — no es la declaración oficial del Modelo 303.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Año</Label>
              <Select value={String(fiscalYear)} onValueChange={(v) => setFiscalYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Trimestre</Label>
              <Select value={String(fiscalQuarterSel)} onValueChange={(v) => setFiscalQuarterSel(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-col gap-2">
            <Button className="w-full" onClick={handleDownloadFiscalSummary} disabled={downloadingFiscalSummary}>
              {downloadingFiscalSummary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Descargar resumen fiscal
            </Button>
            <Button className="w-full" variant="outline" onClick={handleDownloadIvaDetalle} disabled={downloadingIvaDetalle}>
              {downloadingIvaDetalle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Descargar detalle de IVA por operación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Caja y TPV dialog ───────────────────────────────────────────────── */}
      <Dialog open={cajaOpen} onOpenChange={setCajaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Caja y TPV</DialogTitle>
            <DialogDescription>Caja diaria, mensual o trimestral (incluye desglose por método de cobro).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Ámbito</Label>
                <Select value={cajaScope} onValueChange={(v) => setCajaScope(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Diaria</SelectItem>
                    <SelectItem value="monthly">Mensual</SelectItem>
                    <SelectItem value="quarterly">Trimestral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Año</Label>
                <Select value={String(cajaYear)} onValueChange={(v) => setCajaYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {cajaScope !== 'quarterly' ? (
                <div className="space-y-1.5">
                  <Label>Mes</Label>
                  <Select value={String(cajaMonth)} onValueChange={(v) => setCajaMonth(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Trimestre</Label>
                  <Select value={String(cajaQuarter)} onValueChange={(v) => setCajaQuarter(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <Button className="w-full" onClick={handleDownloadCaja} disabled={downloadingCaja}>
              {downloadingCaja ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Descargar CSV de caja
            </Button>

            <div className="border-t pt-4 space-y-3">
              <div>
                <p className="text-sm font-medium">Control TPV vs facturación</p>
                <p className="text-xs text-muted-foreground">
                  Compara el total de Caja/TPV con el total facturado por periodo. Informe informativo — no corrige ni crea facturas.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select value={String(controlYear)} onValueChange={(v) => setControlYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={String(controlQuarter)} onValueChange={(v) => setControlQuarter(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button className="w-full" variant="outline" onClick={handleDownloadControlTpv} disabled={downloadingControl}>
                {downloadingControl ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Descargar control TPV vs facturación
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Documentación fiscal dialog (plan/zip, mode=fiscal) ───────────────── */}
      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Documentación fiscal</DialogTitle>
            <DialogDescription>
              ZIP con los archivos originales del periodo y un índice CSV. Filtra por año y trimestre.
            </DialogDescription>
          </DialogHeader>
          <PlanDialogBody
            planYear={planYear} setPlanYear={setPlanYear}
            planQuarter={planQuarter} setPlanQuarter={setPlanQuarter}
            yearOptions={yearOptions}
            plan={plan} loadingPlan={loadingPlan}
            downloadingBatch={downloadingBatch} batchErrors={batchErrors}
            onPrepare={() => preparePlan('fiscal')}
            onDownloadBatch={downloadBatch}
            generateLabel="Generar ZIP de documentación fiscal"
          />
          <p className="text-xs text-muted-foreground">
            También puedes gestionar y subir documentos desde{' '}
            <Link href="/dashboard/fiscal-documents" className="underline">Documentación fiscal</Link>.
          </p>
        </DialogContent>
      </Dialog>

      {/* ── Paquete trimestral dialog (plan/zip, mode=complete) ───────────────── */}
      <Dialog open={pkgOpen} onOpenChange={setPkgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Paquete trimestral para gestoría</DialogTitle>
            <DialogDescription>
              Genera uno o varios ZIP independientes con resumen fiscal, facturas, caja/TPV, control TPV vs
              facturación y documentación fiscal del periodo. Nunca hay que unir archivos.
            </DialogDescription>
          </DialogHeader>
          <PlanDialogBody
            planYear={planYear} setPlanYear={setPlanYear}
            planQuarter={planQuarter} setPlanQuarter={setPlanQuarter}
            yearOptions={yearOptions}
            plan={plan} loadingPlan={loadingPlan}
            downloadingBatch={downloadingBatch} batchErrors={batchErrors}
            onPrepare={() => preparePlan('complete')}
            onDownloadBatch={downloadBatch}
            generateLabel="Generar paquete trimestral"
          />
        </DialogContent>
      </Dialog>

      {/* CSV Export History (existing Export model) */}
      <Card>
        <CardHeader>
          <CardTitle>{t.exports.exportHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingExports ? (
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
                        {exp?.email_sent ? <CheckCircle className="h-5 w-5 text-green-500" /> : <Mail className="h-5 w-5 text-gray-400" />}
                      </td>
                      <td className="py-3 px-4">
                        <Button size="sm" variant="outline" onClick={() => handleDownloadCsvExport(exp?.id)}>
                          <Download className="mr-1 h-4 w-4" />{t.common.download}
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

      {/* Histórico de exportaciones (new, unified — ExportLog) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Histórico de exportaciones</CardTitle>
          <CardDescription>Todas las descargas generadas desde el Centro de Exportación.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : logs.length === 0 ? (
            <p className="text-center text-gray-500 py-8">Todavía no hay exportaciones registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Fecha</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Usuario</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Tipo</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Periodo</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Registros</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm">{formatDateTime(log.created_at)}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{log.user?.name ?? log.user?.email ?? '—'}</td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                          {EXPORT_TYPE_LABELS[log.export_type] ?? log.export_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{log.period_label}</td>
                      <td className="py-3 px-4 text-sm">{log.record_count}</td>
                      <td className="py-3 px-4">
                        {log.status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-500" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Shared body for "Documentación fiscal" and "Paquete trimestral" dialogs —
// both hit the same plan/zip batching flow with a different mode.
function PlanDialogBody({
  planYear, setPlanYear, planQuarter, setPlanQuarter, yearOptions,
  plan, loadingPlan, downloadingBatch, batchErrors, onPrepare, onDownloadBatch, generateLabel,
}: {
  planYear: number; setPlanYear: (y: number) => void;
  planQuarter: number | 'annual'; setPlanQuarter: (q: number | 'annual') => void;
  yearOptions: number[];
  plan: FiscalExportPlan | null; loadingPlan: boolean;
  downloadingBatch: number | null; batchErrors: Record<number, string>;
  onPrepare: () => void; onDownloadBatch: (batch: BatchInfo) => void;
  generateLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Año</Label>
          <Select value={String(planYear)} onValueChange={(v) => setPlanYear(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Periodo</Label>
          <Select value={String(planQuarter)} onValueChange={(v) => setPlanQuarter(v === 'annual' ? 'annual' : Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}
              <SelectItem value="annual">Año completo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button className="w-full" onClick={onPrepare} disabled={loadingPlan}>
        {loadingPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
        {generateLabel}
      </Button>

      {plan && (
        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-sm">
            <span className="font-medium">{plan.periodLabel}</span>
            {' · '}{plan.totalDocuments} documento(s) fiscal(es) encontrado(s)
            {plan.batchCount > 1 && ` · ${plan.batchCount} ZIP independientes`}
          </p>
          <div className="space-y-2">
            {plan.batches.map((batch) => {
              const isDownloading = downloadingBatch === batch.batchIndex;
              const err = batchErrors[batch.batchIndex];
              return (
                <div key={batch.batchIndex} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between rounded-md border p-2.5 gap-3">
                    <span className="text-sm">
                      ZIP {batch.batchIndex + 1}
                      {batch.documentCount > 0 && (
                        <span className="text-muted-foreground ml-2">{batch.documentCount} archivo(s) · ~{batch.estimatedSizeMB} MB</span>
                      )}
                    </span>
                    <Button
                      size="sm" variant="outline"
                      disabled={isDownloading || downloadingBatch !== null}
                      onClick={() => onDownloadBatch(batch)}
                    >
                      {isDownloading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                      Descargar
                    </Button>
                  </div>
                  {err && <p className="text-xs text-destructive px-1">{err}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
