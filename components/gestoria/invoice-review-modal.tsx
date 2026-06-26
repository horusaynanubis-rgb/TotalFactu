'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface InvoiceSummary {
  id: string;
  invoice_number: string;
  supplier_name: string;
  issue_date: string;
  gestoria_review_status: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceSummary;
  clientCompanyId: string;
  onReviewed: () => void;
}

const ISSUE_OPTIONS = [
  { value: 'amount',           label: 'Importe' },
  { value: 'supplier',         label: 'Proveedor' },
  { value: 'date',             label: 'Fecha' },
  { value: 'vat',              label: 'IVA' },
  { value: 'duplicate',        label: 'Duplicada' },
  { value: 'illegible',        label: 'Ilegible' },
  { value: 'missing_document', label: 'Falta documento' },
  { value: 'wrong_type',       label: 'Tipo emitida/recibida incorrecto' },
  { value: 'other',            label: 'Otra' },
] as const;

const STATUS_OPTIONS = [
  { value: 'reviewed_ok',     label: 'Correcta',             action: 'mark_correct' },
  { value: 'reviewed_issue',  label: 'Incorrecta',           action: 'mark_incorrect' },
  { value: 'waiting_client',  label: 'Pendiente de cliente', action: 'request_client_action' },
] as const;

export function InvoiceReviewModal({ open, onClose, invoice, clientCompanyId, onReviewed }: Props) {
  const [newStatus, setNewStatus] = useState<string>('reviewed_ok');
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [observations, setObservations] = useState('');
  const [clientComment, setClientComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    if (saving) return;
    setNewStatus('reviewed_ok');
    setSelectedIssues([]);
    setObservations('');
    setClientComment('');
    onClose();
  };

  const toggleIssue = (val: string) => {
    setSelectedIssues((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  };

  const handleSave = async () => {
    const option = STATUS_OPTIONS.find((o) => o.value === newStatus);
    if (!option) return;

    setSaving(true);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${clientCompanyId}/invoices/${invoice.id}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: option.action,
            newStatus,
            observations: observations || undefined,
            issueTypes: selectedIssues.length ? selectedIssues : undefined,
            clientComment: clientComment || undefined,
            visibleToClient: newStatus === 'waiting_client' && !!clientComment,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al guardar la revisión');
        return;
      }
      toast.success('Revisión guardada');
      onReviewed();
    } catch {
      toast.error('Error inesperado al guardar');
    } finally {
      setSaving(false);
    }
  };

  const showIssues = newStatus !== 'reviewed_ok';
  const showClientComment = newStatus === 'waiting_client';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Revisar factura</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoice.invoice_number} · {invoice.supplier_name} ·{' '}
            {new Date(invoice.issue_date).toLocaleDateString('es-ES')}
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Estado final */}
          <div className="space-y-2">
            <Label>Estado final</Label>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setNewStatus(opt.value); setSelectedIssues([]); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    newStatus === opt.value
                      ? opt.value === 'reviewed_ok'
                        ? 'bg-green-600 text-white border-green-600'
                        : opt.value === 'reviewed_issue'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-yellow-500 text-white border-yellow-500'
                      : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Incidencias */}
          {showIssues && (
            <div className="space-y-2">
              <Label>Incidencias detectadas</Label>
              <div className="grid grid-cols-2 gap-2">
                {ISSUE_OPTIONS.map((issue) => (
                  <div key={issue.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`issue-${issue.value}`}
                      checked={selectedIssues.includes(issue.value)}
                      onCheckedChange={() => toggleIssue(issue.value)}
                    />
                    <label
                      htmlFor={`issue-${issue.value}`}
                      className="text-sm cursor-pointer leading-tight"
                    >
                      {issue.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Observaciones internas */}
          <div className="space-y-1.5">
            <Label htmlFor="observations">Observaciones internas</Label>
            <Textarea
              id="observations"
              placeholder="Notas internas de la gestoría (no visibles al cliente)..."
              rows={3}
              maxLength={1000}
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              className="resize-none"
            />
            <p className="text-xs text-right text-muted-foreground">
              {1000 - observations.length} caracteres restantes
            </p>
          </div>

          {/* Comentario para cliente */}
          {showClientComment && (
            <div className="space-y-1.5">
              <Label htmlFor="client-comment">
                Comentario para el cliente{' '}
                <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Textarea
                id="client-comment"
                placeholder="Este mensaje se enviará al cliente por email/Telegram..."
                rows={3}
                maxLength={500}
                value={clientComment}
                onChange={(e) => setClientComment(e.target.value)}
                className="resize-none"
              />
              <p className="text-xs text-right text-muted-foreground">
                {500 - clientComment.length} caracteres restantes
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Guardar revisión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
