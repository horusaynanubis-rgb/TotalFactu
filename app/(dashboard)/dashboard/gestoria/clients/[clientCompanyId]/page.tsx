'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Loader2,
  Building2,
  Mail,
  Calendar,
  MessageCircle,
  MessageCircleOff,
  FileText,
  Clock,
  Download,
  CheckCircle2,
  Send,
  Eye,
  Receipt,
  AlertTriangle,
  LayoutDashboard,
  Inbox,
  Archive,
  Search,
  X,
  ClipboardCheck,
  History,
  PenLine,
  Filter,
} from 'lucide-react';
import { getUnifiedStatus } from '@/lib/unified-status';
import { StatusBadge } from '@/components/status-badge';
import { DocumentTimeline } from '@/components/document-timeline';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/input';
import { SendMessageModal } from '@/components/gestoria/send-message-modal';
import { InvoiceReviewModal } from '@/components/gestoria/invoice-review-modal';
import { InvoiceReviewHistoryModal } from '@/components/gestoria/invoice-review-history-modal';
import { InvoiceCorrectionModal } from '@/components/gestoria/invoice-correction-modal';
import {
  FISCAL_DOCUMENT_TYPES, FISCAL_PERIODS,
  FISCAL_DOCUMENT_TYPE_LABELS_ES, FISCAL_PERIOD_LABELS_ES,
} from '@/lib/fiscal-document-types';
import { FileStack } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientDetail {
  company: {
    id: string;
    name: string;
    tax_id: string;
    created_at: string;
    export_email: string;
  };
  license: {
    id: string;
    status: string;
    assigned_at: string | null;
    invitation: {
      email: string;
      status: string;
      accepted_at: string | null;
      created_at: string;
    } | null;
  } | null;
  telegramLinked: boolean;
  telegramDetails: { telegram_id: string; username: string | null; first_name: string | null; created_at: string }[];
  invoicesThisMonth: number;
  pendingReviews: number;
  totalExports: number;
  recentDocuments: DocRow[];
  recentExports: ExportRow[];
}

interface DocRow {
  id: string;
  original_filename: string;
  source_channel: string;
  processing_status: string;
  confidence_score: number | null;
  upload_timestamp: string;
  mime_type?: string;
  invoice?: {
    id: string;
    invoice_number: string;
    supplier_name: string;
    review_status: string;
    gestoria_review_status: string | null;
  } | null;
}

interface InvoiceRow {
  id: string;
  document_id: string;
  invoice_number: string;
  invoice_type: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  customer_name: string;
  issue_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  extraction_confidence: number;
  review_status: string;
  gestoria_review_status: string | null;
  gestoria_reviewed_at: string | null;
  gestoria_reviewed_by: string | null;
  gestoria_review_notes: string | null;
  gestoria_issue_types: string | null;
  tax_rate: number | null;
  category: string | null;
  document: { original_filename: string } | null;
}

interface ExportRow {
  id: string;
  export_type: string;
  period_start: string;
  period_end: string;
  record_count: number;
  email_sent: boolean;
  email_sent_at: string | null;
  created_at: string;
  company: { export_email: string };
}

interface BatchInfo {
  batchIndex: number;
  fromItem: number;
  toItem: number;
  documentCount: number;
  estimatedSizeMB: number;
  token: string;
}

interface ExportPlan {
  totalDocuments: number;
  totalEstimatedSizeMB: number;
  batchCount: number;
  batches: BatchInfo[];
}

interface FiscalExportPlan {
  mode: 'csv' | 'fiscal' | 'complete';
  year: number;
  quarter: number | 'annual';
  periodLabel: string;
  totalDocuments: number;
  batchCount: number;
  batches: BatchInfo[];
}

interface MessageRow {
  id: string;
  subject: string;
  body: string;
  read_at: string | null;
  email_sent: boolean;
  telegram_sent: boolean;
  created_at: string;
}

interface FiscalDocRow {
  id: string;
  original_filename: string;
  document_type: string;
  fiscal_year: number;
  fiscal_period: string;
  description: string | null;
  status: string;
  gestoria_notes: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docStatusBadge(status: string) {
  if (status === 'completed')
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Extraído</Badge>;
  if (status === 'needs_review')
    return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Revisión IA</Badge>;
  if (status === 'failed')
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Error extracción</Badge>;
  return <Badge variant="secondary">Procesando</Badge>;
}

function confidenceBadge(score: number | null) {
  if (score === null) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? 'text-green-700' : pct >= 60 ? 'text-yellow-700' : 'text-red-700';
  return <span className={`text-xs font-medium ${cls}`}>{pct}%</span>;
}

function channelLabel(ch: string) {
  if (ch === 'telegram') return 'Telegram';
  if (ch === 'email') return 'Email';
  return 'Web';
}

function periodLabel(start: string, end: string, type: string) {
  const s = new Date(start);
  if (type === 'monthly') {
    return s.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  }
  const q = Math.floor(s.getMonth() / 3) + 1;
  return `T${q} ${s.getFullYear()}`;
}

function invoiceTypeLabel(type: string) {
  return type === 'received' ? 'Recibida' : 'Emitida';
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

function gestoriaStatusBadge(status: string | null) {
  if (!status || status === 'pending_review')
    return <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100 text-xs">Pendiente revisión</Badge>;
  if (status === 'reviewed_ok')
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">Revisada</Badge>;
  if (status === 'reviewed_issue')
    return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 text-xs">Revisada (incidencia)</Badge>;
  if (status === 'waiting_client')
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 text-xs">Esperando cliente</Badge>;
  if (status === 'corrected')
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Finalizada</Badge>;
  if (status === 'ignored')
    return <Badge className="bg-gray-100 text-gray-500 hover:bg-gray-100 text-xs">Ignorada</Badge>;
  if (status === 'legacy_unreviewed')
    return <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-100 text-xs">Histórica sin revisar</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

const REVISION_CHIP_FILTERS = [
  { v: 'pending',        l: 'Pendientes' },
  { v: 'reviewed_issue', l: 'Incorrectas' },
  { v: 'waiting_client', l: 'Esp. cliente' },
  { v: 'reviewed_ok',    l: 'Revisadas' },
  { v: 'all',            l: 'Todas' },
] as const;

function SortableHead({
  col, label, sortBy, sortDir, onClick, className,
}: {
  col: string; label: string; sortBy: string; sortDir: 'asc' | 'desc';
  onClick: () => void; className?: string;
}) {
  const active = sortBy === col;
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/30 whitespace-nowrap ${className ?? ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'asc'
            ? <ArrowUp className="h-3 w-3 text-primary" />
            : <ArrowDown className="h-3 w-3 text-primary" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </div>
    </TableHead>
  );
}

const INVOICE_CHIP_TYPES = [
  { v: 'all', l: 'Todas' },
  { v: 'received', l: 'Recibidas' },
  { v: 'issued', l: 'Emitidas' },
] as const;

const INVOICE_CHIP_STATUSES = [
  { v: 'all', l: 'Todos estados' },
  { v: 'approved', l: 'Validadas' },
  { v: 'pending', l: 'Sin validar' },
] as const;

const INVOICE_CHIP_PERIODS = [
  { v: 'all', l: 'Todo' },
  { v: 'this_month', l: 'Este mes' },
  { v: 'last_3_months', l: 'Últimos 3m' },
  { v: 'this_year', l: 'Este año' },
  { v: 'custom', l: 'Personalizado' },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams<{ clientCompanyId: string }>();

  // Summary data (existing API)
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);

  // Documents (lazy — loaded on first activation of Documentos or Revisión tab)
  const [documents, setDocuments] = useState<DocRow[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingMoreDocs, setLoadingMoreDocs] = useState(false);
  const [docsHasMore, setDocsHasMore] = useState(false);

  // Document filters
  const [docStatusFilter, setDocStatusFilter] = useState('all');
  const [docChannelFilter, setDocChannelFilter] = useState('all');
  const [docPeriodFilter, setDocPeriodFilter] = useState('all');
  const [docFrom, setDocFrom] = useState('');
  const [docTo, setDocTo] = useState('');
  const docStatusRef = useRef('all');
  const docChannelRef = useRef('all');
  const docPeriodRef = useRef('all');
  const docFromRef = useRef('');
  const docToRef = useRef('');

  // Trazabilidad modal for documents tab
  const [traceDocId, setTraceDocId] = useState<string | null>(null);

  // Invoices (lazy — loaded on first activation of Facturas tab)
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingMoreInvoices, setLoadingMoreInvoices] = useState(false);
  const [invoicesHasMore, setInvoicesHasMore] = useState(false);

  // Invoice filters & sorting
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceType, setInvoiceType] = useState('all');
  const [invoiceStatus, setInvoiceStatus] = useState('all');
  const [invoicePeriod, setInvoicePeriod] = useState('all');
  const [invoiceFrom, setInvoiceFrom] = useState('');
  const [invoiceTo, setInvoiceTo] = useState('');
  const [invoiceSortBy, setInvoiceSortBy] = useState('issue_date');
  const [invoiceSortDir, setInvoiceSortDir] = useState<'asc' | 'desc'>('desc');
  const invoiceSearchRef = useRef('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invoicesTabActivated = useRef(false);

  // Document search (client-side)
  const [docSearch, setDocSearch] = useState('');

  // Messages (lazy — loaded on first activation of Mensajes tab)
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);

