'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ReviewLog {
  id: string;
  action: string;
  previous_status: string | null;
  new_status: string;
  observations: string | null;
  internal_notes: string | null;
  issue_types: string | null;
  client_comment: string | null;
  visible_to_client: boolean;
  created_at: string;
  reviewer: { id: string; name: string; email: string };
}

interface InvoiceSummary {
  id: string;
  invoice_number: string;
  supplier_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceSummary;
  clientCompanyId: string;
}

const ACTION_LABELS: Record<string, string> = {
  mark_correct:            'Marcada correcta',
  mark_incorrect:          'Marcada incorrecta',
  mark_pending:            'Marcada pendiente',
  add_note:                'Nota añadida',
  request_client_action:   'Acción solicitada al cliente',
  correction_detected:     'Corrección detectada',
};

const STATUS_LABELS: Record<string, string> = {
  reviewed_ok:    'Correcta',
  reviewed_issue: 'Incorrecta',
  waiting_client: 'Esp. cliente',
  pending_review: 'Pendiente',
  corrected:      'Corregida',
  ignored:        'Ignorada',
};

const ISSUE_LABELS: Record<string, string> = {
  amount:           'Importe',
  supplier:         'Proveedor',
  date:             'Fecha',
  vat:              'IVA',
  duplicate:        'Duplicada',
  illegible:        'Ilegible',
  missing_document: 'Falta doc.',
  wrong_type:       'Tipo incorrecto',
  other:            'Otra',
};

function statusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const label = STATUS_LABELS[status] ?? status;
  if (status === 'reviewed_ok' || status === 'corrected')
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">{label}</Badge>;
  if (status === 'reviewed_issue')
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-xs">{label}</Badge>;
  if (status === 'waiting_client')
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 text-xs">{label}</Badge>;
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
}

export function InvoiceReviewHistoryModal({ open, onClose, invoice, clientCompanyId }: Props) {
  const [logs, setLogs] = useState<ReviewLog[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/gestoria/clients/${clientCompanyId}/invoices/${invoice.id}/review`)
      .then((r) => r.json())
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => toast.error('Error cargando historial'))
      .finally(() => setLoading(false));
  }, [open, invoice.id, clientCompanyId]);

  const handleClose = () => {
    setLogs(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de revisión</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoice.invoice_number} · {invoice.supplier_name}
          </p>
        </DialogHeader>

        <div className="mt-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              Sin revisiones registradas todavía.
            </div>
          ) : (
            <ol className="relative border-l border-muted ml-3 space-y-6">
              {logs.map((log) => {
                const issues: string[] = log.issue_types ? JSON.parse(log.issue_types) : [];
                return (
                  <li key={log.id} className="ml-4">
                    <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-background bg-muted-foreground/40" />

                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-xs font-medium">{log.reviewer.name}</span>
                    </div>

                    <p className="text-sm font-medium mb-1">
                      {ACTION_LABELS[log.action] ?? log.action}
                    </p>

                    {/* Status transition */}
                    <div className="flex items-center gap-2 mb-2">
                      {statusBadge(log.previous_status)}
                      <span className="text-xs text-muted-foreground">→</span>
                      {statusBadge(log.new_status)}
                    </div>

                    {/* Issues */}
                    {issues.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {issues.map((iss) => (
                          <Badge key={iss} variant="outline" className="text-xs">
                            {ISSUE_LABELS[iss] ?? iss}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Observations */}
                    {log.observations && (
                      <p className="text-sm text-muted-foreground bg-muted/50 rounded px-2 py-1">
                        {log.observations}
                      </p>
                    )}

                    {/* Client comment */}
                    {log.client_comment && (
                      <p className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 mt-1">
                        Comentario al cliente: {log.client_comment}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
