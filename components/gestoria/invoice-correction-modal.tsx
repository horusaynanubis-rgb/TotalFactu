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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Field definitions ────────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: { value: string; label: string }[];
}

const CORRECTABLE_FIELDS: FieldDef[] = [
  { key: 'invoice_number', label: 'Nº Factura',             type: 'text' },
  { key: 'issue_date',     label: 'Fecha de emisión',       type: 'date' },
  { key: 'supplier_name',  label: 'Proveedor',              type: 'text' },
  { key: 'subtotal',       label: 'Base imponible',         type: 'number' },
  { key: 'tax_amount',     label: 'IVA',                    type: 'number' },
  { key: 'total_amount',   label: 'Total',                  type: 'number' },
  { key: 'tax_rate',       label: 'Tipo IVA %',             type: 'number' },
  { key: 'category',       label: 'Categoría',              type: 'text' },
  {
    key: 'invoice_type',
    label: 'Tipo (recibida/emitida)',
    type: 'select',
    options: [
      { value: 'received', label: 'Recibida' },
      { value: 'issued',   label: 'Emitida' },
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceSummary {
  id: string;
  invoice_number: string;
  supplier_name: string;
  issue_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  invoice_type: string;
  tax_rate: number | null;
  category: string | null;
  extraction_confidence?: number;
}

interface FieldChange {
  field: string;
  label: string;
  currentValue: string;
  proposedValue: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceSummary;
  clientCompanyId: string;
  onProposed: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentValue(invoice: InvoiceSummary, fieldKey: string): string {
  const map: Record<string, () => string> = {
    invoice_number: () => invoice.invoice_number ?? '',
    issue_date:     () => invoice.issue_date ? new Date(invoice.issue_date).toISOString().split('T')[0] : '',
    supplier_name:  () => invoice.supplier_name ?? '',
    subtotal:       () => String(invoice.subtotal ?? ''),
    tax_amount:     () => String(invoice.tax_amount ?? ''),
    total_amount:   () => String(invoice.total_amount ?? ''),
    tax_rate:       () => invoice.tax_rate != null ? String(invoice.tax_rate) : '',
    category:       () => invoice.category ?? '',
    invoice_type:   () => invoice.invoice_type ?? '',
  };
  return (map[fieldKey] ?? (() => ''))();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceCorrectionModal({ open, onClose, invoice, clientCompanyId, onProposed }: Props) {
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [proposedValues, setProposedValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [clientComment, setClientComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    if (saving) return;
    setSelectedFields([]);
    setProposedValues({});
    setReason('');
    setClientComment('');
    onClose();
  };

  const toggleField = (key: string) => {
    setSelectedFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const setProposed = (key: string, val: string) => {
    setProposedValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async () => {
    if (selectedFields.length === 0) {
      toast.error('Selecciona al menos un campo a corregir');
      return;
    }

    const fieldChanges: FieldChange[] = selectedFields
      .map((key) => {
        const def = CORRECTABLE_FIELDS.find((f) => f.key === key)!;
        return {
          field: key,
          label: def.label,
          currentValue: getCurrentValue(invoice, key),
          proposedValue: (proposedValues[key] ?? '').trim(),
        };
      })
      .filter((fc) => fc.proposedValue !== '');

    if (fieldChanges.length === 0) {
      toast.error('Introduce al menos un valor propuesto');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `/api/gestoria/clients/${clientCompanyId}/invoices/${invoice.id}/corrections`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fieldChanges,
            reason: reason.trim() || undefined,
            clientComment: clientComment.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al proponer corrección');
        return;
      }
      toast.success('Corrección propuesta enviada al cliente');
      onProposed();
    } catch {
      toast.error('Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proponer corrección</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoice.invoice_number} · {invoice.supplier_name} ·{' '}
            {new Date(invoice.issue_date).toLocaleDateString('es-ES')}
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Field selection + proposed values */}
          <div className="space-y-3">
            <Label>Campos a corregir</Label>
            <div className="border rounded-lg divide-y">
              {CORRECTABLE_FIELDS.map((field) => {
                const selected = selectedFields.includes(field.key);
                const current = getCurrentValue(invoice, field.key);

                return (
                  <div key={field.key} className={`p-3 space-y-2 transition-colors ${selected ? 'bg-orange-50/50' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`field-${field.key}`}
                        checked={selected}
                        onCheckedChange={() => toggleField(field.key)}
                      />
                      <label
                        htmlFor={`field-${field.key}`}
                        className="text-sm font-medium cursor-pointer flex-1"
                      >
                        {field.label}
                      </label>
                      {current && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          Actual: {field.key === 'invoice_type'
                            ? (current === 'received' ? 'Recibida' : 'Emitida')
                            : current}
                        </span>
                      )}
                    </div>

                    {selected && (
                      <div className="ml-7">
                        <Label className="text-xs text-muted-foreground mb-1 block">Valor propuesto</Label>
                        {field.type === 'select' ? (
                          <select
                            value={proposedValues[field.key] ?? ''}
                            onChange={(e) => setProposed(field.key, e.target.value)}
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">Selecciona...</option>
                            {field.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            type={field.type}
                            value={proposedValues[field.key] ?? ''}
                            onChange={(e) => setProposed(field.key, e.target.value)}
                            placeholder={`Nuevo valor para ${field.label.toLowerCase()}`}
                            className="h-9"
                            step={field.type === 'number' ? '0.01' : undefined}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="reason">Motivo / justificación</Label>
            <Textarea
              id="reason"
              placeholder="Explica por qué propones esta corrección..."
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Client comment */}
          <div className="space-y-1.5">
            <Label htmlFor="client-comment">
              Comentario para el cliente{' '}
              <span className="text-muted-foreground font-normal text-xs">(se notificará por email/Telegram)</span>
            </Label>
            <Textarea
              id="client-comment"
              placeholder="Mensaje que verá el cliente en su notificación..."
              rows={3}
              maxLength={500}
              value={clientComment}
              onChange={(e) => setClientComment(e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Summary */}
          {selectedFields.length > 0 && (
            <div className="rounded-md bg-muted/50 border p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">Resumen de la propuesta:</p>
              {selectedFields.map((key) => {
                const def = CORRECTABLE_FIELDS.find((f) => f.key === key)!;
                const current = getCurrentValue(invoice, key);
                const proposed = (proposedValues[key] ?? '').trim();
                return (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="font-medium w-32 shrink-0">{def.label}:</span>
                    <span className="text-muted-foreground line-through">{current || '—'}</span>
                    <span>→</span>
                    <span className="font-medium text-orange-700">{proposed || '(vacío)'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || selectedFields.length === 0}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar propuesta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