  // Review modals
  const [reviewModalInvoice, setReviewModalInvoice] = useState<InvoiceRow | null>(null);
  const [historyModalInvoice, setHistoryModalInvoice] = useState<InvoiceRow | null>(null);
  const [correctionModalInvoice, setCorrectionModalInvoice] = useState<InvoiceRow | null>(null);

  // Revision tab filter
  const [revisionFilter, setRevisionFilter] = useState<string>('pending');
  const [revisionInvoices, setRevisionInvoices] = useState<InvoiceRow[] | null>(null);
  const [loadingRevision, setLoadingRevision] = useState(false);
  const revisionTabActivated = useRef(false);

  // Per-document action loading
  const [actionDocId, setActionDocId] = useState<string | null>(null);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);

  // A3 document export
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportType, setExportType] = useState('all');
  const [exportStatus, setExportStatus] = useState('processed');
  const [exportPlan, setExportPlan] = useState<ExportPlan | null>(null);
  const [loadingExportPlan, setLoadingExportPlan] = useState(false);
  const [downloadingBatch, setDownloadingBatch] = useState<number | null>(null);
  const [downloadErrors, setDownloadErrors] = useState<Record<number, string>>({});

  // Documentación fiscal (lazy — loaded on first activation of that tab)
  const [fiscalDocs, setFiscalDocs] = useState<FiscalDocRow[] | null>(null);
  const [loadingFiscalDocs, setLoadingFiscalDocs] = useState(false);
  const [fiscalDocsTotal, setFiscalDocsTotal] = useState(0);
  const fiscalDocsTabActivated = useRef(false);
  const [fiscalYearFilter, setFiscalYearFilter] = useState('all');
  const [fiscalPeriodFilter, setFiscalPeriodFilter] = useState('all');
  const [fiscalTypeFilter, setFiscalTypeFilter] = useState('all');
  const [fiscalStatusFilter, setFiscalStatusFilter] = useState('all');
  const [fiscalActionId, setFiscalActionId] = useState<string | null>(null);
  const [fiscalNoteDraft, setFiscalNoteDraft] = useState<Record<string, string>>({});
  // Current-quarter count shown as an info block in the Exportaciones tab
  const [fiscalDocsQuarterCount, setFiscalDocsQuarterCount] = useState<number | null>(null);

  // Controlled tab state — lets the "Ver documentación fiscal" link jump tabs programmatically
  const [activeTab, setActiveTab] = useState('resumen');

  // Exportación trimestral completa (CSV + documentación fiscal ZIP) — additive, does not replace A3 export
  const [fiscalExportMode, setFiscalExportMode] = useState<'csv' | 'fiscal' | 'complete'>('complete');
  const [fiscalExportYear, setFiscalExportYear] = useState<number>(new Date().getFullYear());
  const [fiscalExportQuarter, setFiscalExportQuarter] = useState<number | 'annual'>(
    Math.floor(new Date().getMonth() / 3) + 1,
  );
  const [fiscalExportPlan, setFiscalExportPlan] = useState<FiscalExportPlan | null>(null);
  const [loadingFiscalExportPlan, setLoadingFiscalExportPlan] = useState(false);
  const [downloadingFiscalBatch, setDownloadingFiscalBatch] = useState<number | null>(null);
  const [fiscalDownloadErrors, setFiscalDownloadErrors] = useState<Record<number, string>>({});

  const companyType = (session?.user as any)?.companyType;

  useEffect(() => {
    if (status === 'authenticated' && companyType !== 'gestoria') {
      router.replace('/dashboard');
    }
  }, [status, companyType, router]);

  // Load summary on mount
  useEffect(() => {
    if (companyType !== 'gestoria' || !params.clientCompanyId) return;
    fetch(`/api/gestoria/clients/${params.clientCompanyId}`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 403) router.replace('/dashboard/gestoria/clients');
          throw new Error('fetch error');
        }
        return r.json();
      })
      .then((data) => setDetail(data))
      .catch(() => toast.error('Error cargando cliente'))
      .finally(() => setLoadingDetail(false));
  }, [companyType, params.clientCompanyId, router]);

  const padDoc = (n: number) => String(n).padStart(2, '0');
  const localStrDoc = (d: Date) =>
    `${d.getFullYear()}-${padDoc(d.getMonth() + 1)}-${padDoc(d.getDate())}`;

  function doFetchDocs(
    replace: boolean,
    overrides?: {
      status?: string; channel?: string; period?: string;
      from?: string; to?: string;
    },
  ) {
    const status  = overrides?.status  ?? docStatusRef.current;
    const channel = overrides?.channel ?? docChannelRef.current;
    const period  = overrides?.period  ?? docPeriodRef.current;
    const from    = overrides?.from    ?? docFromRef.current;
    const to      = overrides?.to      ?? docToRef.current;
    const offset  = replace ? 0 : (documents?.length ?? 0);

    if (replace) { setLoadingDocs(true); setDocuments(null); setDocsHasMore(false); }
    else { if (loadingMoreDocs) return; setLoadingMoreDocs(true); }

    const sp = new URLSearchParams();
    sp.set('limit', '50');
    sp.set('offset', String(offset));
    if (status !== 'all')  sp.set('status',  status);
    if (channel !== 'all') sp.set('channel', channel);

    const now = new Date();
    const todayStr = localStrDoc(now);
    if (period === 'this_month') {
      sp.set('from', `${now.getFullYear()}-${padDoc(now.getMonth() + 1)}-01`);
      sp.set('to', todayStr);
    } else if (period === 'last_3_months') {
      sp.set('from', localStrDoc(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())));
      sp.set('to', todayStr);
    } else if (period === 'this_year') {
      sp.set('from', `${now.getFullYear()}-01-01`);
      sp.set('to', todayStr);
    } else if (period === 'custom') {
      if (from) sp.set('from', from);
      if (to)   sp.set('to', to);
    }

    fetch(`/api/gestoria/clients/${params.clientCompanyId}/documents?${sp}`)
      .then((r) => r.json())
      .then((data) => {
        if (replace) setDocuments(data.documents ?? []);
        else setDocuments((prev) => [...(prev ?? []), ...(data.documents ?? [])]);
        setDocsHasMore(data.hasMore ?? false);
      })
      .catch(() => toast.error('Error cargando documentos'))
      .finally(() => {
        if (replace) setLoadingDocs(false);
        else setLoadingMoreDocs(false);
      });
  }

  const loadDocuments = () => {
    if (documents !== null || loadingDocs) return;
    doFetchDocs(true);
  };

  const loadMoreDocuments = () => {
    if (!documents || loadingMoreDocs) return;
    doFetchDocs(false);
  };

  function doFetchInvoices(
    replace: boolean,
    overrides?: {
      search?: string; type?: string; status?: string;
      period?: string; from?: string; to?: string;
      sortBy?: string; sortDir?: 'asc' | 'desc';
    },
  ) {
    const search = overrides?.search ?? invoiceSearchRef.current;
    const type = overrides?.type ?? invoiceType;
    const status = overrides?.status ?? invoiceStatus;
    const period = overrides?.period ?? invoicePeriod;
    const from = overrides?.from ?? invoiceFrom;
    const to = overrides?.to ?? invoiceTo;
    const sortBy = overrides?.sortBy ?? invoiceSortBy;
    const sortDir = overrides?.sortDir ?? invoiceSortDir;
    const offset = replace ? 0 : (invoices?.length ?? 0);

    if (replace) {
      setLoadingInvoices(true);
      setInvoices(null);
      setInvoicesHasMore(false);
    } else {
      if (loadingMoreInvoices) return;
      setLoadingMoreInvoices(true);
    }

    const sp = new URLSearchParams();
    sp.set('limit', '50');
    sp.set('offset', String(offset));
    if (search.trim()) sp.set('q', search.trim());
    if (type !== 'all') sp.set('type', type);
    if (status !== 'all') sp.set('status', status);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    // Use local date parts to avoid UTC-offset shifting the date (e.g. UTC+2 turns Jan 1 into Dec 31)
    const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayStr = localDateStr(now);
    if (period === 'this_month') {
      sp.set('from', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
      sp.set('to', todayStr);
    } else if (period === 'last_3_months') {
      const d = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      sp.set('from', localDateStr(d));
      sp.set('to', todayStr);
    } else if (period === 'this_year') {
      sp.set('from', `${now.getFullYear()}-01-01`);
      sp.set('to', todayStr);
    } else if (period === 'custom') {
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
    }

    sp.set('sortBy', sortBy);
    sp.set('sortDir', sortDir);

    fetch(`/api/gestoria/clients/${params.clientCompanyId}/invoices?${sp}`)
      .then((r) => r.json())
      .then((data) => {
        if (replace) setInvoices(data.invoices ?? []);
        else setInvoices((prev) => [...(prev ?? []), ...(data.invoices ?? [])]);
        setInvoicesHasMore(data.hasMore ?? false);
      })
      .catch(() => toast.error('Error cargando facturas'))
      .finally(() => {
        if (replace) setLoadingInvoices(false);
        else setLoadingMoreInvoices(false);
      });
  }

  const handleSearchChange = (val: string) => {
    setInvoiceSearch(val);
    invoiceSearchRef.current = val;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => doFetchInvoices(true, { search: val }), 300);
  };

  const handleTypeChange = (val: string) => {
    setInvoiceType(val);
    doFetchInvoices(true, { type: val });
  };

  const handleStatusChange = (val: string) => {
    setInvoiceStatus(val);
    doFetchInvoices(true, { status: val });
  };

  const handlePeriodChange = (val: string) => {
    setInvoicePeriod(val);
    doFetchInvoices(true, { period: val });
  };

  const handleInvoiceFromChange = (val: string) => {
    setInvoiceFrom(val);
    setInvoicePeriod('custom');
    doFetchInvoices(true, { period: 'custom', from: val });
  };

  const handleInvoiceToChange = (val: string) => {
    setInvoiceTo(val);
    setInvoicePeriod('custom');
    doFetchInvoices(true, { period: 'custom', to: val });
  };

  const handleInvoiceSortChange = (col: string) => {
    const newDir = invoiceSortBy === col && invoiceSortDir === 'desc' ? 'asc' : 'desc';
    setInvoiceSortBy(col);
    setInvoiceSortDir(newDir);
    doFetchInvoices(true, { sortBy: col, sortDir: newDir });
  };

  const clearInvoiceFilters = () => {
    setInvoiceSearch('');
    invoiceSearchRef.current = '';
    setInvoiceType('all');
    setInvoiceStatus('all');
    setInvoicePeriod('all');
    setInvoiceFrom('');
    setInvoiceTo('');
    setInvoiceSortBy('issue_date');
    setInvoiceSortDir('desc');
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    doFetchInvoices(true, {
      search: '', type: 'all', status: 'all', period: 'all',
      from: '', to: '', sortBy: 'issue_date', sortDir: 'desc',
    });
  };

  const handlePrepareExport = async () => {
    if (!exportFrom || !exportTo) {
      toast.error('Selecciona un rango de fechas');
      return;
    }
    if (exportFrom > exportTo) {
      toast.error('La fecha de inicio debe ser anterior a la fecha de fin');
      return;
    }
    setLoadingExportPlan(true);
    setExportPlan(null);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/documents/export-plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: exportFrom, to: exportTo, type: exportType, status: exportStatus }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'TOO_MANY_DOCUMENTS') {
          toast.error(
            `Demasiados documentos (${(data.totalDocuments as number).toLocaleString('es-ES')}). Reduce el rango de fechas o divide por meses.`,
          );
        } else {
          toast.error(data.error || 'Error al preparar la exportación');
        }
        return;
      }
      if (data.totalDocuments === 0) {
        toast('No hay documentos para el periodo seleccionado.', { icon: 'ℹ️' });
        return;
      }
      setExportPlan(data as ExportPlan);
    } catch {
      toast.error('Error al preparar la exportación');
    } finally {
      setLoadingExportPlan(false);
    }
  };

  const handleDownloadZip = async (batch: BatchInfo, zipUrl: string) => {
    setDownloadingBatch(batch.batchIndex);
    setDownloadErrors((prev) => { const next = { ...prev }; delete next[batch.batchIndex]; return next; });

    try {
      const res = await fetch(zipUrl, { method: 'GET', credentials: 'include' });

      if (!res.ok) {
        const text = await res.text();
        console.error('export-zip error', res.status, text);
        setDownloadErrors((prev) => ({ ...prev, [batch.batchIndex]: `Error ${res.status}` }));
        return;
      }

      const blob = await res.blob();
      const batchLabel = String(batch.batchIndex + 1).padStart(3, '0');
      const filename = `documentos_lote${batchLabel}.zip`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setDownloadErrors((prev) => ({ ...prev, [batch.batchIndex]: err?.message ?? 'Error desconocido' }));
    } finally {
      setDownloadingBatch(null);
    }
  };

  const handlePrepareFiscalExport = async () => {
    setLoadingFiscalExportPlan(true);
    setFiscalExportPlan(null);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/fiscal-export/plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: fiscalExportYear, quarter: fiscalExportQuarter, mode: fiscalExportMode }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'TOO_MANY_DOCUMENTS') {
          toast.error(
            `Demasiados documentos (${(data.totalDocuments as number).toLocaleString('es-ES')}). Reduce el periodo.`,
          );
        } else {
          toast.error(data.error || 'Error al preparar la exportación');
        }
        return;
      }
      setFiscalExportPlan(data as FiscalExportPlan);
    } catch {
      toast.error('Error al preparar la exportación');
    } finally {
      setLoadingFiscalExportPlan(false);
    }
  };

  const handleDownloadFiscalZip = async (batch: BatchInfo, zipUrl: string) => {
    setDownloadingFiscalBatch(batch.batchIndex);
    setFiscalDownloadErrors((prev) => { const next = { ...prev }; delete next[batch.batchIndex]; return next; });

    try {
      const res = await fetch(zipUrl, { method: 'GET', credentials: 'include' });
      if (!res.ok) {
        const text = await res.text();
        console.error('fiscal-export-zip error', res.status, text);
        setFiscalDownloadErrors((prev) => ({ ...prev, [batch.batchIndex]: `Error ${res.status}` }));
        return;
      }
      const blob = await res.blob();
      const batchLabel = String(batch.batchIndex + 1).padStart(3, '0');
      const filename = `exportacion_lote${batchLabel}.zip`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setFiscalDownloadErrors((prev) => ({ ...prev, [batch.batchIndex]: err?.message ?? 'Error desconocido' }));
    } finally {
      setDownloadingFiscalBatch(null);
    }
  };

  const loadMessages = () => {
    if (messages !== null || loadingMessages) return;
    setLoadingMessages(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/messages`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => toast.error('Error cargando mensajes'))
      .finally(() => setLoadingMessages(false));
  };

  const loadRevisionInvoices = (filter: string) => {
    setLoadingRevision(true);
    setRevisionInvoices(null);
    const sp = new URLSearchParams({ limit: '100', offset: '0' });
    if (filter !== 'all') sp.set('gestoriaStatus', filter);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/invoices?${sp}`)
      .then((r) => r.json())
      .then((data) => setRevisionInvoices(data.invoices ?? []))
      .catch(() => toast.error('Error cargando revisiones'))
      .finally(() => setLoadingRevision(false));
  };

  const loadFiscalDocuments = (overrides?: {
    year?: string; period?: string; type?: string; status?: string;
  }) => {
    const year = overrides?.year ?? fiscalYearFilter;
    const period = overrides?.period ?? fiscalPeriodFilter;
    const type = overrides?.type ?? fiscalTypeFilter;
    const st = overrides?.status ?? fiscalStatusFilter;

    setLoadingFiscalDocs(true);
    const sp = new URLSearchParams({ limit: '100', offset: '0' });
    if (year !== 'all') sp.set('year', year);
    if (period !== 'all') sp.set('period', period);
    if (type !== 'all') sp.set('type', type);
    if (st !== 'all') sp.set('status', st);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/fiscal-documents?${sp}`)
      .then((r) => r.json())
      .then((data) => { setFiscalDocs(data.items ?? []); setFiscalDocsTotal(data.total ?? 0); })
      .catch(() => toast.error('Error cargando documentación fiscal'))
      .finally(() => setLoadingFiscalDocs(false));
  };

  const handleFiscalYearFilterChange = (v: string) => { setFiscalYearFilter(v); loadFiscalDocuments({ year: v }); };
  const handleFiscalPeriodFilterChange = (v: string) => { setFiscalPeriodFilter(v); loadFiscalDocuments({ period: v }); };
  const handleFiscalTypeFilterChange = (v: string) => { setFiscalTypeFilter(v); loadFiscalDocuments({ type: v }); };
  const handleFiscalStatusFilterChange = (v: string) => { setFiscalStatusFilter(v); loadFiscalDocuments({ status: v }); };

  const loadFiscalDocsQuarterCount = () => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const sp = new URLSearchParams({ limit: '1', offset: '0', year: String(now.getFullYear()), period: `Q${quarter}` });
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/fiscal-documents?${sp}`)
      .then((r) => r.json())
      .then((data) => setFiscalDocsQuarterCount(data.total ?? 0))
      .catch(() => {});
  };

  const handleFiscalDocAction = async (docId: string, mode: 'view' | 'download') => {
    setFiscalActionId(docId);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/fiscal-documents/${docId}/preview`,
      );
      if (!res.ok) { toast.error('No se pudo obtener el enlace'); return; }
      const { url, original_filename } = await res.json();
      if (mode === 'view') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = original_filename ?? 'documento';
        a.click();
      }
    } catch {
      toast.error('Error al acceder al documento');
    } finally {
      setFiscalActionId(null);
    }
  };

  const handleFiscalDocReview = async (docId: string, status: 'available' | 'reviewed') => {
    setFiscalActionId(docId);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/fiscal-documents/${docId}/review`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) { toast.error('No se pudo actualizar el estado'); return; }
      toast.success(status === 'reviewed' ? 'Marcado como revisado' : 'Marcado como disponible');
      loadFiscalDocuments();
    } catch {
      toast.error('Error al actualizar el estado');
    } finally {
      setFiscalActionId(null);
    }
  };

  const handleFiscalDocNoteSave = async (docId: string) => {
    setFiscalActionId(docId);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/fiscal-documents/${docId}/review`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gestoria_notes: fiscalNoteDraft[docId] ?? '' }),
        },
      );
      if (!res.ok) { toast.error('No se pudo guardar la observación'); return; }
      toast.success('Observación guardada');
      loadFiscalDocuments();
    } catch {
      toast.error('Error al guardar la observación');
    } finally {
      setFiscalActionId(null);
    }
  };

  const handleTabChange = (tab: string) => {
    if (tab === 'documentos') loadDocuments();
    if (tab === 'facturas' && !invoicesTabActivated.current) {
      invoicesTabActivated.current = true;
      doFetchInvoices(true);
    }
    if (tab === 'revision' && !revisionTabActivated.current) {
      revisionTabActivated.current = true;
      loadRevisionInvoices(revisionFilter);
    }
    if (tab === 'documentacion-fiscal' && !fiscalDocsTabActivated.current) {
      fiscalDocsTabActivated.current = true;
      loadFiscalDocuments();
    }
    if (tab === 'exportaciones' && fiscalDocsQuarterCount === null) {
      loadFiscalDocsQuarterCount();
    }
    if (tab === 'mensajes') loadMessages();
  };

  const handleRevisionFilterChange = (filter: string) => {
    setRevisionFilter(filter);
    loadRevisionInvoices(filter);
  };

  const handleDocumentAction = async (docId: string, mode: 'view' | 'download') => {
    setActionDocId(docId);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/documents/${docId}/preview`,
      );
      if (!res.ok) { toast.error('No se pudo obtener el enlace'); return; }
      const { url, original_filename } = await res.json();
      if (mode === 'view') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = original_filename ?? 'documento';
        a.click();
      }
    } catch {
      toast.error('Error al acceder al documento');
    } finally {
      setActionDocId(null);
    }
  };

  const handleExportDownload = async (exportId: string) => {
    setDownloadingExportId(exportId);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/exports/${exportId}/download`,
      );
      if (!res.ok) { toast.error('No se pudo obtener el enlace de descarga'); return; }
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, '_blank');
    } catch {
      toast.error('Error al descargar');
    } finally {
      setDownloadingExportId(null);
    }
  };

  if (status === 'loading' || (status === 'authenticated' && companyType !== 'gestoria') || loadingDetail) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) return null;

  const { company, license, telegramLinked, invoicesThisMonth, pendingReviews, totalExports, recentExports } = detail;

  const hasActiveInvoiceFilters =
    invoiceSearch !== '' ||
    invoiceType !== 'all' ||
    invoiceStatus !== 'all' ||
    invoicePeriod !== 'all';

  const filteredDocs = docSearch.trim()
    ? (documents ?? []).filter((d) => {
        const q = docSearch.toLowerCase();
        return (
          d.original_filename.toLowerCase().includes(q) ||
          d.invoice?.invoice_number?.toLowerCase().includes(q) ||
          d.invoice?.supplier_name?.toLowerCase().includes(q)
        );
      })
    : (documents ?? []);

  const hasActiveDocFilters =
    docStatusFilter !== 'all' || docChannelFilter !== 'all' || docPeriodFilter !== 'all';


  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/gestoria/clients">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver a clientes
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
            <p className="text-muted-foreground text-sm">{company.tax_id}</p>
          </div>
        </div>
        {license?.invitation?.accepted_at ? (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Activo</Badge>
        ) : (
          <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Pendiente activación</Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); handleTabChange(v); }}>
        <TabsList>
          <TabsTrigger value="resumen">
            <LayoutDashboard className="h-4 w-4 mr-1.5" />
            Resumen
          </TabsTrigger>
          <TabsTrigger value="documentos">
            <FileText className="h-4 w-4 mr-1.5" />
            Documentos
          </TabsTrigger>
          <TabsTrigger value="facturas">
            <Receipt className="h-4 w-4 mr-1.5" />
            Facturas
          </TabsTrigger>
          <TabsTrigger value="revision">
            <AlertTriangle className="h-4 w-4 mr-1.5" />
            Revisión
            {pendingReviews > 0 && (
              <Badge className="ml-1.5 bg-yellow-100 text-yellow-700 hover:bg-yellow-100 px-1.5 py-0 text-xs">
                {pendingReviews}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="documentacion-fiscal">
            <FileStack className="h-4 w-4 mr-1.5" />
            Documentación fiscal
          </TabsTrigger>
          <TabsTrigger value="exportaciones">
            <Archive className="h-4 w-4 mr-1.5" />
            Exportar A3
          </TabsTrigger>
          <TabsTrigger value="mensajes">
            <Inbox className="h-4 w-4 mr-1.5" />
            Mensajes
          </TabsTrigger>
        </TabsList>

        {/* ── RESUMEN ─────────────────────────────────────────────────────── */}
        <TabsContent value="resumen" className="mt-6 space-y-6">
          {/* KPI cards row 1 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Mail className="h-4 w-4" />Email
                </div>
                <p className="font-medium text-sm truncate">
                  {license?.invitation?.email ?? company.export_email}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />Fecha de alta
                </div>
                <p className="font-medium text-sm">
                  {license?.assigned_at
                    ? new Date(license.assigned_at).toLocaleDateString('es-ES')
                    : new Date(company.created_at).toLocaleDateString('es-ES')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <MessageCircle className="h-4 w-4" />Telegram
                </div>
                {telegramLinked ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="font-medium text-sm">Vinculado</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <MessageCircleOff className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">No vinculado</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Download className="h-4 w-4" />Exportaciones
                </div>
                <p className="text-2xl font-bold">{totalExports}</p>
              </CardContent>
            </Card>
          </div>

          {/* KPI cards row 2 */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <FileText className="h-4 w-4" />Facturas procesadas este mes
                </div>
                <p className="text-2xl font-bold">{invoicesThisMonth}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Clock className="h-4 w-4" />Pendientes de revisión
                </div>
                <p className={`text-2xl font-bold ${pendingReviews > 0 ? 'text-yellow-600' : ''}`}>
                  {pendingReviews}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Total acumulado (histórico)</p>
              </CardContent>
            </Card>
          </div>

          {/* Exports table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="h-4 w-4" />Exportaciones CSV
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentExports.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Download className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Este cliente aún no ha generado exportaciones.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Periodo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Email destino</TableHead>
                      <TableHead>Email enviado</TableHead>
                      <TableHead>Registros</TableHead>
                      <TableHead className="text-right">Descargar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentExports.map((exp) => (
                      <TableRow key={exp.id}>
                        <TableCell className="font-medium">
                          {periodLabel(exp.period_start, exp.period_end, exp.export_type)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {exp.export_type === 'monthly' ? 'Mensual' : 'Trimestral'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(exp.created_at).toLocaleDateString('es-ES')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {exp.company.export_email}
                        </TableCell>
                        <TableCell>
                          {exp.email_sent ? (
                            <div className="flex items-center gap-1 text-green-600 text-sm">
                              <Send className="h-3.5 w-3.5" />
                              {exp.email_sent_at
                                ? new Date(exp.email_sent_at).toLocaleDateString('es-ES')
                                : 'Sí'}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {exp.record_count}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingExportId === exp.id}
                            onClick={() => handleExportDownload(exp.id)}
                          >
                            {downloadingExportId === exp.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1.5">CSV</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DOCUMENTOS ──────────────────────────────────────────────────── */}
        <TabsContent value="documentos" className="mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />Documentos del cliente
                </span>
                {documents !== null && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {filteredDocs.length}{!docSearch && docsHasMore ? '+' : ''} documento{filteredDocs.length !== 1 ? 's' : ''}
                  </span>
                )}
              </CardTitle>
            </CardHeader>

            {/* Clarification banner */}
            <div className="mx-6 mb-3 mt-0 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Esta vista muestra los archivos recibidos y su estado de extracción IA. La revisión contable se gestiona desde la pestaña <strong>Revisión</strong>.
            </div>

            {/* Filter bar */}
            <div className="px-6 pb-4 space-y-3 border-b">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por archivo, proveedor, nº factura…"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  className="pl-9 pr-9"
                />
                {docSearch && (
                  <button
                    onClick={() => setDocSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Status chips */}
              <div className="flex flex-wrap gap-1">
                {([
                  { v: 'all', l: 'Todos' },
                  { v: 'processing', l: 'Procesando IA' },
                  { v: 'pending', l: 'Sin revisar' },
                  { v: 'reviewed', l: 'Revisada' },
                  { v: 'waiting', l: 'Esperando cliente' },
                  { v: 'done', l: 'Finalizada' },
                  { v: 'error', l: 'Error' },
                ] as const).map(({ v, l }) => (
                  <button
                    key={v}
                    onClick={() => {
                      setDocStatusFilter(v); docStatusRef.current = v;
                      doFetchDocs(true, { status: v });
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                      docStatusFilter === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {/* Channel + Period chips */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1">
                  {([
                    { v: 'all', l: 'Todos canales' },
                    { v: 'web', l: 'Web' },
                    { v: 'telegram', l: 'Telegram' },
                    { v: 'email', l: 'Email' },
                  ] as const).map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => {
                        setDocChannelFilter(v); docChannelRef.current = v;
                        doFetchDocs(true, { channel: v });
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                        docChannelFilter === v
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <span className="h-5 w-px bg-border" />
                <div className="flex gap-1 flex-wrap">
                  {([
                    { v: 'all', l: 'Todo' },
                    { v: 'this_month', l: 'Este mes' },
                    { v: 'last_3_months', l: 'Últimos 3m' },
                    { v: 'this_year', l: 'Este año' },
                    { v: 'custom', l: 'Personalizado' },
                  ] as const).map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => {
                        setDocPeriodFilter(v); docPeriodRef.current = v;
                        if (v !== 'custom') doFetchDocs(true, { period: v });
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                        docPeriodFilter === v
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {(hasActiveDocFilters || docSearch) && (
                  <button
                    onClick={() => {
                      setDocStatusFilter('all'); docStatusRef.current = 'all';
                      setDocChannelFilter('all'); docChannelRef.current = 'all';
                      setDocPeriodFilter('all'); docPeriodRef.current = 'all';
                      setDocFrom(''); docFromRef.current = '';
                      setDocTo(''); docToRef.current = '';
                      setDocSearch('');
                      doFetchDocs(true, { status: 'all', channel: 'all', period: 'all', from: '', to: '' });
                    }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />Limpiar
                  </button>
                )}
              </div>

              {/* Custom date range */}
              {docPeriodFilter === 'custom' && (
                <div className="flex gap-3 items-center max-w-sm">
                  <Input
                    type="date"
                    value={docFrom}
                    onChange={(e) => {
                      setDocFrom(e.target.value); docFromRef.current = e.target.value;
                      doFetchDocs(true, { period: 'custom', from: e.target.value, to: docToRef.current });
                    }}
                    className="h-8 text-sm"
                  />
                  <span className="text-sm text-muted-foreground shrink-0">—</span>
                  <Input
                    type="date"
                    value={docTo}
                    onChange={(e) => {
                      setDocTo(e.target.value); docToRef.current = e.target.value;
                      doFetchDocs(true, { period: 'custom', from: docFromRef.current, to: e.target.value });
                    }}
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>

            <CardContent className="p-0">
              {loadingDocs ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : documents === null || (documents.length === 0 && !hasActiveDocFilters && !docSearch) ? (
                <div className="py-12 text-center text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin documentos todavía.</p>
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No hay documentos con los filtros seleccionados.</p>
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Archivo</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Confianza</TableHead>
                      <TableHead>Factura asociada</TableHead>
                      <TableHead>Fecha subida</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium text-sm max-w-xs truncate">
                          {doc.original_filename}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {channelLabel(doc.source_channel)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={getUnifiedStatus({
                              processingStatus: doc.processing_status,
                              reviewStatus: doc.invoice?.review_status,
                              gestoriaStatus: doc.invoice?.gestoria_review_status,
                            })}
                            type="unified"
                          />
                        </TableCell>
                        <TableCell>{confidenceBadge(doc.confidence_score)}</TableCell>
                        <TableCell>
                          {doc.invoice ? (
                            <div className="text-xs">
                              <p className="font-medium text-foreground truncate max-w-[140px]" title={doc.invoice.supplier_name}>
                                {doc.invoice.supplier_name}
                              </p>
                              <p className="text-muted-foreground">{doc.invoice.invoice_number}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(doc.upload_timestamp).toLocaleDateString('es-ES')}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionDocId === doc.id}
                              onClick={() => handleDocumentAction(doc.id, 'view')}
                            >
                              {actionDocId === doc.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1">Ver</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={actionDocId === doc.id}
                              onClick={() => handleDocumentAction(doc.id, 'download')}
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span className="ml-1">Descargar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Ver trazabilidad"
                              onClick={() => setTraceDocId(doc.id)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!docSearch && docsHasMore && (
                  <div className="p-4 flex justify-center border-t">
                    <Button variant="outline" size="sm" onClick={loadMoreDocuments} disabled={loadingMoreDocs}>
                      {loadingMoreDocs ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Cargar más documentos
                    </Button>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── FACTURAS ────────────────────────────────────────────────────── */}
        <TabsContent value="facturas" className="mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />Facturas del cliente
                </span>
                {invoices !== null && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {invoices.length}{invoicesHasMore ? '+' : ''} factura{invoices.length !== 1 ? 's' : ''}
                  </span>
                )}
              </CardTitle>
            </CardHeader>

            {/* ── Filter bar ──────────────────────────────────────────────── */}
            <div className="px-6 pb-4 space-y-3 border-b">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por proveedor, nº factura, importe..."
                  value={invoiceSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 pr-9"
                />
                {invoiceSearch && (
                  <button
                    onClick={() => handleSearchChange('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Limpiar búsqueda"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Type */}
                <div className="flex gap-1">
                  {INVOICE_CHIP_TYPES.map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => handleTypeChange(v)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        invoiceType === v
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                <span className="h-5 w-px bg-border" />

                {/* Status */}
                <div className="flex gap-1">
                  {INVOICE_CHIP_STATUSES.map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => handleStatusChange(v)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        invoiceStatus === v
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                <span className="h-5 w-px bg-border" />

                {/* Period */}
                <div className="flex gap-1 flex-wrap">
                  {INVOICE_CHIP_PERIODS.map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => handlePeriodChange(v)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        invoicePeriod === v
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {hasActiveInvoiceFilters && (
                  <button
                    onClick={clearInvoiceFilters}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    Limpiar filtros
                  </button>
                )}
              </div>

              {/* Custom date range */}
              {invoicePeriod === 'custom' && (
                <div className="flex gap-3 items-center max-w-sm">
                  <Input
                    type="date"
                    value={invoiceFrom}
                    onChange={(e) => handleInvoiceFromChange(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <span className="text-sm text-muted-foreground shrink-0">—</span>
                  <Input
                    type="date"
                    value={invoiceTo}
                    onChange={(e) => handleInvoiceToChange(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>

            <CardContent className="p-0">
              {loadingInvoices ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : invoices === null ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : invoices.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    {hasActiveInvoiceFilters
                      ? 'No hay facturas que coincidan con los filtros.'
                      : 'Sin facturas todavía.'}
                  </p>
                  {hasActiveInvoiceFilters && (
                    <button
                      onClick={clearInvoiceFilters}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>
              ) : (
                <>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº Factura</TableHead>
                      <TableHead>Tipo</TableHead>
                      <SortableHead col="supplier_name" label="Proveedor" sortBy={invoiceSortBy} sortDir={invoiceSortDir} onClick={() => handleInvoiceSortChange('supplier_name')} />
                      <SortableHead col="issue_date" label="Fecha" sortBy={invoiceSortBy} sortDir={invoiceSortDir} onClick={() => handleInvoiceSortChange('issue_date')} />
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">IVA</TableHead>
                      <SortableHead col="total_amount" label="Total" sortBy={invoiceSortBy} sortDir={invoiceSortDir} onClick={() => handleInvoiceSortChange('total_amount')} className="text-right" />
                      <SortableHead col="extraction_confidence" label="Confianza IA" sortBy={invoiceSortBy} sortDir={invoiceSortDir} onClick={() => handleInvoiceSortChange('extraction_confidence')} />
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium text-sm whitespace-nowrap">{inv.invoice_number}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs whitespace-nowrap">
                            {invoiceTypeLabel(inv.invoice_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate">
                          {inv.supplier_name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(inv.issue_date).toLocaleDateString('es-ES')}
                        </TableCell>
                        <TableCell className="text-right text-sm whitespace-nowrap">
                          {inv.subtotal.toFixed(2)} {inv.currency}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                          {inv.tax_amount.toFixed(2)} {inv.currency}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium whitespace-nowrap">
                          {inv.total_amount.toFixed(2)} {inv.currency}
                        </TableCell>
                        <TableCell>{confidenceBadge(inv.extraction_confidence)}</TableCell>
                        <TableCell>
                          <StatusBadge
                            status={getUnifiedStatus({
                              processingStatus: 'completed',
                              reviewStatus: inv.review_status,
                              gestoriaStatus: inv.gestoria_review_status,
                            })}
                            type="unified"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!inv.document_id || actionDocId === inv.document_id}
                              title={inv.document_id ? `Ver: ${inv.document?.original_filename ?? 'documento'}` : 'Documento no disponible'}
                              onClick={() => inv.document_id && handleDocumentAction(inv.document_id, 'view')}
                            >
                              {actionDocId === inv.document_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1 hidden sm:inline">Ver</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!inv.document_id || actionDocId === inv.document_id}
                              title={inv.document_id ? `Descargar: ${inv.document?.original_filename ?? 'documento'}` : 'Documento no disponible'}
                              onClick={() => inv.document_id && handleDocumentAction(inv.document_id, 'download')}
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span className="ml-1 hidden sm:inline">Descargar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Revisar factura"
                              onClick={() => setReviewModalInvoice(inv)}
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Proponer corrección"
                              onClick={() => setCorrectionModalInvoice(inv)}
                            >
                              <PenLine className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Ver historial de revisión"
                              onClick={() => setHistoryModalInvoice(inv)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
                {invoicesHasMore && (
                  <div className="p-4 flex justify-center border-t">
                    <Button variant="outline" size="sm" onClick={() => doFetchInvoices(false)} disabled={loadingMoreInvoices}>
                      {loadingMoreInvoices ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Cargar más facturas
                    </Button>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REVISIÓN ────────────────────────────────────────────────────── */}
        <TabsContent value="revision" className="mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Cola de revisión de facturas
              </CardTitle>
            </CardHeader>

            {/* Filter chips */}
            <div className="px-6 pb-4 border-b">
              <div className="flex flex-wrap gap-1">
                {REVISION_CHIP_FILTERS.map(({ v, l }) => (
                  <button
                    key={v}
                    onClick={() => handleRevisionFilterChange(v)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      revisionFilter === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <CardContent className="p-0">
              {loadingRevision ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !revisionInvoices || revisionInvoices.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-70" />
                  <p className="text-sm">
                    {revisionFilter === 'pending'
                      ? 'No hay facturas pendientes de revisión.'
                      : 'No hay facturas en esta categoría.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº Factura</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Revisión</TableHead>
                        <TableHead>Revisado</TableHead>
                        <TableHead>Incidencias</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revisionInvoices.map((inv) => {
                        const issues: string[] = inv.gestoria_issue_types
                          ? JSON.parse(inv.gestoria_issue_types)
                          : [];
                        const ISSUE_SHORT: Record<string, string> = {
                          amount: 'Importe', supplier: 'Proveedor', date: 'Fecha',
                          vat: 'IVA', duplicate: 'Duplicada', illegible: 'Ilegible',
                          missing_document: 'Falta doc.', wrong_type: 'Tipo', other: 'Otra',
                        };
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium text-sm whitespace-nowrap">
                              {inv.invoice_number}
                            </TableCell>
                            <TableCell className="text-sm max-w-[150px] truncate">
                              {inv.supplier_name}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {new Date(inv.issue_date).toLocaleDateString('es-ES')}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium whitespace-nowrap">
                              {inv.total_amount.toFixed(2)} {inv.currency}
                            </TableCell>
                            <TableCell>{gestoriaStatusBadge(inv.gestoria_review_status)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {inv.gestoria_reviewed_at
                                ? new Date(inv.gestoria_reviewed_at).toLocaleDateString('es-ES', {
                                    day: '2-digit', month: '2-digit', year: '2-digit',
                                    hour: '2-digit', minute: '2-digit',
                                  })
                                : '—'}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {issues.slice(0, 2).map((iss) => (
                                  <Badge key={iss} variant="outline" className="text-xs">
                                    {ISSUE_SHORT[iss] ?? iss}
                                  </Badge>
                                ))}
                                {issues.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{issues.length - 2}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {inv.document_id && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={actionDocId === inv.document_id}
                                    onClick={() => handleDocumentAction(inv.document_id, 'view')}
                                  >
                                    {actionDocId === inv.document_id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Eye className="h-3.5 w-3.5" />
                                    )}
                                    <span className="ml-1 hidden sm:inline">Ver</span>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Revisar factura"
                                  onClick={() => setReviewModalInvoice(inv)}
                                >
                                  <ClipboardCheck className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Proponer corrección"
                                  onClick={() => setCorrectionModalInvoice(inv)}
                                >
                                  <PenLine className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Ver historial"
                                  onClick={() => setHistoryModalInvoice(inv)}
                                >
                                  <History className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DOCUMENTACIÓN FISCAL ────────────────────────────────────────── */}
        <TabsContent value="documentacion-fiscal" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileStack className="h-4 w-4" />
                Documentación fiscal complementaria ({fiscalDocsTotal})
              </CardTitle>
              <div className="flex flex-wrap gap-2 pt-2">
                <select
                  value={fiscalYearFilter}
                  onChange={(e) => handleFiscalYearFilterChange(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">Todos los años</option>
                  {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
                <select
                  value={fiscalPeriodFilter}
                  onChange={(e) => handleFiscalPeriodFilterChange(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">Todos los periodos</option>
                  {FISCAL_PERIODS.map((p) => (
                    <option key={p} value={p}>{FISCAL_PERIOD_LABELS_ES[p]}</option>
                  ))}
                </select>
                <select
                  value={fiscalTypeFilter}
                  onChange={(e) => handleFiscalTypeFilterChange(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">Todos los tipos</option>
                  {FISCAL_DOCUMENT_TYPES.map((tp) => (
                    <option key={tp} value={tp}>{FISCAL_DOCUMENT_TYPE_LABELS_ES[tp]}</option>
                  ))}
                </select>
                <select
                  value={fiscalStatusFilter}
                  onChange={(e) => handleFiscalStatusFilterChange(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">Todos los estados</option>
                  <option value="available">Disponible</option>
                  <option value="reviewed">Revisado</option>
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {loadingFiscalDocs ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !fiscalDocs || fiscalDocs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No hay documentos fiscales para este cliente todavía.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Archivo</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Observación interna</TableHead>
                        <TableHead>Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fiscalDocs.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell className="max-w-[200px] truncate">{doc.original_filename}</TableCell>
                          <TableCell className="text-sm">
                            {FISCAL_DOCUMENT_TYPE_LABELS_ES[doc.document_type as keyof typeof FISCAL_DOCUMENT_TYPE_LABELS_ES] ?? doc.document_type}
                          </TableCell>
                          <TableCell className="text-sm">
                            {doc.fiscal_year} · {FISCAL_PERIOD_LABELS_ES[doc.fiscal_period as keyof typeof FISCAL_PERIOD_LABELS_ES] ?? doc.fiscal_period}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(doc.created_at).toLocaleDateString('es-ES')}
                          </TableCell>
                          <TableCell>
                            <Badge className={doc.status === 'reviewed' ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-blue-100 text-blue-700 hover:bg-blue-100'}>
                              {doc.status === 'reviewed' ? 'Revisado' : 'Disponible'}
                            </Badge>
                          </TableCell>
                          <TableCell className="min-w-[200px]">
                            <div className="flex items-center gap-1">
                              <Input
                                value={fiscalNoteDraft[doc.id] ?? doc.gestoria_notes ?? ''}
                                onChange={(e) => setFiscalNoteDraft((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                                placeholder="Observación interna"
                                className="h-8 text-xs"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={fiscalActionId === doc.id}
                                onClick={() => handleFiscalDocNoteSave(doc.id)}
                                title="Guardar observación"
                              >
                                <PenLine className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm" variant="outline"
                                disabled={fiscalActionId === doc.id}
                                onClick={() => handleFiscalDocAction(doc.id, 'view')}
                                title="Ver"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                disabled={fiscalActionId === doc.id}
                                onClick={() => handleFiscalDocAction(doc.id, 'download')}
                                title="Descargar"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              {doc.status !== 'reviewed' ? (
                                <Button
                                  size="sm" variant="outline"
                                  disabled={fiscalActionId === doc.id}
                                  onClick={() => handleFiscalDocReview(doc.id, 'reviewed')}
                                  title="Marcar como revisado"
                                >
                                  <ClipboardCheck className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  size="sm" variant="outline"
                                  disabled={fiscalActionId === doc.id}
                                  onClick={() => handleFiscalDocReview(doc.id, 'available')}
                                  title="Desmarcar revisado"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── EXPORTAR A3 ─────────────────────────────────────────────────── */}
        <TabsContent value="exportaciones" className="mt-6 space-y-6">
          {/* Aviso: documentación fiscal complementaria del periodo actual */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-blue-800">
              <FileStack className="h-4 w-4 shrink-0" />
              <span>
                Documentación fiscal complementaria del periodo:{' '}
                <strong>{fiscalDocsQuarterCount ?? '…'}</strong> documento(s) este trimestre.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setActiveTab('documentacion-fiscal'); handleTabChange('documentacion-fiscal'); }}
            >
              Ver documentación fiscal
            </Button>
          </div>

          {/* Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Archive className="h-4 w-4" />
                Exportar documentos originales para A3
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Descarga los documentos originales (PDF/imagen) agrupados en archivos ZIP independientes,
                listos para importar en A3. Cada ZIP es completo y no necesitas unirlos.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Desde</label>
                  <Input
                    type="date"
                    value={exportFrom}
                    onChange={(e) => { setExportFrom(e.target.value); setExportPlan(null); }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Hasta</label>
                  <Input
                    type="date"
                    value={exportTo}
                    onChange={(e) => { setExportTo(e.target.value); setExportPlan(null); }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Tipo de factura</label>
                  <select
                    value={exportType}
                    onChange={(e) => { setExportType(e.target.value); setExportPlan(null); }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="all">Todas</option>
                    <option value="received">Solo recibidas</option>
                    <option value="issued">Solo emitidas</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Estado</label>
                  <select
                    value={exportStatus}
                    onChange={(e) => { setExportStatus(e.target.value); setExportPlan(null); }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="processed">Todas las procesadas</option>
                    <option value="approved_only">Solo aprobadas</option>
                  </select>
                </div>
              </div>

              <Button
                onClick={handlePrepareExport}
                disabled={loadingExportPlan || !exportFrom || !exportTo}
                className="w-full sm:w-auto"
              >
                {loadingExportPlan ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Calculando lotes…
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4 mr-2" />
                    Preparar descarga
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          {exportPlan && exportPlan.totalDocuments > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Documentos preparados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-1">
                  <p>
                    <span className="font-medium">Total documentos:</span>{' '}
                    {exportPlan.totalDocuments.toLocaleString('es-ES')}
                  </p>
                  <p>
                    <span className="font-medium">Tamaño estimado:</span>{' '}
                    {exportPlan.totalEstimatedSizeMB} MB (aprox.)
                  </p>
                  <p>
                    <span className="font-medium">Archivos ZIP:</span>{' '}
                    {exportPlan.batchCount}
                  </p>
                </div>

                {exportPlan.batchCount > 1 && (
                  <p className="text-sm text-muted-foreground rounded-md border border-blue-200 bg-blue-50 p-3">
                    Para evitar límites de servidor, se generan <strong>{exportPlan.batchCount} ZIPs pequeños e independientes</strong>.
                    Cada ZIP es completo y se abre directamente. <strong>No necesitas unirlos ni descomprimirlos juntos.</strong>
                  </p>
                )}

                <div className="space-y-2">
                  {exportPlan.batches.map((batch) => {
                    const zipUrl =
                      `/api/gestoria/clients/${params.clientCompanyId}/documents/export-zip` +
                      `?token=${encodeURIComponent(batch.token)}`;
                    const isDownloading = downloadingBatch === batch.batchIndex;
                    const batchError = downloadErrors[batch.batchIndex];
                    return (
                      <div
                        key={batch.batchIndex}
                        className="flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between rounded-md border p-3 gap-3">
                          <div className="text-sm">
                            <span className="font-medium">ZIP {batch.batchIndex + 1}</span>
                            <span className="text-muted-foreground ml-2">
                              Documentos {batch.fromItem}–{batch.toItem}
                              {' · '}
                              {batch.documentCount} archivos
                              {' · '}
                              ~{batch.estimatedSizeMB} MB
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isDownloading || downloadingBatch !== null}
                            onClick={() => handleDownloadZip(batch, zipUrl)}
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Descargando...
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5 mr-1.5" />
                                Descargar ZIP {batch.batchIndex + 1}
                              </>
                            )}
                          </Button>
                        </div>
                        {batchError && (
                          <p className="text-xs text-destructive px-1">{batchError}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  Los enlaces son válidos durante 1 hora. Pasado ese tiempo, pulsa de nuevo "Preparar descarga".
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Exportación trimestral completa (additive, no sustituye al ZIP A3) ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileStack className="h-4 w-4" />
                Exportación trimestral completa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Genera un ZIP con el resumen trimestral, las facturas del periodo y/o la documentación
                fiscal complementaria (contratos, escrituras, retenciones...), organizados en carpetas
                separadas. No sustituye a la exportación CSV habitual ni a Exportar A3.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Año</label>
                  <select
                    value={fiscalExportYear}
                    onChange={(e) => { setFiscalExportYear(Number(e.target.value)); setFiscalExportPlan(null); }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Periodo</label>
                  <select
                    value={String(fiscalExportQuarter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFiscalExportQuarter(v === 'annual' ? 'annual' : Number(v));
                      setFiscalExportPlan(null);
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="1">Q1</option>
                    <option value="2">Q2</option>
                    <option value="3">Q3</option>
                    <option value="4">Q4</option>
                    <option value="annual">Año completo</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Contenido</label>
                  <select
                    value={fiscalExportMode}
                    onChange={(e) => { setFiscalExportMode(e.target.value as any); setFiscalExportPlan(null); }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="csv">Solo CSV (resumen + facturas)</option>
                    <option value="fiscal">Solo documentación fiscal</option>
                    <option value="complete">Exportación completa</option>
                  </select>
                </div>
              </div>

              <Button
                onClick={handlePrepareFiscalExport}
                disabled={loadingFiscalExportPlan}
                className="w-full sm:w-auto"
              >
                {loadingFiscalExportPlan ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Calculando…
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4 mr-2" />
                    Preparar exportación
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {fiscalExportPlan && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {fiscalExportPlan.periodLabel} · {fiscalExportPlan.totalDocuments} documento(s) fiscal(es)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {fiscalExportPlan.batchCount > 1 && (
                  <p className="text-sm text-muted-foreground rounded-md border border-blue-200 bg-blue-50 p-3">
                    Se generan <strong>{fiscalExportPlan.batchCount} ZIPs independientes</strong>. El primero
                    incluye los CSV; todos incluyen su parte de documentación fiscal.
                  </p>
                )}
                <div className="space-y-2">
                  {fiscalExportPlan.batches.map((batch) => {
                    const zipUrl =
                      `/api/gestoria/clients/${params.clientCompanyId}/fiscal-export/zip` +
                      `?token=${encodeURIComponent(batch.token)}`;
                    const isDownloading = downloadingFiscalBatch === batch.batchIndex;
                    const batchError = fiscalDownloadErrors[batch.batchIndex];
                    return (
                      <div key={batch.batchIndex} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between rounded-md border p-3 gap-3">
                          <div className="text-sm">
                            <span className="font-medium">ZIP {batch.batchIndex + 1}</span>
                            {batch.documentCount > 0 && (
                              <span className="text-muted-foreground ml-2">
                                {batch.documentCount} archivo(s) · ~{batch.estimatedSizeMB} MB
                              </span>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isDownloading || downloadingFiscalBatch !== null}
                            onClick={() => handleDownloadFiscalZip(batch, zipUrl)}
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Descargando...
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5 mr-1.5" />
                                Descargar ZIP {batch.batchIndex + 1}
                              </>
                            )}
                          </Button>
                        </div>
                        {batchError && <p className="text-xs text-destructive px-1">{batchError}</p>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── MENSAJES ────────────────────────────────────────────────────── */}
        <TabsContent value="mensajes" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4" />Mensajes enviados
              </CardTitle>
              <Button size="sm" onClick={() => setShowMessageModal(true)}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Nuevo mensaje
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loadingMessages ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages === null || messages.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aún no has enviado ningún mensaje a este cliente.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Mensaje</TableHead>
                      <TableHead>Entrega</TableHead>
                      <TableHead>Leído</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messages.map((msg) => (
                      <TableRow key={msg.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(msg.created_at).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{msg.subject}</Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-xs truncate text-muted-foreground">
                          {msg.body}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {msg.email_sent && (
                              <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs">Email</Badge>
                            )}
                            {msg.telegram_sent && (
                              <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100 text-xs">Telegram</Badge>
                            )}
                            {!msg.email_sent && !msg.telegram_sent && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {msg.read_at ? (
                            <div className="flex items-center gap-1 text-green-600 text-xs">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {new Date(msg.read_at).toLocaleDateString('es-ES')}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pendiente</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Trazabilidad modal ──────────────────────────────────────────── */}
      {traceDocId && (() => {
        const traceDoc = (documents ?? []).find((d) => d.id === traceDocId);
        if (!traceDoc) return null;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
              <div className="flex items-center justify-between p-5 border-b">
                <div>
                  <h2 className="text-base font-semibold">Trazabilidad del documento</h2>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]" title={traceDoc.original_filename}>
                    {traceDoc.original_filename}
                  </p>
                </div>
                <button onClick={() => setTraceDocId(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Estado actual</span>
                  <StatusBadge
                    status={getUnifiedStatus({
                      processingStatus: traceDoc.processing_status,
                      reviewStatus: traceDoc.invoice?.review_status,
                      gestoriaStatus: traceDoc.invoice?.gestoria_review_status,
                    })}
                    type="unified"
                  />
                </div>
                {traceDoc.invoice && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Factura: </span>
                    <span className="font-medium">{traceDoc.invoice.invoice_number}</span>
                    {traceDoc.invoice.supplier_name && (
                      <span className="text-muted-foreground"> · {traceDoc.invoice.supplier_name}</span>
                    )}
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">Progreso</p>
                  <DocumentTimeline
                    processingStatus={traceDoc.processing_status}
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
        );
      })()}

      {showMessageModal && detail && (
        <SendMessageModal
          open={showMessageModal}
          onClose={() => {
            setShowMessageModal(false);
            setMessages(null);
            loadMessages();
          }}
          clientCompanyId={params.clientCompanyId}
          clientName={detail.company.name}
        />
      )}

      {reviewModalInvoice && (
        <InvoiceReviewModal
          open={!!reviewModalInvoice}
          onClose={() => setReviewModalInvoice(null)}
          invoice={reviewModalInvoice}
          clientCompanyId={params.clientCompanyId}
          onReviewed={() => {
            setReviewModalInvoice(null);
            doFetchInvoices(true);
            if (revisionTabActivated.current) loadRevisionInvoices(revisionFilter);
          }}
        />
      )}

      {historyModalInvoice && (
        <InvoiceReviewHistoryModal
          open={!!historyModalInvoice}
          onClose={() => setHistoryModalInvoice(null)}
          invoice={historyModalInvoice}
          clientCompanyId={params.clientCompanyId}
        />
      )}

      {correctionModalInvoice && (
        <InvoiceCorrectionModal
          open={!!correctionModalInvoice}
          onClose={() => setCorrectionModalInvoice(null)}
          invoice={correctionModalInvoice}
          clientCompanyId={params.clientCompanyId}
          onProposed={() => {
            setCorrectionModalInvoice(null);
            toast.success('Propuesta enviada al cliente');
          }}
        />
      )}
    </div>
  );
}
