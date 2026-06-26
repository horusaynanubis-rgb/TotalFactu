'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users, Package, Mail, CheckCircle, Clock, Loader2, Plus, ShoppingCart,
  FileText, AlertTriangle, UserX, ArrowRight, MessageSquare, CalendarDays,
  ClipboardCheck, FileWarning, TrendingUp, Activity,
} from 'lucide-react';
import { InviteClientModal } from '@/components/gestoria/invite-client-modal';
import { ClientsTable } from '@/components/gestoria/clients-table';
import { InvitationsTable } from '@/components/gestoria/invitations-table';

// ─── Types ────────────────────────────────────────────────────────────────────

interface License {
  id: string;
  status: string;
  assigned_at: string | null;
  client_company: { id: string; name: string; tax_id: string } | null;
  invitation: { id: string; email: string; status: string; created_at?: string; expires_at?: string; accepted_at?: string | null } | null;
}

interface Pack {
  id: string;
  pack_size: number;
  licenses_used: number;
  status: string;
  period_end: string | null;
  licenses: License[];
}

interface ClientDashboard {
  companyId: string;
  companyName: string;
  taxId: string;
  primaryStatus: string;
  pendingReviews: number;
  waitingClient: number;
  reviewedIssues: number;
  newDocs: number;
  unreadMessages: number;
  invoicesThisMonth: number;
  lastActivity: string | null;
  inactiveDays: number | null;
}

interface DashboardData {
  summary: {
    totalPendingReviews: number;
    totalWaitingClient: number;
    totalNewDocs: number;
    totalUnreadMessages: number;
    totalInvoicesThisMonth: number;
  };
  clients: ClientDashboard[];
}

// ─── Fiscal deadlines ─────────────────────────────────────────────────────────

interface FiscalDeadline {
  model: string;
  name: string;
  dueDate: Date;
  daysLeft: number;
  urgency: 'green' | 'yellow' | 'red';
}

function getQuarterlyDeadlines(today: Date): Date[] {
  const y = today.getFullYear();
  const candidates = [
    new Date(y, 0, 20),      // Jan 20
    new Date(y, 3, 20),      // Apr 20
    new Date(y, 6, 20),      // Jul 20
    new Date(y, 9, 20),      // Oct 20
    new Date(y + 1, 0, 20),  // Jan 20 next year
  ];
  const next = candidates.find((d) => d > today);
  return next ? [next] : [candidates[4]];
}

function getAnnualDeadline390(today: Date): Date {
  const thisYear = new Date(today.getFullYear(), 0, 30);
  return thisYear > today ? thisYear : new Date(today.getFullYear() + 1, 0, 30);
}

