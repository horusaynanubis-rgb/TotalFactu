'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users, Package, Mail, CheckCircle, Clock, Loader2, Plus, ShoppingCart,
  FileText, AlertTriangle, UserX,
} from 'lucide-react';
import { InviteClientModal } from '@/components/gestoria/invite-client-modal';
import { ClientsTable } from '@/components/gestoria/clients-table';
import { InvitationsTable } from '@/components/gestoria/invitations-table';

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

export default function GestoriaPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (companyType === 'gestoria') {
      loadPacks();
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

  if (status === 'loading' || (status === 'authenticated' && companyType !== 'gestoria')) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
          <Button onClick={() => { setResendEmail(undefined); setShowInviteModal(true); }} disabled={availableLicenses === 0}>
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
            <p className="text-xs text-muted-foreground">{activePacks.length} pack{activePacks.length !== 1 ? 's' : ''} activo{activePacks.length !== 1 ? 's' : ''}</p>
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
        <Card>
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

      {/* KPIs — fila 2: actividad clientes */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturas este mes</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">—</div>
            <p className="text-xs text-muted-foreground">Sumando todos los clientes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendientes de revisión</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">—</div>
            <p className="text-xs text-muted-foreground">En cola de clientes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Errores de proceso</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">—</div>
            <p className="text-xs text-muted-foreground">Documentos con error</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin onboarding</CardTitle>
            <UserX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">—</div>
            <p className="text-xs text-muted-foreground">Configuración incompleta</p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de uso */}
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
