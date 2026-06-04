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
} from 'lucide-react';
import toast from 'react-hot-toast';

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

  // Invoices (lazy — loaded on first activation of Facturas tab)
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Per-document action loading
  const [actionDocId, setActionDocId] = useState<string | null>(null);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);

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
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/documents`)
      .then((r) => r.json())
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => toast.error('Error cargando documentos'))
      .finally(() => setLoadingDocs(false));
  };

  const loadInvoices = () => {
    if (invoices !== null || loadingInvoices) return;
    setLoadingInvoices(true);
    fetch(`/api/gestoria/clients/${params.clientCompanyId}/invoices`)
      .then((r) => r.json())
      .then((data) => setInvoices(data.invoices ?? []))
      .catch(() => toast.error('Error cargando facturas'))
      .finally(() => setLoadingInvoices(false));
  };

  const handleTabChange = (tab: string) => {
    if (tab === 'documentos' || tab === 'revision') loadDocuments();
    if (tab === 'facturas') loadInvoices();
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
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />Documentos del cliente
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── FACTURAS ────────────────────────────────────────────────────── */}
        <TabsContent value="facturas" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />Facturas del cliente
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
      </Tabs>
    </div>
  );
}