function computeFiscalDeadlines(today: Date): FiscalDeadline[] {
  const [qDeadline] = getQuarterlyDeadlines(today);
  const annualDeadline = getAnnualDeadline390(today);

  const quarterlyModels = [
    { model: '303', name: 'IVA trimestral' },
    { model: '111', name: 'Retenciones IRPF trabajadores' },
    { model: '115', name: 'Retenciones IRPF alquiler' },
    { model: '130', name: 'Pago fraccionado IRPF' },
  ];

  const deadlines: FiscalDeadline[] = quarterlyModels.map(({ model, name }) => {
    const daysLeft = Math.ceil((qDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return {
      model,
      name,
      dueDate: qDeadline,
      daysLeft,
      urgency: daysLeft <= 7 ? 'red' : daysLeft <= 15 ? 'yellow' : 'green',
    };
  });

  const days390 = Math.ceil((annualDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  deadlines.push({
    model: '390',
    name: 'Resumen anual IVA',
    dueDate: annualDeadline,
    daysLeft: days390,
    urgency: days390 <= 7 ? 'red' : days390 <= 15 ? 'yellow' : 'green',
  });

  return deadlines.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; border: string; badge: string }> = {
  reviewed_issue: {
    label: 'Incidencia detectada',
    dot: 'bg-red-500',
    border: 'border-l-red-500',
    badge: 'bg-red-100 text-red-700',
  },
  waiting_client: {
    label: 'Esperando cliente',
    dot: 'bg-yellow-400',
    border: 'border-l-yellow-400',
    badge: 'bg-yellow-100 text-yellow-700',
  },
  pending_review: {
    label: 'Revisión pendiente',
    dot: 'bg-orange-500',
    border: 'border-l-orange-500',
    badge: 'bg-orange-100 text-orange-700',
  },
  new_docs: {
    label: 'Documentos nuevos',
    dot: 'bg-blue-500',
    border: 'border-l-blue-500',
    badge: 'bg-blue-100 text-blue-700',
  },
  all_ok: {
    label: 'Todo correcto',
    dot: 'bg-green-500',
    border: 'border-l-green-500',
    badge: 'bg-green-100 text-green-700',
  },
  inactive_30: {
    label: 'Sin actividad 30d',
    dot: 'bg-gray-400',
    border: 'border-l-gray-400',
    badge: 'bg-gray-100 text-gray-600',
  },
  inactive_60: {
    label: 'Sin actividad 60d',
    dot: 'bg-gray-500',
    border: 'border-l-gray-500',
    badge: 'bg-gray-100 text-gray-700',
  },
  inactive_90: {
    label: 'Sin actividad +90d',
    dot: 'bg-gray-600',
    border: 'border-l-gray-600',
    badge: 'bg-gray-200 text-gray-800',
  },
};

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return 'Sin actividad';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  if (days < 30) return `Hace ${Math.floor(days / 7)} sem.`;
  return `Hace ${Math.floor(days / 30)} mes${Math.floor(days / 30) !== 1 ? 'es' : ''}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GestoriaPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [resendEmail, setResendEmail] = useState<string | undefined>(undefined);

  const companyType = (session?.user as any)?.companyType;

  useEffect(() => {
    if (status === 'authenticated' && companyType !== 'gestoria') {
      router.replace('/dashboard');
    }
  }, [status, companyType, router]);

  const loadPacks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gestoria/packs');
      const data = await res.json();
      setPacks(data.packs || []);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    setLoadingDashboard(true);
    try {
      const res = await fetch('/api/gestoria/dashboard');
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } finally {
      setLoadingDashboard(false);
    }
  };

  useEffect(() => {
    if (companyType === 'gestoria') {
      loadPacks();
      loadDashboard();
    }
  }, [companyType]);

  const totalLicenses = packs.reduce((sum, p) => sum + p.pack_size, 0);
  const usedLicenses = packs.reduce((sum, p) => sum + p.licenses_used, 0);
  const availableLicenses = totalLicenses - usedLicenses;
  const activePacks = packs.filter((p) => p.status === 'active');

  const allLicenses = packs.flatMap((p) => p.licenses);
  const assignedClients = allLicenses.filter((l) => l.status === 'assigned' && l.client_company);
  const pendingInvitations = allLicenses.filter((l) => l.invitation?.status === 'pending');

  const handleResendInvitation = (email: string) => {
    setResendEmail(email);
    setShowInviteModal(true);
  };

  const fiscalDeadlines = computeFiscalDeadlines(new Date());

  if (status === 'loading' || (status === 'authenticated' && companyType !== 'gestoria')) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const summary = dashboardData?.summary;
  const clientStatuses = dashboardData?.clients ?? [];
  const needsAttention = clientStatuses.filter(
    (c) => !['all_ok', 'inactive_30', 'inactive_60', 'inactive_90'].includes(c.primaryStatus),
  );
  const inactive = clientStatuses.filter((c) =>
    ['inactive_30', 'inactive_60', 'inactive_90'].includes(c.primaryStatus),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Panel Gestoría</h1>
          <p className="text-muted-foreground">Administra tus clientes y licencias</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push('/dashboard/billing')}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Comprar licencias
          </Button>
          <Button
            onClick={() => { setResendEmail(undefined); setShowInviteModal(true); }}
            disabled={availableLicenses === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Invitar cliente
          </Button>
        </div>
      </div>

      {/* KPIs — fila 1: licencias */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Licencias totales</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLicenses}</div>
            <p className="text-xs text-muted-foreground">
              {activePacks.length} pack{activePacks.length !== 1 ? 's' : ''} activo{activePacks.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disponibles</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{availableLicenses}</div>
            <p className="text-xs text-muted-foreground">Listas para asignar</p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/dashboard/gestoria/clients')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assignedClients.length}</div>
            <p className="text-xs text-muted-foreground">Con licencia asignada</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invitaciones pendientes</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{pendingInvitations.length}</div>
            <p className="text-xs text-muted-foreground">Esperando activación</p>
          </CardContent>
        </Card>
      </div>

      {/* KPIs — fila 2: actividad clientes (datos reales) */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturas este mes</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            ) : (
              <div className="text-2xl font-bold">{summary?.totalInvoicesThisMonth ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Suma de todos los clientes</p>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer hover:shadow-md transition-shadow ${
            (summary?.totalPendingReviews ?? 0) > 0 ? 'border-orange-200' : ''
          }`}
          onClick={() => needsAttention.length > 0
            ? document.getElementById('estado-clientes')?.scrollIntoView({ behavior: 'smooth' })
            : undefined}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendientes de revisión</CardTitle>
            <ClipboardCheck className={`h-4 w-4 ${(summary?.totalPendingReviews ?? 0) > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            ) : (
              <div className={`text-2xl font-bold ${(summary?.totalPendingReviews ?? 0) > 0 ? 'text-orange-600' : ''}`}>
                {summary?.totalPendingReviews ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Facturas sin revisar</p>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer hover:shadow-md transition-shadow ${
            (summary?.totalWaitingClient ?? 0) > 0 ? 'border-yellow-200' : ''
          }`}
          onClick={() => needsAttention.length > 0
            ? document.getElementById('estado-clientes')?.scrollIntoView({ behavior: 'smooth' })
            : undefined}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Esperando cliente</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${(summary?.totalWaitingClient ?? 0) > 0 ? 'text-yellow-500' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            ) : (
              <div className={`text-2xl font-bold ${(summary?.totalWaitingClient ?? 0) > 0 ? 'text-yellow-600' : ''}`}>
                {summary?.totalWaitingClient ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Acción pendiente del cliente</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Docs nuevos (7d)</CardTitle>
            <Activity className={`h-4 w-4 ${(summary?.totalNewDocs ?? 0) > 0 ? 'text-blue-500' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            ) : (
              <div className={`text-2xl font-bold ${(summary?.totalNewDocs ?? 0) > 0 ? 'text-blue-600' : ''}`}>
                {summary?.totalNewDocs ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Subidos últimos 7 días</p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de uso de licencias */}
      {totalLicenses > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Uso de licencias</span>
              <span className="text-sm text-muted-foreground">{usedLicenses} / {totalLicenses}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${totalLicenses > 0 ? (usedLicenses / totalLicenses) * 100 : 0}%` }}
              />
            </div>
            {availableLicenses === 0 && (
              <p className="text-xs text-orange-600 mt-2">
                No quedan licencias disponibles.{' '}
                <button className="underline" onClick={() => router.push('/dashboard/billing')}>
                  Compra más packs
                </button>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── ESTADO DE CLIENTES ──────────────────────────────────────────────── */}
      <Card id="estado-clientes">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Estado de mis clientes
            </CardTitle>
            {!loadingDashboard && (
              <div className="flex flex-wrap gap-1 text-xs">
                {needsAttention.length > 0 && (
                  <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">
                    {needsAttention.length} requieren atención
                  </Badge>
                )}
                {inactive.length > 0 && (
                  <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100">
                    {inactive.length} sin actividad
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingDashboard ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : clientStatuses.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No tienes clientes activos todavía.
            </div>
          ) : (
            <div className="divide-y">
              {clientStatuses.map((client) => {
                const cfg = STATUS_CONFIG[client.primaryStatus] ?? STATUS_CONFIG.all_ok;
                return (
                  <Link
                    key={client.companyId}
                    href={`/dashboard/gestoria/clients/${client.companyId}`}
                    className={`flex items-center gap-4 px-6 py-3 hover:bg-muted/30 transition-colors border-l-4 ${cfg.border}`}
                  >
                    {/* Status dot */}
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${cfg.dot}`} />

                    {/* Company name + status */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{client.companyName}</span>
                        <Badge className={`text-xs px-1.5 py-0 ${cfg.badge} hover:${cfg.badge}`}>
                          {cfg.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {client.taxId}
                        {' · '}
                        Última actividad: {formatRelativeDate(client.lastActivity)}
                      </p>
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-4 shrink-0">
                      {client.pendingReviews > 0 && (
                        <div className="text-center hidden sm:block" title="Facturas pendientes de revisión">
                          <p className="text-sm font-bold text-orange-600">{client.pendingReviews}</p>
                          <p className="text-xs text-muted-foreground">Revisar</p>
                        </div>
                      )}
                      {client.waitingClient > 0 && (
                        <div className="text-center hidden sm:block" title="Esperando respuesta del cliente">
                          <p className="text-sm font-bold text-yellow-600">{client.waitingClient}</p>
                          <p className="text-xs text-muted-foreground">Esp. cliente</p>
                        </div>
                      )}
                      {client.reviewedIssues > 0 && (
                        <div className="text-center hidden sm:block" title="Incidencias detectadas">
                          <p className="text-sm font-bold text-red-600">{client.reviewedIssues}</p>
                          <p className="text-xs text-muted-foreground">Incidencias</p>
                        </div>
                      )}
                      {client.newDocs > 0 && (
                        <div className="text-center hidden sm:block" title="Documentos nuevos (últimos 7 días)">
                          <p className="text-sm font-bold text-blue-600">{client.newDocs}</p>
                          <p className="text-xs text-muted-foreground">Docs nuevos</p>
                        </div>
                      )}
                      {client.unreadMessages > 0 && (
                        <div className="text-center hidden sm:block" title="Mensajes sin leer">
                          <p className="text-sm font-bold text-purple-600">{client.unreadMessages}</p>
                          <p className="text-xs text-muted-foreground">Sin leer</p>
                        </div>
                      )}
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── VENCIMIENTOS FISCALES + CLIENTES SIN ACTIVIDAD ─────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">

        {/* Próximos vencimientos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Próximos vencimientos fiscales
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {fiscalDeadlines.map((fd) => {
              const urgencyClasses = {
                green: { badge: 'bg-green-100 text-green-700', bar: 'bg-green-500' },
                yellow: { badge: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-500' },
                red: { badge: 'bg-red-100 text-red-700', bar: 'bg-red-500' },
              }[fd.urgency];

              return (
                <div
                  key={fd.model}
                  className={`flex items-center justify-between rounded-md border p-3 ${
                    fd.urgency === 'red' ? 'border-red-200 bg-red-50/50' :
                    fd.urgency === 'yellow' ? 'border-yellow-200 bg-yellow-50/50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${urgencyClasses.bar}`} />
                    <div>
                      <p className="text-sm font-medium">Modelo {fd.model}</p>
                      <p className="text-xs text-muted-foreground">{fd.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className={`${urgencyClasses.badge} hover:${urgencyClasses.badge} text-xs`}>
                      {fd.daysLeft <= 0 ? 'Vencido' : `${fd.daysLeft}d`}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fd.dueDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground pt-1">
              Fechas orientativas. Verifica con la AEAT.
            </p>
          </CardContent>
        </Card>

        {/* Clientes sin actividad */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserX className="h-4 w-4" />
              Clientes sin actividad reciente
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingDashboard ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : inactive.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                <CheckCircle className="h-6 w-6 mx-auto mb-1 text-green-500 opacity-70" />
                Todos los clientes tienen actividad reciente.
              </div>
            ) : (
              <div className="space-y-2">
                {inactive.map((client) => {
                  const days = client.inactiveDays ?? 0;
                  const urgency = days >= 90 ? 'red' : days >= 60 ? 'yellow' : 'gray';
                  const badgeCls = urgency === 'red'
                    ? 'bg-red-100 text-red-700'
                    : urgency === 'yellow'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600';

                  return (
                    <Link
                      key={client.companyId}
                      href={`/dashboard/gestoria/clients/${client.companyId}`}
                      className="flex items-center justify-between rounded-md border p-2.5 hover:bg-muted/30 transition-colors gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{client.companyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {client.lastActivity
                            ? `Último doc: ${new Date(client.lastActivity).toLocaleDateString('es-ES')}`
                            : 'Sin documentos registrados'}
                        </p>
                      </div>
                      <Badge className={`${badgeCls} hover:${badgeCls} text-xs shrink-0`}>
                        {days >= 90 ? '+90d' : days >= 60 ? '+60d' : '+30d'}
                      </Badge>
                    </Link>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-1">
                  Considera contactarles para verificar que siguen usando la plataforma.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── TABS: Clientes / Invitaciones / Packs ──────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="clients">
          <TabsList>
            <TabsTrigger value="clients">
              <Users className="mr-2 h-4 w-4" />
              Clientes ({assignedClients.length})
            </TabsTrigger>
            <TabsTrigger value="invitations">
              <Mail className="mr-2 h-4 w-4" />
              Invitaciones ({pendingInvitations.length})
            </TabsTrigger>
            <TabsTrigger value="packs">
              <Package className="mr-2 h-4 w-4" />
              Mis packs ({activePacks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clients" className="mt-4">
            <ClientsTable packs={packs} onRefresh={loadPacks} onResendInvitation={handleResendInvitation} />
          </TabsContent>

          <TabsContent value="invitations" className="mt-4">
            <InvitationsTable packs={packs} onRefresh={loadPacks} />
          </TabsContent>

          <TabsContent value="packs" className="mt-4">
            <div className="space-y-3">
              {packs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No tienes packs activos.</p>
                    <Button className="mt-4" onClick={() => router.push('/dashboard/billing')}>
                      Comprar pack
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                packs.map((pack) => (
                  <Card key={pack.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Package className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium">Pack de {pack.pack_size} licencias</p>
                            <p className="text-xs text-muted-foreground">
                              {pack.licenses_used} usadas · {pack.pack_size - pack.licenses_used} disponibles
                              {pack.period_end && ` · Vence ${new Date(pack.period_end).toLocaleDateString('es-ES')}`}
                            </p>
                          </div>
                        </div>
                        <Badge variant={pack.status === 'active' ? 'default' : 'secondary'}>
                          {pack.status === 'active' ? 'Activo' : pack.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <InviteClientModal
        open={showInviteModal}
        onClose={() => { setShowInviteModal(false); setResendEmail(undefined); }}
        onSuccess={loadPacks}
        availableLicenses={availableLicenses}
        defaultEmail={resendEmail}
      />
    </div>
  );
}
