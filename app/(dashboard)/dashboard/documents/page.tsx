'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { DocumentTimeline } from '@/components/document-timeline';
import { getUnifiedStatus } from '@/lib/unified-status';
import {
  Upload, FileText, RotateCw, Trash2, X, Eye, Search, Download, History,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';
import { DocumentPreviewModal } from '@/components/document-preview-modal';

const PAGE_SIZE = 50;

const STATUS_CHIPS = [
  { v: 'all',        l: 'Todos' },
  { v: 'processing', l: 'Procesando IA' },
  { v: 'pending',    l: 'Pendiente revisión' },
  { v: 'reviewed',   l: 'Revisada' },
  { v: 'waiting',    l: 'Esperando cliente' },
  { v: 'done',       l: 'Finalizada' },
  { v: 'error',      l: 'Error' },
] as const;

const CHANNEL_CHIPS = [
  { v: 'all',      l: 'Todos' },
  { v: 'web',      l: 'Web' },
  { v: 'telegram', l: 'Telegram' },
  { v: 'email',    l: 'Email' },
] as const;

const PERIOD_CHIPS = [
  { v: 'all',           l: 'Todo' },
  { v: 'this_month',    l: 'Este mes' },
  { v: 'last_3_months', l: 'Últimos 3m' },
  { v: 'this_year',     l: 'Este año' },
  { v: 'custom',        l: 'Personalizado' },
] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const localStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [traceDocId, setTraceDocId] = useState<string | null>(null);

  // Filter state (React state for UI rendering)
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterChannel, setFilterChannel] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterQ, setFilterQ] = useState('');

  // Filter refs (stable reads inside fetch without stale closure issues)
  const statusRef = useRef('all');
  const channelRef = useRef('all');
  const periodRef = useRef('all');
  const fromRef = useRef('');
  const toRef = useRef('');
  const qRef = useRef('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { t } = useTranslation();

  function doFetch(
    replace: boolean,
    overrides?: {
      status?: string; channel?: string; period?: string;
      from?: string; to?: string; q?: string;
    },
  ) {
    const status  = overrides?.status  ?? statusRef.current;
    const channel = overrides?.channel ?? channelRef.current;
    const period  = overrides?.period  ?? periodRef.current;
    const from    = overrides?.from    ?? fromRef.current;
    const to      = overrides?.to      ?? toRef.current;
    const q       = overrides?.q       ?? qRef.current;
    const offset  = replace ? 0 : documents.length;

    if (replace) setLoading(true);
    else {
      if (loadingMore) return;
      setLoadingMore(true);
    }

    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (status !== 'all')  params.set('status',  status);
    if (channel !== 'all') params.set('channel', channel);
    if (q.trim())          params.set('q', q.trim());

    const now = new Date();
    const todayStr = localStr(now);
    if (period === 'this_month') {
      params.set('from', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
      params.set('to', todayStr);
    } else if (period === 'last_3_months') {
      params.set('from', localStr(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())));
      params.set('to', todayStr);
    } else if (period === 'this_year') {
      params.set('from', `${now.getFullYear()}-01-01`);
      params.set('to', todayStr);
    } else if (period === 'custom') {
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
    }

    fetch(`/api/documents?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        const incoming = data?.documents ?? [];
        if (replace) setDocuments(incoming);
        else setDocuments((prev) => [...prev, ...incoming]);
        setHasMore(data?.hasMore ?? false);
      })
      .catch(() => toast.error(t.documents.fetchFailed))
      .finally(() => {
        if (replace) setLoading(false);
        else setLoadingMore(false);
      });
  }

  // Initial load once
  useEffect(() => {
    doFetch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSearchChange = (val: string) => {
    setFilterQ(val);
    qRef.current = val;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => doFetch(true, { q: val }), 300);
  };

  const handleStatusChange = (val: string) => {
    setFilterStatus(val);
    statusRef.current = val;
    doFetch(true, { status: val });
  };

  const handleChannelChange = (val: string) => {
    setFilterChannel(val);
    channelRef.current = val;
    doFetch(true, { channel: val });
  };

  const handlePeriodChange = (val: string) => {
    setFilterPeriod(val);
    periodRef.current = val;
    if (val !== 'custom') doFetch(true, { period: val });
  };

  const handleFromChange = (val: string) => {
    setFilterFrom(val);
    fromRef.current = val;
    setFilterPeriod('custom');
    periodRef.current = 'custom';
    doFetch(true, { period: 'custom', from: val, to: toRef.current });
  };

  const handleToChange = (val: string) => {
    setFilterTo(val);
    toRef.current = val;
    setFilterPeriod('custom');
    periodRef.current = 'custom';
    doFetch(true, { period: 'custom', from: fromRef.current, to: val });
  };

  const clearFilters = () => {
    setFilterStatus('all'); statusRef.current = 'all';
    setFilterChannel('all'); channelRef.current = 'all';
    setFilterPeriod('all'); periodRef.current = 'all';
    setFilterFrom(''); fromRef.current = '';
    setFilterTo(''); toRef.current = '';
    setFilterQ(''); qRef.current = '';
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    doFetch(true, { status: 'all', channel: 'all', period: 'all', from: '', to: '', q: '' });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      toast.error(t.documents.fileTooLarge);
      return;
    }

    setUploading(true);
    try {
      const presignedResponse = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, isPublic: false }),
      });
      const { uploadUrl, cloud_storage_path } = await presignedResponse.json();

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error(t.documents.uploadFailed);

      const completeResponse = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloud_storage_path, isPublic: false, fileName: file.name,
          mimeType: file.type, sourceChannel: 'web',
        }),
      });

      if (!completeResponse.ok) {
        const errorData = await completeResponse.json().catch(() => ({}));
        if (errorData.code === 'DEMO_LIMIT_REACHED') {
          const checkoutRes = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'plan', plan: 'profesional' }),
          });
          const checkoutData = await checkoutRes.json();
          if (checkoutData.url) {
            window.location.href = checkoutData.url;
          } else {
            toast.error('Has alcanzado el límite del plan Demo. Ve a Facturación para actualizar.');
          }
          return;
        }
        throw new Error(t.documents.uploadFailed);
      }

      toast.success(t.documents.uploadSuccess);
      doFetch(true);
      if (e?.target) e.target.value = '';
    } catch (error: any) {
      toast.error(`${t.documents.uploadFailed}: ${error?.message ?? ''}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRetry = async (docId: string) => {
    setRetryingId(docId);
    try {
      const response = await fetch(`/api/documents/${docId}/process`, { method: 'POST' });
      if (response.ok) {
        toast.success(t.documents.retrySuccess);
      } else {
        const data = await response.json();
        toast.error(`${t.documents.retryFailed}: ${data?.message || ''}`);
      }
      doFetch(true);
    } catch {
      toast.error(t.documents.retryFailed);
    } finally {
      setRetryingId(null);
    }
  };

  const handleDownload = async (docId: string, filename: string) => {
    setDownloadingId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/preview`);
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? 'documento';
      a.click();
    } catch {
      toast.error('No se pudo descargar el documento');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDeleteId) return;
    const docId = confirmDeleteId;
    setConfirmDeleteId(null);
    setDeletingId(docId);
    try {
      const response = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.message ?? t.documents.deleteFailed);
      }
      toast.success(t.documents.deleteSuccess);
      doFetch(true);
    } catch (error: any) {
      toast.error(error?.message ?? t.documents.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  };

  const hasActiveFilters =
    filterStatus !== 'all' || filterChannel !== 'all' ||
    filterPeriod !== 'all' || filterQ !== '';

  const traceDoc = traceDocId ? documents.find((d) => d.id === traceDocId) : null;

  // ── Chip helper ────────────────────────────────────────────────────────────

  function Chip({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
      <button
        onClick={onClick}
        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
          active
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background text-muted-foreground border-border hover:border-primary/50'
        }`}
      >
        {children}
      </button>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.documents.title}</h1>
          <p className="text-gray-600 mt-1">{t.documents.subtitle}</p>
        </div>
        <label className="cursor-pointer">
          <Button disabled={uploading} asChild>
            <span>
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? t.documents.uploading : t.documents.uploadInvoice}
            </span>
          </Button>
          <Input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5 space-y-3">

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por archivo, proveedor, nº factura…"
              value={filterQ}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-9"
            />
            {filterQ && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-1">
            {STATUS_CHIPS.map(({ v, l }) => (
              <Chip key={v} active={filterStatus === v} onClick={() => handleStatusChange(v)}>
                {l}
              </Chip>
            ))}
          </div>

          {/* Channel + Period chips */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {CHANNEL_CHIPS.map(({ v, l }) => (
                <Chip key={v} active={filterChannel === v} onClick={() => handleChannelChange(v)}>
                  {l}
                </Chip>
              ))}
            </div>
            <span className="h-5 w-px bg-border" />
            <div className="flex gap-1 flex-wrap">
              {PERIOD_CHIPS.map(({ v, l }) => (
                <Chip key={v} active={filterPeriod === v} onClick={() => handlePeriodChange(v)}>
                  {l}
                </Chip>
              ))}
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="h-3 w-3" />
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Custom date range */}
          {filterPeriod === 'custom' && (
            <div className="flex gap-3 items-center max-w-sm">
              <Input type="date" value={filterFrom} onChange={(e) => handleFromChange(e.target.value)} className="h-8 text-sm" />
              <span className="text-sm text-muted-foreground shrink-0">—</span>
              <Input type="date" value={filterTo} onChange={(e) => handleToChange(e.target.value)} className="h-8 text-sm" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documents table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t.documents.uploadedDocuments}</span>
            {!loading && (
              <span className="text-sm font-normal text-gray-500">
                {documents.length}{hasMore ? '+' : ''} documento{documents.length !== 1 ? 's' : ''}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : documents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.filename}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.channel}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.status}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.confidence}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Factura asociada</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.uploadDate}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc: any) => {
                    const unifiedStatus = getUnifiedStatus({
                      processingStatus: doc?.processing_status ?? 'processing',
                      reviewStatus: doc?.invoice?.review_status,
                      gestoriaStatus: doc?.invoice?.gestoria_review_status,
                    });
                    const canRetry =
                      doc?.processing_status === 'failed' ||
                      doc?.processing_status === 'needs_review';

                    return (
                      <tr key={doc?.id} className="border-b hover:bg-gray-50">
                        {/* Filename */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 max-w-xs">
                            <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                            <span className="text-sm truncate" title={doc?.original_filename}>
                              {doc?.original_filename}
                            </span>
                          </div>
                        </td>

                        {/* Channel */}
                        <td className="py-3 px-4">
                          <span className="text-sm capitalize text-gray-600">{doc?.source_channel}</span>
                        </td>

                        {/* Unified status */}
                        <td className="py-3 px-4">
                          <StatusBadge status={unifiedStatus} type="unified" />
                        </td>

                        {/* Confidence */}
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {doc?.confidence_score
                            ? `${(doc.confidence_score * 100).toFixed(0)}%`
                            : '—'}
                        </td>

                        {/* Associated invoice */}
                        <td className="py-3 px-4">
                          {doc?.invoice ? (
                            <div className="text-xs">
                              <p className="font-medium text-gray-800 truncate max-w-[160px]" title={doc.invoice.supplier_name}>
                                {doc.invoice.supplier_name}
                              </p>
                              <p className="text-gray-500">{doc.invoice.invoice_number}</p>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Upload date */}
                        <td className="py-3 px-4 text-sm text-gray-600 whitespace-nowrap">
                          {formatDateTime(doc?.upload_timestamp)}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            {/* Preview */}
                            <button
                              onClick={() => setPreviewDocId(doc.id)}
                              title={t.documents.previewDocument}
                              className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Ver
                            </button>

                            {/* Download */}
                            <button
                              onClick={() => handleDownload(doc.id, doc.original_filename)}
                              disabled={downloadingId === doc.id}
                              title="Descargar documento"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-40"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>

                            {/* Retry */}
                            {canRetry && (
                              <button
                                onClick={() => handleRetry(doc.id)}
                                disabled={retryingId === doc.id}
                                title={t.documents.retryProcessing}
                                className="inline-flex items-center gap-1 px-2 h-8 rounded-md text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-40"
                              >
                                <RotateCw className={`h-3.5 w-3.5 ${retryingId === doc.id ? 'animate-spin' : ''}`} />
                                {retryingId === doc.id ? t.documents.retrying : 'Reintentar'}
                              </button>
                            )}

                            {/* Trazabilidad */}
                            <button
                              onClick={() => setTraceDocId(doc.id)}
                              title="Ver trazabilidad"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-blue-500 hover:bg-blue-50 transition-colors"
                            >
                              <History className="h-3.5 w-3.5" />
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => setConfirmDeleteId(doc.id)}
                              disabled={deletingId === doc.id}
                              title={t.documents.deleteDocument}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-500">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {hasActiveFilters ? 'No hay documentos con los filtros seleccionados.' : t.documents.noDocuments}
              </p>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="mt-2 text-xs text-primary hover:underline">
                  Limpiar filtros
                </button>
              )}
            </div>
          )}

          {/* Load more */}
          {hasMore && (
            <div className="p-4 flex justify-center border-t">
              <Button
                variant="outline"
                onClick={() => doFetch(false)}
                disabled={loadingMore}
              >
                {loadingMore ? t.common.loading : 'Cargar más documentos'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Preview modal ───────────────────────────────────────────────────── */}
      <DocumentPreviewModal
        documentId={previewDocId}
        onClose={() => setPreviewDocId(null)}
      />

      {/* ── Trazabilidad modal ──────────────────────────────────────────────── */}
      {traceDocId && traceDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-base font-semibold">Trazabilidad del documento</h2>
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[220px]" title={traceDoc.original_filename}>
                  {traceDoc.original_filename}
                </p>
              </div>
              <button onClick={() => setTraceDocId(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Estado actual</span>
                <StatusBadge
                  status={getUnifiedStatus({
                    processingStatus: traceDoc.processing_status ?? 'processing',
                    reviewStatus: traceDoc.invoice?.review_status,
                    gestoriaStatus: traceDoc.invoice?.gestoria_review_status,
                  })}
                  type="unified"
                />
              </div>
              {traceDoc.invoice && (
                <div className="text-sm">
                  <span className="text-gray-500">Factura: </span>
                  <span className="font-medium">{traceDoc.invoice.invoice_number}</span>
                  {traceDoc.invoice.supplier_name && (
                    <span className="text-gray-500"> · {traceDoc.invoice.supplier_name}</span>
                  )}
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-3">Progreso</p>
                <DocumentTimeline
                  processingStatus={traceDoc.processing_status ?? 'processing'}
                  reviewStatus={traceDoc.invoice?.review_status}
                  gestoriaStatus={traceDoc.invoice?.gestoria_review_status}
                />
              </div>
            </div>
            <div className="px-5 pb-5">
              <Button variant="outline" className="w-full" onClick={() => setTraceDocId(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ────────────────────────────────────────── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold text-red-600">{t.documents.deleteConfirmTitle}</h2>
              <button onClick={() => setConfirmDeleteId(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-700">{t.documents.deleteConfirmMessage}</p>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t">
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
                {t.common.cancel}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirmed}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {t.common.delete}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
