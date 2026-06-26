'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DocumentPreviewModal } from '@/components/document-preview-modal';
import {
  Banknote, CreditCard, Smartphone, ArrowLeftRight, PackagePlus,
  Plus, Pencil, Trash2, Loader2, X, ChevronLeft, ChevronRight,
  Download, FileSpreadsheet, Bot, User2, FileImage, CheckCircle, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyCashRegister {
  id: string;
  date: string;
  cash_amount: string | number;
  card_amount: string | number;
  bizum_amount: string | number;
  transfer_amount: string | number;
  other_amount: string | number;
  total_amount: string | number;
  notes: string | null;
  source: 'manual' | 'ai';
  status: 'confirmed' | 'pending_review';
  document_id: string | null;
  ai_raw_data: string | null;
  document: { id: string; cloud_storage_path: string } | null;
}

interface MonthlySummary {
  cash_amount: number;
  card_amount: number;
  bizum_amount: number;
  transfer_amount: number;
  other_amount: number;
  total_amount: number;
}

interface FormState {
  date: string;
  cash_amount: string;
  card_amount: string;
  bizum_amount: string;
  transfer_amount: string;
  other_amount: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

function fmt(value: string | number, decimals = 2): string {
  return Number(value).toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtCurrency(value: string | number): string {
  return `${fmt(value)} €`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function emptyForm(defaultDate?: string): FormState {
  return {
    date:            defaultDate ?? new Date().toISOString().split('T')[0],
    cash_amount:     '',
    card_amount:     '',
    bizum_amount:    '',
    transfer_amount: '',
    other_amount:    '',
    notes:           '',
  };
}

function calcTotal(form: FormState): number {
  return (
    (parseFloat(form.cash_amount)     || 0) +
    (parseFloat(form.card_amount)     || 0) +
    (parseFloat(form.bizum_amount)    || 0) +
    (parseFloat(form.transfer_amount) || 0) +
    (parseFloat(form.other_amount)    || 0)
  );
}

function formToBody(form: FormState) {
  return {
    date:            form.date,
    cash_amount:     parseFloat(form.cash_amount)     || 0,
    card_amount:     parseFloat(form.card_amount)     || 0,
    bizum_amount:    parseFloat(form.bizum_amount)    || 0,
    transfer_amount: parseFloat(form.transfer_amount) || 0,
    other_amount:    parseFloat(form.other_amount)    || 0,
    notes:           form.notes.trim() || undefined,
  };
}

function registerToForm(r: DailyCashRegister): FormState {
  return {
    date:            new Date(r.date).toISOString().split('T')[0],
    cash_amount:     String(Number(r.cash_amount)),
    card_amount:     String(Number(r.card_amount)),
    bizum_amount:    String(Number(r.bizum_amount)),
    transfer_amount: String(Number(r.transfer_amount)),
    other_amount:    String(Number(r.other_amount)),
    notes:           r.notes ?? '',
  };
}

function getAiRawData(r: DailyCashRegister): Record<string, any> {
  try { return r.ai_raw_data ? JSON.parse(r.ai_raw_data) : {}; } catch { return {}; }
}

// ---------------------------------------------------------------------------
// CSV / Excel export helpers
// ---------------------------------------------------------------------------

function exportCSV(registers: DailyCashRegister[], year: number, month: number) {
  const header = 'Fecha,Efectivo,TPV,Bizum,Transferencias,Otros,Total,Origen,Observaciones';
  const rows = registers.map((r) => [
    new Date(r.date).toLocaleDateString('es-ES'),
    Number(r.cash_amount).toFixed(2),
    Number(r.card_amount).toFixed(2),
    Number(r.bizum_amount).toFixed(2),
    Number(r.transfer_amount).toFixed(2),
    Number(r.other_amount).toFixed(2),
    Number(r.total_amount).toFixed(2),
    r.source === 'ai' ? 'IA' : 'Manual',
    `"${(r.notes ?? '').replace(/"/g, '""')}"`,
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `caja-cobros-${year}-${String(month).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportXLSX(registers: DailyCashRegister[], year: number, month: number) {
  const header = ['Fecha','Efectivo','TPV','Bizum','Transferencias','Otros','Total','Origen','Observaciones'];
  const rows = registers.map((r) => [
    new Date(r.date).toLocaleDateString('es-ES'),
    Number(r.cash_amount).toFixed(2),
    Number(r.card_amount).toFixed(2),
    Number(r.bizum_amount).toFixed(2),
    Number(r.transfer_amount).toFixed(2),
    Number(r.other_amount).toFixed(2),
    Number(r.total_amount).toFixed(2),
    r.source === 'ai' ? 'IA' : 'Manual',
    r.notes ?? '',
  ]);

  const tableRows = [header, ...rows]
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"/></head><body><table>${tableRows}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `caja-cobros-${year}-${String(month).padStart(2, '0')}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({ label, value, icon: Icon, color }: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 truncate">{label}</p>
            <p className="text-xl font-bold text-gray-900 mt-0.5">{fmtCurrency(value)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Amount Input
// ---------------------------------------------------------------------------

function AmountInput({ label, id, value, onChange, icon: Icon }: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ElementType;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-sm">
        <Icon className="h-3.5 w-3.5 text-gray-400" />
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0,00"
          className="pr-7 h-9 text-right"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register Form (create / edit)
// ---------------------------------------------------------------------------

function RegisterForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  saving,
  isEdit,
}: {
  form: FormState;
  onChange: (updates: Partial<FormState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}) {
  const total = calcTotal(form);

  return (
    <div className="border rounded-xl p-5 bg-white shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">
          {isEdit ? 'Editar registro' : 'Nuevo registro diario'}
        </h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label htmlFor="reg-date">Fecha</Label>
        <Input
          id="reg-date"
          type="date"
          value={form.date}
          onChange={(e) => onChange({ date: e.target.value })}
          className="h-9 max-w-xs"
        />
      </div>

      {/* Amount fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <AmountInput label="Efectivo"       id="cash"     value={form.cash_amount}     onChange={(v) => onChange({ cash_amount: v })}     icon={Banknote} />
        <AmountInput label="TPV"            id="card"     value={form.card_amount}     onChange={(v) => onChange({ card_amount: v })}     icon={CreditCard} />
        <AmountInput label="Bizum"          id="bizum"    value={form.bizum_amount}    onChange={(v) => onChange({ bizum_amount: v })}    icon={Smartphone} />
        <AmountInput label="Transferencias" id="transfer" value={form.transfer_amount} onChange={(v) => onChange({ transfer_amount: v })} icon={ArrowLeftRight} />
        <AmountInput label="Otros"          id="other"    value={form.other_amount}    onChange={(v) => onChange({ other_amount: v })}    icon={PackagePlus} />
      </div>

      {/* Total preview */}
      <div className="flex items-center gap-3 rounded-lg bg-gray-50 border px-4 py-3">
        <span className="text-sm text-gray-500">Total calculado:</span>
        <span className="text-lg font-bold text-gray-900">{fmtCurrency(total)}</span>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="reg-notes">Observaciones <span className="text-gray-400 font-normal">(opcional)</span></Label>
        <textarea
          id="reg-notes"
          rows={2}
          maxLength={500}
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Incidencias, promociones, cierre de caja..."
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 justify-end pt-1">
        <Button variant="outline" onClick={onCancel} disabled={saving} className="h-9">
          Cancelar
        </Button>
        <Button onClick={onSubmit} disabled={saving || !form.date} className="h-9">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? 'Guardar cambios' : 'Guardar registro'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending AI Card (single)
// ---------------------------------------------------------------------------

function PendingAICard({
  register,
  onConfirm,
  onEdit,
  onReject,
  onViewDoc,
  acting,
}: {
  register: DailyCashRegister;
  onConfirm: () => void;
  onEdit: () => void;
  onReject: () => void;
  onViewDoc: () => void;
  acting: boolean;
}) {
  const raw = getAiRawData(register);

  return (
    <div className="border border-teal-200 rounded-xl p-4 bg-teal-50/40 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="text-sm font-semibold text-teal-800">Cierre detectado por IA</span>
          <span className="text-xs text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">Pendiente de confirmar</span>
        </div>
        <div className="text-xs text-gray-500 text-right">
          {raw.business_name && <p className="font-medium text-gray-700">{raw.business_name}</p>}
          {raw.terminal_id   && <p>Terminal: {raw.terminal_id}</p>}
          {raw.batch_number  && <p>Lote: {raw.batch_number}</p>}
        </div>
      </div>

      {/* Date + Amounts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
        <div>
          <span className="text-xs text-gray-400 block">Fecha</span>
          <span className="font-medium">{fmtDate(register.date)}</span>
        </div>
        {Number(register.card_amount) > 0 && (
          <div>
            <span className="text-xs text-gray-400 block">TPV</span>
            <span>{fmtCurrency(register.card_amount)}</span>
          </div>
        )}
        {Number(register.cash_amount) > 0 && (
          <div>
            <span className="text-xs text-gray-400 block">Efectivo</span>
            <span>{fmtCurrency(register.cash_amount)}</span>
          </div>
        )}
        {Number(register.bizum_amount) > 0 && (
          <div>
            <span className="text-xs text-gray-400 block">Bizum</span>
            <span>{fmtCurrency(register.bizum_amount)}</span>
          </div>
        )}
        {Number(register.transfer_amount) > 0 && (
          <div>
            <span className="text-xs text-gray-400 block">Transferencias</span>
            <span>{fmtCurrency(register.transfer_amount)}</span>
          </div>
        )}
        {Number(register.other_amount) > 0 && (
          <div>
            <span className="text-xs text-gray-400 block">Otros</span>
            <span>{fmtCurrency(register.other_amount)}</span>
          </div>
        )}
        <div>
          <span className="text-xs text-gray-400 block">Total</span>
          <span className="text-base font-bold text-gray-900">{fmtCurrency(register.total_amount)}</span>
        </div>
      </div>

      {register.notes && (
        <p className="text-xs text-gray-500 italic">{register.notes}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-teal-100">
        {register.document_id && (
          <button
            onClick={onViewDoc}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium text-gray-600 border hover:bg-gray-50 transition-colors"
          >
            <FileImage className="h-3.5 w-3.5" />
            Ver justificante
          </button>
        )}
        <Button
          size="sm"
          className="bg-teal-600 hover:bg-teal-700 text-white h-8 text-xs"
          disabled={acting}
          onClick={onConfirm}
        >
          {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle className="h-3.5 w-3.5 mr-1" />}
          Confirmar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={acting}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Editar y confirmar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50"
          disabled={acting}
          onClick={onReject}
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Descartar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CajaCobrosPage() {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [registers, setRegisters]   = useState<DailyCashRegister[]>([]);
  const [pendingAI, setPendingAI]   = useState<DailyCashRegister[]>([]);
  const [summary, setSummary]       = useState<MonthlySummary | null>(null);
  const [loading, setLoading]       = useState(true);

  const [showForm, setShowForm]       = useState(false);
  const [editId, setEditId]           = useState<string | null>(null);
  const [form, setForm]               = useState<FormState>(emptyForm());
  const [saving, setSaving]           = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [actingId, setActingId]       = useState<string | null>(null);

  const [previewDocId, setPreviewDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/caja-cobros?year=${year}&month=${month}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRegisters(data.registers ?? []);
      setPendingAI(data.pendingAI ?? []);
      setSummary(data.summary ?? null);
    } catch {
      toast.error('Error al cargar los registros');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const navMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1)  { m = 12; y--; }
    setMonth(m);
    setYear(y);
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (r: DailyCashRegister) => {
    setEditId(r.id);
    setForm(registerToForm(r));
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditId(null);
  };

  const handleSubmit = async () => {
    if (!form.date) { toast.error('La fecha es obligatoria'); return; }
    setSaving(true);
    try {
      const body = formToBody(form);

      // If editing a pending AI record, confirm it via the confirm endpoint
      if (editId) {
        const pendingRecord = pendingAI.find(r => r.id === editId);
        if (pendingRecord) {
          const res = await fetch(`/api/caja-cobros/${editId}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm', ...body }),
          });
          const data = await res.json();
          if (!res.ok) { toast.error(data.error ?? 'Error al confirmar'); return; }
          toast.success('Registro confirmado');
          setShowForm(false);
          setEditId(null);
          load();
          return;
        }
      }

      const url    = editId ? `/api/caja-cobros/${editId}` : '/api/caja-cobros';
      const method = editId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Error al guardar'); return; }
      toast.success(editId ? 'Registro actualizado' : 'Registro guardado');
      setShowForm(false);
      setEditId(null);
      load();
    } catch {
      toast.error('Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/caja-cobros/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Registro eliminado');
      load();
    } catch {
      toast.error('Error al eliminar');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAIConfirm = async (id: string) => {
    setActingId(id);
    try {
      const res = await fetch(`/api/caja-cobros/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Error'); return; }
      toast.success('Registro confirmado');
      load();
    } catch {
      toast.error('Error inesperado');
    } finally {
      setActingId(null);
    }
  };

  const handleAIReject = async (id: string) => {
    if (!confirm('¿Descartar este registro detectado por IA?')) return;
    setActingId(id);
    try {
      const res = await fetch(`/api/caja-cobros/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) throw new Error();
      toast.success('Registro descartado');
      load();
    } catch {
      toast.error('Error inesperado');
    } finally {
      setActingId(null);
    }
  };

  const updateForm = (updates: Partial<FormState>) => setForm((f) => ({ ...f, ...updates }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Caja y Cobros</h1>
          <p className="text-gray-500 mt-1 text-sm">Registro diario de cobros por método de pago</p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Nuevo registro
        </Button>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navMonth(-1)}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-base font-semibold text-gray-800 min-w-[160px] text-center">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          onClick={() => navMonth(1)}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border hover:bg-gray-50 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setMonth(today.getMonth() + 1); setYear(today.getFullYear()); }}
          className="ml-2 text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Hoy
        </button>
      </div>

      {/* ─── Pending AI Detections ─── */}
      {pendingAI.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-teal-600" />
            <h2 className="text-sm font-semibold text-teal-800">
              Cierres detectados por IA — pendientes de confirmar
            </h2>
            <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
              {pendingAI.length}
            </span>
          </div>
          <div className="space-y-3">
            {pendingAI.map((r) => (
              <PendingAICard
                key={r.id}
                register={r}
                acting={actingId === r.id}
                onConfirm={() => handleAIConfirm(r.id)}
                onEdit={() => { openEdit(r); }}
                onReject={() => handleAIReject(r.id)}
                onViewDoc={() => setPreviewDocId(r.document_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* KPI Summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Efectivo"       value={summary.cash_amount}     icon={Banknote}       color="bg-green-50  text-green-600" />
          <KpiCard label="TPV"            value={summary.card_amount}     icon={CreditCard}     color="bg-blue-50   text-blue-600" />
          <KpiCard label="Bizum"          value={summary.bizum_amount}    icon={Smartphone}     color="bg-purple-50 text-purple-600" />
          <KpiCard label="Transferencias" value={summary.transfer_amount} icon={ArrowLeftRight} color="bg-orange-50 text-orange-600" />
          <KpiCard label="Otros cobros"   value={summary.other_amount}    icon={PackagePlus}    color="bg-gray-100  text-gray-600" />
          <KpiCard label="Total mes"      value={summary.total_amount}    icon={Banknote}       color="bg-emerald-50 text-emerald-700" />
        </div>
      )}

      {/* Form */}
      {showForm && (
        <RegisterForm
          form={form}
          onChange={updateForm}
          onSubmit={handleSubmit}
          onCancel={cancelForm}
          saving={saving}
          isEdit={!!editId}
        />
      )}

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Registros confirmados — {MONTH_NAMES[month - 1]} {year}
            {!loading && (
              <span className="ml-2 text-sm font-normal text-gray-400">({registers.length})</span>
            )}
          </CardTitle>

          {/* Export buttons */}
          {registers.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportCSV(registers, year, month)}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium text-gray-600 border hover:bg-gray-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                onClick={() => exportXLSX(registers, year, month)}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium text-gray-600 border hover:bg-gray-50 transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Cargando...</span>
            </div>
          ) : registers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Banknote className="h-10 w-10 opacity-30" />
              <p className="text-sm">No hay registros confirmados para este mes</p>
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Crear el primero
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-xs text-gray-500 font-medium">
                    <th className="px-3 py-3 text-left w-8"></th>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-right">Efectivo</th>
                    <th className="px-4 py-3 text-right">TPV</th>
                    <th className="px-4 py-3 text-right">Bizum</th>
                    <th className="px-4 py-3 text-right">Transfer.</th>
                    <th className="px-4 py-3 text-right">Otros</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Total</th>
                    <th className="px-4 py-3 text-left">Observaciones</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {registers.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      {/* Source icon */}
                      <td className="px-3 py-3">
                        <span title={r.source === 'ai' ? 'Detectado por IA' : 'Introducido manualmente'}>
                          {r.source === 'ai'
                            ? <Bot className="h-3.5 w-3.5 text-teal-500" />
                            : <User2 className="h-3.5 w-3.5 text-gray-300" />}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {fmtDate(r.date)}
                        {/* Justificante link */}
                        {r.document_id && (
                          <button
                            onClick={() => setPreviewDocId(r.document_id)}
                            title="Ver justificante"
                            className="ml-2 text-gray-300 hover:text-teal-500 transition-colors"
                          >
                            <FileImage className="h-3.5 w-3.5 inline" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.cash_amount)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.card_amount)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.bizum_amount)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.transfer_amount)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(r.other_amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {fmtCurrency(r.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px]">
                        <span className="truncate block text-xs" title={r.notes ?? undefined}>
                          {r.notes || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEdit(r)}
                            title="Editar"
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(r.id)}
                            disabled={deletingId === r.id}
                            title="Eliminar"
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                          >
                            {deletingId === r.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr className="border-t bg-gray-50 font-semibold text-sm text-gray-700">
                    <td className="px-3 py-3" />
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{summary ? fmt(summary.cash_amount)     : '—'}</td>
                    <td className="px-4 py-3 text-right">{summary ? fmt(summary.card_amount)     : '—'}</td>
                    <td className="px-4 py-3 text-right">{summary ? fmt(summary.bizum_amount)    : '—'}</td>
                    <td className="px-4 py-3 text-right">{summary ? fmt(summary.transfer_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right">{summary ? fmt(summary.other_amount)    : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {summary ? fmtCurrency(summary.total_amount) : '—'}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Future reconciliation note */}
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-400 flex items-center gap-2">
        <span className="text-base">🔮</span>
        <span>
          Próximamente: conciliación automática entre cobros registrados y facturas emitidas del mismo período.
        </span>
      </div>

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        documentId={previewDocId}
        onClose={() => setPreviewDocId(null)}
      />

    </div>
  );
}
