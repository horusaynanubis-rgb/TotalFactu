'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Shield, RotateCcw, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

// Fed directly by GET /api/gestoria/clients — the single source that already
// merges LEGACY (License-based) and NEW MODEL (GestoriaClientRelation-based)
// clients for a firm, deduplicated. This makes the main dashboard's
// "Clientes" tab and the dedicated /dashboard/gestoria/clients page share
// the exact same data shape instead of each deriving their own list.
export interface ClientRow {
  source: 'license' | 'relation';
  licenseId: string | null;
  relationId: string | null;
  company: { id: string; name: string; tax_id: string } | null;
  email: string | undefined;
  acceptedAt: string | null | undefined;
}

interface Props {
  clients: ClientRow[];
  onRefresh: () => void;
  onResendInvitation?: (email: string) => void;
}

export function ClientsTable({ clients, onRefresh, onResendInvitation }: Props) {
  const handleRevoke = async (licenseId: string) => {
    if (!confirm('¿Revocar la licencia de este cliente? Perderá acceso al finalizar el periodo.')) return;
    try {
      const res = await fetch(`/api/gestoria/licenses/${licenseId}/revoke`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al revocar');
        return;
      }
      toast.success('Licencia revocada');
      onRefresh();
    } catch {
      toast.error('Error inesperado');
    }
  };

  // NEW MODEL equivalent — ends the management relation, no license/seat
  // involved. See app/api/gestoria/company-relations/[id]/route.ts.
  const handleRemoveRelation = async (relationId: string) => {
    if (!confirm('¿Quitar esta empresa de tu cartera? Podrás volver a invitarla más adelante.')) return;
    try {
      const res = await fetch(`/api/gestoria/company-relations/${relationId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al quitar la empresa');
        return;
      }
      toast.success('Empresa quitada de tu cartera');
      onRefresh();
    } catch {
      toast.error('Error inesperado');
    }
  };

  if (clients.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No tienes clientes activos todavía.</p>
          <p className="text-sm text-muted-foreground mt-1">Envía una invitación para empezar.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Facturas este mes</TableHead>
              <TableHead>Pendientes</TableHead>
              <TableHead>Última actividad</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.licenseId ?? client.relationId}>
                <TableCell>
                  <div>
                    <p className="font-medium">{client.company?.name}</p>
                    <p className="text-xs text-muted-foreground">{client.company?.tax_id}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100">
                    <Shield className="mr-1 h-3 w-3" />
                    Activo
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">—</TableCell>
                <TableCell className="text-sm text-muted-foreground">—</TableCell>
                <TableCell className="text-sm text-muted-foreground">—</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {client.acceptedAt ? new Date(client.acceptedAt).toLocaleDateString('es-ES') : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {client.company?.id && (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/gestoria/clients/${client.company.id}`}>
                          Ver
                          <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                    {onResendInvitation && client.source === 'license' && client.email && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onResendInvitation(client.email!)}
                        title="Reenviar invitación"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {client.source === 'license' && client.licenseId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRevoke(client.licenseId!)}
                      >
                        Revocar
                      </Button>
                    )}
                    {client.source === 'relation' && client.relationId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRemoveRelation(client.relationId!)}
                      >
                        Quitar
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
