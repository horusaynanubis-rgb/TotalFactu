'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Trash2, Link2, Archive, X, Check } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { DocumentPreviewModal } from '@/components/document-preview-modal';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  matched: 'Vinculado',
  expired: 'Caducado',
  archived: 'Archivado',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  matched: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-800',
  archived: 'bg-gray-100 text-gray-600',
};

const CHANNEL_LABELS: Record<string, string> = {
  web: 'Web',
  telegram: 'Telegram',
  email: 'Email',
};

export default function AlbaranesPage() {
  const [deliveryNotes, setDeliveryNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [alsoDeleteDoc, setAlsoDeleteDoc] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [matching, setMatching] = useState(false);

  const fetchDeliveryNotes = useCallback(async () => {
    try {
      const params = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
      const res = await fetch(`/api/delivery-notes${params}`);
      const data = await res.json();
      setDeliveryNotes(data?.delivery_notes ?? []);
    } catch {
      toast.error('Error al cargar los albaranes');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { fetchDeliveryNotes(); }, [fetchDeliveryNotes]);

  const handleArchive = async (dn: any) => {
    try {
      await fetch(`/api/delivery-notes/${dn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      toast.success('Albarán archivado');
      fetchDeliveryNotes();
    } catch {
      toast.error('Error al archivar el albarán');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      const url = `/api/delivery-notes/${confirmDelete.id}?deleteDocument=${alsoDeleteDoc}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).message);
      toast.success('Albarán eliminado');
      setConfirmDelete(null);
      fetchDeliveryNotes();
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    } finally {
      setDeletingId(null);
    }
  };

  const openMatchModal = async (dn: any) => {
    setMatchModal(dn);
    setSelectedInvoiceId(dn.matched_invoice_id ?? '');
    try {
      const res = await fetch('/api/invoices?type=received');
      const data = await res.json();
      setInvoices(data?.invoices ?? []);
    } catch {
      setInvoices([]);
    }
  };

  const handleMatch = async () => {
    if (!matchModal) return;
    setMatching(true);
    try {
      const res = await fetch(`/api/delivery-notes/${matchModal.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: selectedInvoiceId || null }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      toast.success(selectedInvoiceId ? 'Albarán vinculado a factura' : 'Vinculación eliminada');
      setMatchModal(null);
      fetchDeliveryNotes();
    } catch (err: any) {
      toast.error(err.message || 'Error al vincular');
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Albaranes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Documentos de entrega pendientes de factura. No se contabilizan como facturas.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {['all', 'pending', 'matched', 'expired', 'archived'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterStatus === s
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? 'Cargando...' : `${deliveryNotes.length} albarán${deliveryNotes.length !== 1 ? 'es' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Cargando albaranes...</div>
          ) : deliveryNotes.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No hay albaranes{filterStatus !== 'all' ? ` con estado "${STATUS_LABELS[filterStatus]}"` : ''}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Proveedor</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Nº Albarán</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Importe</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Estado</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Factura asociada</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Origen</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {deliveryNotes.map((dn) => (
                    <tr key={dn.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{dn.supplier_name}</div>
                        {dn.supplier_tax_id && (
                          <div className="text-xs text-gray-400">{dn.supplier_tax_id}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                        {dn.delivery_note_number}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {dn.issue_date ? formatDate(dn.issue_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {dn.total_amount != null
                          ? `${dn.total_amount.toFixed(2)} ${dn.currency ?? ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[dn.status] ?? ''}`}>
                          {STATUS_LABELS[dn.status] ?? dn.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {dn.matched_invoice ? (
                          <span className="text-xs text-green-700 font-medium">
                            #{dn.matched_invoice.invoice_number}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Sin vincular</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs text-gray-500">
                          {CHANNEL_LABELS[dn.document?.source_channel] ?? dn.document?.source_channel ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {dn.document_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Ver documento"
                              onClick={() => setPreviewDocId(dn.document_id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Vincular a factura"
                            onClick={() => openMatchModal(dn)}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                          {dn.status !== 'archived' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-gray-400 hover:text-gray-600"
                              title="Archivar"
                              onClick={() => handleArchive(dn)}
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-400 hover:text-red-600"
                            title="Eliminar"
                            onClick={() => { setConfirmDelete(dn); setAlsoDeleteDoc(false); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document preview modal */}
      {previewDocId && (
        <DocumentPreviewModal
          documentId={previewDocId}
          onClose={() => setPreviewDocId(null)}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Eliminar albarán</h3>
            <p className="text-sm text-gray-600 mb-4">
              ¿Eliminar el albarán <span className="font-medium">{confirmDelete.delivery_note_number}</span>?
              Esta acción no se puede deshacer.
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-600 mb-5">
              <input
                type="checkbox"
                checked={alsoDeleteDoc}
                onChange={(e) => setAlsoDeleteDoc(e.target.checked)}
              />
              Eliminar también el documento original
            </label>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
              <Button
                variant="destructive"
                disabled={!!deletingId}
                onClick={handleDelete}
              >
                {deletingId ? 'Eliminando...' : 'Eliminar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Match invoice modal */}
      {matchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Vincular a factura</h3>
              <button onClick={() => setMatchModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Albarán <span className="font-medium">{matchModal.delivery_note_number}</span> de{' '}
              <span className="font-medium">{matchModal.supplier_name}</span>
            </p>
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Factura recibida
              </label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
              >
                <option value="">— Sin vincular —</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    #{inv.invoice_number} · {inv.supplier_name} · {inv.currency} {inv.total_amount?.toFixed(2)} · {inv.issue_date ? formatDate(inv.issue_date) : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setMatchModal(null)}>Cancelar</Button>
              <Button disabled={matching} onClick={handleMatch}>
                <Check className="h-4 w-4 mr-1" />
                {matching ? 'Guardando...' : 'Guardar vinculación'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
