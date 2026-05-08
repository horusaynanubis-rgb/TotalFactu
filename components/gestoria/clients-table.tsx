'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Shield, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

interface License {
  id: string;
  status: string;
  assigned_at: string | null;
  client_company: { id: string; name: string; tax_id: string } | null;
  invitation: { email: string; accepted_at?: string | null } | null;
}

interface Pack {
  id: string;
  pack_size: number;
  licenses: License[];
}

interface Props {
  packs: Pack[];
  onRefresh: () => void;
  onResendInvitation?: (email: string) => void;
}

export function ClientsTable({ packs, onRefresh, onResendInvitation }: Props) {
  const clients = packs
    .flatMap((p) => p.licenses)
    .filter((l) => l.status === 'assigned' && l.client_company);

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
            {clients.map((license) => (
              <TableRow key={license.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{license.client_company?.name}</p>
                    <p className="text-xs text-muted-foreground">{license.client_company?.tax_id}</p>
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
                  {license.invitation?.accepted_at
                    ? new Date(license.invitation.accepted_at).toLocaleDateString('es-ES')
                    : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {onResendInvitation && license.invitation?.email && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onResendInvitation(license.invitation!.email)}
                        title="Reenviar invitación"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleRevoke(license.id)}
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
  );
}
