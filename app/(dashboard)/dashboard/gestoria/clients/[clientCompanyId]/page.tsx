'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  XCircle,
  AlertCircle,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';

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
  recentDocuments: {
    id: string;
    original_filename: string;
    processing_status: string;
    upload_timestamp: string;
    source_channel: string;
  }[];
  recentExports: ExportRow[];
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

function docStatusBadge(status: string) {
  if (status === 'completed')
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Completado</Badge>;
  if (status === 'needs_review')
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Revisión</Badge>;
  if (status === 'failed')
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Error</Badge>;
  return <Badge variant="secondary">Procesando</Badge>;
}

function channelLabel(ch: string) {
  if (ch === 'telegram') return 'Telegram';
  if (ch === 'email') return 'Email';
  return 'Web';
}

function periodLabel(start: string, end: string, type: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (type === 'monthly') {
    return s.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  }
  const q = Math.floor(s.getMonth() / 3) + 1;
  return `T${q} ${s.getFullYear()}`;
}

export default function ClientDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams<{ clientCompanyId: string }>();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const companyType = (session?.user as any)?.companyType;

  useEffect(() => {
    if (status === 'authenticated' && companyType !== 'gestoria') {
      router.replace('/dashboard');
    }
  }, [status, companyType, router]);

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
      .finally(() => setLoading(false));
  }, [companyType, params.clientCompanyId, router]);

  const handleDownload = async (exportId: string) => {
    setDownloadingId(exportId);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${params.clientCompanyId}/exports/${exportId}/download`,
      );
      if (!res.ok) {
        toast.error('No se pudo obtener el enlace de descarga');
        return;
      }
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, '_blank');
    } catch {
      toast.error('Error al descargar');
    } finally {
      setDownloadingId(null);
    }
  };

  if (status === 'loading' || (status === 'authenticated' && companyType !== 'gestoria') || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) return null;

  const { company, license, telegramLinked, invoicesThisMonth, pendingReviews, totalExports, recentDocuments, recentExports } = detail;

  return (
    <div className="space-y-6">
      {/* Back navigation */}
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

      {/* Section A: Summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Mail className="h-4 w-4" />
              Email
            </div>
            <p className="font-medium text-sm truncate">{license?.invitation?.email ?? company.export_email}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Calendar className="h-4 w-4" />
              Fecha de alta
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
              <MessageCircle className="h-4 w-4" />
              Telegram
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
              <Download className="h-4 w-4" />
              Exportaciones
            </div>
            <p className="text-2xl font-bold">{totalExports}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <FileText className="h-4 w-4" />
              Facturas procesadas este mes
            </div>
            <p className="text-2xl font-bold">{invoicesThisMonth}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              Pendientes de revisión
            </div>
            <p className={`text-2xl font-bold ${pendingReviews > 0 ? 'text-yellow-600' : ''}`}>
              {pendingReviews}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Section B: Exports */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            Exportaciones CSV
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
                  <TableHead>Fecha generación</TableHead>
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
                        disabled={downloadingId === exp.id}
                        onClick={() => handleDownload(exp.id)}
                      >
                        {downloadingId === exp.id ? (
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

      {/* Section C: Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Actividad reciente
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentDocuments.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin documentos procesados todavía.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDocuments.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium text-sm max-w-xs truncate">
                      {doc.original_filename}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {channelLabel(doc.source_channel)}
                    </TableCell>
                    <TableCell>{docStatusBadge(doc.processing_status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(doc.upload_timestamp).toLocaleDateString('es-ES')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
