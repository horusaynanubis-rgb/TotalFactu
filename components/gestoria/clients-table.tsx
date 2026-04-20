'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Shield } from 'lucide-react';
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
}

export function ClientsTable({ packs, onRefresh }: Props) {
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
              <TableHead>Empresa</TableHead>
              <TableHead>NIF/CIF</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Activado</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((license) => (
              <TableRow key={license.id}>
                <TableCell className="font-medium">{license.client_company?.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{license.client_company?.tax_id}</TableCell>
                <TableCell className="text-sm">{license.invitation?.email ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {license.invitation?.accepted_at
                    ? new Date(license.invitation.accepted_at).toLocaleDateString('es-ES')
                    : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100">
                    <Shield className="mr-1 h-3 w-3" />
                    Activo
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleRevoke(license.id)}>
                    Revocar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
