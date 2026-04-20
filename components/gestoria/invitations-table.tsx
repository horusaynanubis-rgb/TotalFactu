'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Mail, Clock, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface License {
  id: string;
  invitation: {
    id: string;
    email: string;
    status: string;
    created_at?: string;
    expires_at?: string;
  } | null;
}

interface Pack {
  id: string;
  licenses: License[];
}

interface Props {
  packs: Pack[];
  onRefresh: () => void;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
  pending: { label: 'Pendiente', variant: 'outline', icon: Clock },
  accepted: { label: 'Aceptada', variant: 'default', icon: CheckCircle },
  expired: { label: 'Expirada', variant: 'secondary', icon: XCircle },
  revoked: { label: 'Revocada', variant: 'destructive', icon: XCircle },
};

export function InvitationsTable({ packs, onRefresh }: Props) {
  const invitations = packs
    .flatMap((p) => p.licenses)
    .filter((l) => l.invitation !== null)
    .map((l) => ({ licenseId: l.id, ...l.invitation! }));

  const handleRevoke = async (invitationId: string) => {
    if (!confirm('¿Revocar esta invitación? La licencia quedará disponible nuevamente.')) return;
    try {
      const res = await fetch(`/api/gestoria/invitations/${invitationId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al revocar');
        return;
      }
      toast.success('Invitación revocada');
      onRefresh();
    } catch {
      toast.error('Error inesperado');
    }
  };

  if (invitations.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No has enviado invitaciones todavía.</p>
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
              <TableHead>Email</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Enviada</TableHead>
              <TableHead>Expira</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((inv) => {
              const cfg = statusConfig[inv.status] ?? statusConfig.pending;
              const Icon = cfg.icon;
              return (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.email}</TableCell>
                  <TableCell>
                    <Badge variant={cfg.variant} className="gap-1">
                      <Icon className="h-3 w-3" />
                      {cfg.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {inv.created_at ? new Date(inv.created_at).toLocaleDateString('es-ES') : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('es-ES') : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {inv.status === 'pending' && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleRevoke(inv.id)}>
                        Revocar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
