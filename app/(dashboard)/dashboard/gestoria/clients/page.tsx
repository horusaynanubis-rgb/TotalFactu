'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Users,
  Loader2,
  Search,
  ChevronRight,
  CheckCircle2,
  Clock,
  MessageCircle,
  MessageCircleOff,
  AlertCircle,
  ArrowLeft,
  RotateCcw,
  Download,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SendMessageModal } from '@/components/gestoria/send-message-modal';

interface ClientRow {
  licenseId: string;
  licenseStatus: string;
  assignedAt: string | null;
  company: {
    id: string;
    name: string;
    tax_id: string;
    created_at: string;
    export_email: string;
  } | null;
  email: string | undefined;
  acceptedAt: string | null | undefined;
  telegramLinked: boolean;
  invoicesThisMonth: number;
  pendingReviews: number;
  lastActivity: string | null;
  lastExport: {
    id: string;
    created_at: string;
    export_type: string;
    period_start: string;
    period_end: string;
  } | null;
}

type Filter = 'all' | 'active' | 'pending' | 'no_telegram' | 'pending_review';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos' },
  { id: 'pending', label: 'Sin Telegram' },
  { id: 'no_telegram', label: 'Sin Telegram' },
  { id: 'pending_review', label: 'Con revisión pendiente' },
];

const DISPLAY_FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos' },
  { id: 'no_telegram', label: 'Sin Telegram' },
  { id: 'pending_review', label: 'Con revisión pendiente' },
];

function applyFilter(clients: ClientRow[], filter: Filter, search: string): ClientRow[] {
  let filtered = clients;

  if (filter === 'active') filtered = filtered.filter((c) => !!c.acceptedAt);
  else if (filter === 'pending') filtered = filtered.filter((c) => !c.acceptedAt);
  else if (filter === 'no_telegram') filtered = filtered.filter((c) => !c.telegramLinked);
  else if (filter === 'pending_review') filtered = filtered.filter((c) => c.pendingReviews > 0);

  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.company?.name.toLowerCase().includes(q) ||
        c.company?.tax_id.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }

  return filtered;
}

export default function GestoriaClientsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [messageTarget, setMessageTarget] = useState<{ id: string; name: string } | null>(null);

  const companyType = (session?.user as any)?.companyType;

  useEffect(() => {
    if (status === 'authenticated' && companyType !== 'gestoria') {
      router.replace('/dashboard');
    }
  }, [status, companyType, router]);

  useEffect(() => {
    if (companyType !== 'gestoria') return;
    fetch('/api/gestoria/clients')
      .then((r) => r.json())
      .then((data) => setClients(data.clients ?? []))
      .catch(() => toast.error('Error cargando clientes'))
      .finally(() => setLoading(false));
  }, [companyType]);

  const handleResendInvitation = async (email: string) => {
    try {
      const res = await fetch('/api/gestoria/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al reenviar');
        return;
      }
      toast.success(`Invitación reenviada a ${email}`);
    } catch {
      toast.error('Error inesperado');
    }
  };

  const handleRevoke = async (licenseId: string) => {
    if (!confirm('¿Revocar la licencia de este cliente? Perderá acceso al finalizar el periodo.'))
      return;
    try {
      const res = await fetch(`/api/gestoria/licenses/${licenseId}/revoke`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al revocar');
        return;
      }
      toast.success('Licencia revocada');
      setClients((prev) => prev.filter((c) => c.licenseId !== licenseId));
    } catch {
      toast.error('Error inesperado');
    }
  };

  if (status === 'loading' || (status === 'authenticated' && companyType !== 'gestoria')) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const visible = applyFilter(clients, filter, search);

  const activeCount = clients.filter((c) => !!c.acceptedAt).length;
  const noTelegramCount = clients.filter((c) => !c.telegramLinked).length;
  const pendingReviewCount = clients.filter((c) => c.pendingReviews > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/gestoria">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Panel Gestoría
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            {clients.length} cliente{clients.length !== 1 ? 's' : ''} con licencia asignada
          </p>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>{activeCount} activos</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageCircleOff className="h-4 w-4 text-orange-400" />
          <span>{noTelegramCount} sin Telegram</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <span>{pendingReviewCount} con revisiones pendientes</span>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex flex-wrap gap-2">
          {DISPLAY_FILTERS.map((f) => (
            <Button
              key={f.id}
              variant={filter === f.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa, NIF o email..."
            className="pl-9 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {clients.length === 0
                ? 'No tienes clientes con licencia asignada todavía.'
                : 'No hay clientes que coincidan con el filtro.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente / Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha alta</TableHead>
                  <TableHead>Telegram</TableHead>
                  <TableHead>Facturas (mes)</TableHead>
                  <TableHead>Pendientes</TableHead>
                  <TableHead>Última actividad</TableHead>
                  <TableHead>Última exportación</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((client) => (
                  <TableRow key={client.licenseId}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{client.company?.name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{client.company?.tax_id}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.email ?? '—'}
                    </TableCell>
                    <TableCell>
                      {client.acceptedAt ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-orange-100 text-orange-700 hover:bg-orange-100">
                          Pendiente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.assignedAt
                        ? new Date(client.assignedAt).toLocaleDateString('es-ES')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {client.telegramLinked ? (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 gap-1">
                          <MessageCircle className="h-3 w-3" />
                          Sí
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground gap-1">
                          <MessageCircleOff className="h-3 w-3" />
                          No
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {client.invoicesThisMonth > 0 ? (
                        <span>{client.invoicesThisMonth}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.pendingReviews > 0 ? (
                        <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 gap-1">
                          <Clock className="h-3 w-3" />
                          {client.pendingReviews}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.lastActivity
                        ? new Date(client.lastActivity).toLocaleDateString('es-ES')
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.lastExport ? (
                        <div>
                          <p>{new Date(client.lastExport.created_at).toLocaleDateString('es-ES')}</p>
                          <p className="text-xs capitalize">{client.lastExport.export_type}</p>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {client.company?.id && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/dashboard/gestoria/clients/${client.company.id}`}>
                              Ver detalle
                              <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                        {client.company?.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMessageTarget({ id: client.company!.id, name: client.company!.name })}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Mensaje
                          </Button>
                        )}
                        {!client.acceptedAt && client.email && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Reenviar invitación"
                            onClick={() => handleResendInvitation(client.email!)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRevoke(client.licenseId)}
                        >
                          Revocar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {messageTarget && (
        <SendMessageModal
          open={!!messageTarget}
          onClose={() => setMessageTarget(null)}
          clientCompanyId={messageTarget.id}
          clientName={messageTarget.name}
        />
      )}
    </div>
  );
}
