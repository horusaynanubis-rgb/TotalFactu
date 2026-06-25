'use client';

import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/input';
import { SendMessageModal } from '@/components/gestoria/send-message-modal';

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

interface MessageRow {
  id: string;
  subject: string;
  body: string;
  read_at: string | null;
  email_sent: boolean;
  telegram_sent: boolean;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docStatusBadge(status: string) {
  if (status === 'completed')
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Completado</Badge>;
  if (status === 'needs_review')
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Revisión</Badge>;
  if (status === 'failed')
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Error</Badge>;
  return <Badge variant="secondary">Procesando</Badge>;
}

function invoiceStatusBadge(status: string) {
  if (status === 'approved')
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Aprobada</Badge>;
  if (status === 'rejected')
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Rechazada</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pendiente</Badge>;
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

  // Invoices (lazy — loaded on first activation of Facturas tab)
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingMoreInvoices, setLoadingMoreInvoices] = useState(false);
  const [invoicesHasMore, setInvoicesHasMore] = useState(false);

  // Messages (lazy — loaded on first activation of Mensajes tab)
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);

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

  const loadDocuments = () => {
    if (documents !== null || loadingDocs) return;
    setLoadingDocs(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/documents?limit=50&offset=0`)
      .then((r) => r.json())
      .then((data) => {
        setDocuments(data.documents ?? []);
        setDocsHasMore(data.hasMore ?? false);
      })
      .catch(() => toast.error('Error cargando documentos'))
      .finally(() => setLoadingDocs(false));
  };

  const loadMoreDocuments = () => {
    if (!documents || loadingMoreDocs) return;
    setLoadingMoreDocs(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/documents?limit=50&offset=${documents.length}`)
      .then((r) => r.json())
      .then((data) => {
        setDocuments((prev) => [...(prev ?? []), ...(data.documents ?? [])]);
        setDocsHasMore(data.hasMore ?? false);
      })
      .catch(() => toast.error('Error cargando más documentos'))
      .finally(() => setLoadingMoreDocs(false));
  };

  const loadInvoices = () => {
    if (invoices !== null || loadingInvoices) return;
    setLoadingInvoices(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/invoices?limit=50&offset=0`)
      .then((r) => r.json())
      .then((data) => {
        setInvoices(data.invoices ?? []);
        setInvoicesHasMore(data.hasMore ?? false);
      })
      .catch(() => toast.error('Error cargando facturas'))
      .finally(() => setLoadingInvoices(false));
  };

  const loadMoreInvoices = () => {
    if (!invoices || loadingMoreInvoices) return;
    setLoadingMoreInvoices(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/invoices?limit=50&offset=${invoices.length}`)
      .then((r) => r.json())
      .then((data) => {
        setInvoices((prev) => [...(prev ?? []), ...(data.invoices ?? [])]);
        setInvoicesHasMore(data.hasMore ?? false);
      })
      .catch(() => toast.error('Error cargando más facturas'))
      .finally(() => setLoadingMoreInvoices(false));
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

  const loadMessages = () => {
    if (messages !== null || loadingMessages) return;
    setLoadingMessages(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/messages`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => toast.error('Error cargando mensajes'))
      .finally(() => setLoadingMessages(false));
  };

  const handleTabChange = (tab: string) => {
    if (tab === 'documentos' || tab === 'revision') loadDocuments();
    if (tab === 'facturas') loadInvoices();
    if (tab === 'mensajes') loadMessages();
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

  const reviewDocs = documents?.filter(
    (d) =>
      d.processing_status === 'needs_review' ||
      d.processing_status === 'failed' ||
      (d.confidence_score !== null && d.confidence_score < LOW_CONFIDENCE_THRESHOLD),
  ) ?? [];

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
      <Tabs defaultValue="resumen" onValueChange={handleTabChange}>
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
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />Documentos del cliente
                </span>
                {documents && documents.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {documents.length} documento{documents.length !== 1 ? 's' : ''}{docsHasMore ? '+' : ''}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingDocs ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : documents === null || documents.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin documentos todavía.</p>
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
                      <TableHead>Fecha subida</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium text-sm max-w-xs truncate">
                          {doc.original_filename}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {channelLabel(doc.source_channel)}
                        </TableCell>
                        <TableCell>{docStatusBadge(doc.processing_status)}</TableCell>
                        <TableCell>{confidenceBadge(doc.confidence_score)}</TableCell>
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
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {docsHasMore && (
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
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />Facturas del cliente
                </span>
                {invoices && invoices.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {invoices.length} factura{invoices.length !== 1 ? 's' : ''}{invoicesHasMore ? '+' : ''}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingInvoices ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : invoices === null || invoices.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin facturas todavía.</p>
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº Factura</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">IVA</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Confianza IA</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium text-sm">{inv.invoice_number}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {invoiceTypeLabel(inv.invoice_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate">
                          {inv.supplier_name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(inv.issue_date).toLocaleDateString('es-ES')}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {inv.subtotal.toFixed(2)} {inv.currency}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {inv.tax_amount.toFixed(2)} {inv.currency}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {inv.total_amount.toFixed(2)} {inv.currency}
                        </TableCell>
                        <TableCell>{confidenceBadge(inv.extraction_confidence)}</TableCell>
                        <TableCell>{invoiceStatusBadge(inv.review_status)}</TableCell>
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
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {invoicesHasMore && (
                  <div className="p-4 flex justify-center border-t">
                    <Button variant="outline" size="sm" onClick={loadMoreInvoices} disabled={loadingMoreInvoices}>
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
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Documentos que requieren atención
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingDocs ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : documents === null ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </div>
              ) : reviewDocs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-70" />
                  <p className="text-sm">Sin documentos pendientes de atención.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Archivo</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Confianza</TableHead>
                      <TableHead>Fecha subida</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewDocs.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium text-sm max-w-xs truncate">
                          {doc.original_filename}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {channelLabel(doc.source_channel)}
                        </TableCell>
                        <TableCell>{docStatusBadge(doc.processing_status)}</TableCell>
                        <TableCell>{confidenceBadge(doc.confidence_score)}</TableCell>
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
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── EXPORTAR A3 ─────────────────────────────────────────────────── */}
        <TabsContent value="exportaciones" className="mt-6 space-y-6">
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
                    Los documentos se han dividido en <strong>{exportPlan.batchCount} archivos ZIP independientes</strong>.
                    Cada ZIP es completo y se abre directamente. <strong>No necesitas unirlos ni descomprimirlos juntos.</strong>
                  </p>
                )}

                <div className="space-y-2">
                  {exportPlan.batches.map((batch) => {
                    const zipUrl =
                      `/api/gestoria/clients/${params.clientCompanyId}/documents/export-zip` +
                      `?token=${encodeURIComponent(batch.token)}`;
                    return (
                      <div
                        key={batch.batchIndex}
                        className="flex items-center justify-between rounded-md border p-3 gap-3"
                      >
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
                        <a href={zipUrl} download>
                          <Button variant="outline" size="sm">
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            Descargar ZIP {batch.batchIndex + 1}
                          </Button>
                        </a>
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
    </div>
  );
}
