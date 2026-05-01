'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { DocumentPreviewModal } from '@/components/document-preview-modal';
import { useTranslation } from '@/lib/i18n/context';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  Eye, CheckCircle, XCircle, Pencil, AlertTriangle,
  FileText, ClipboardCheck, X, Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewInvoice {
  id: string;
  document_id: string;
  invoice_number: string;
  invoice_type: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  customer_name: string;
  customer_tax_id: string | null;
  total_amount: number;
  subtotal: number;
  tax_amount: number;
  tax_rate: number | null;
  currency: string;
  issue_date: string;
  due_date: string | null;
  payment_method: string | null;
  category: string | null;
  notes: string | null;
  extraction_confidence: number;
  review_status: string;
}

interface ReviewDocument {
  id: string;
  original_filename: string;
  source_channel: string;
  processing_status: string;
  upload_timestamp: string;
  mime_type: string;
}

interface ReviewData {
  summary: { pendingInvoices: number; pendingDocuments: number; total: number };
  invoices: ReviewInvoice[];
  documents: ReviewDocument[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getReviewReasons(inv: ReviewInvoice, t: any): string[] {
  const reasons: string[] = [];
  if (inv.extraction_confidence < 0.7) {
    reasons.push(`${t.review.reasonLowConfidence} (${Math.round(inv.extraction_confidence * 100)}%)`);
  }
  if (!inv.invoice_number || inv.invoice_number === 'UNKNOWN') {
    reasons.push(t.review.reasonMissingNumber);
  }
  if (!inv.supplier_name || inv.supplier_name === 'Unknown Supplier') {
    reasons.push(t.review.reasonMissingSupplier);
  }
  if (!inv.customer_name || inv.customer_name === 'Unknown Customer') {
    reasons.push(t.review.reasonMissingCustomer);
  }
  if ((inv.total_amount ?? 0) <= 0) {
    reasons.push(t.review.reasonMissingAmount);
  }
  return reasons;
}

function buildEditForm(inv: ReviewInvoice) {
  return {
    invoice_type: inv.invoice_type || 'received',
    invoice_number: inv.invoice_number || '',
    issue_date: inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : '',
    due_date: inv.due_date ? new Date(inv.due_date).toISOString().split('T')[0] : '',
    supplier_name: inv.supplier_name || '',
    supplier_tax_id: inv.supplier_tax_id || '',
    customer_name: inv.customer_name || '',
    customer_tax_id: inv.customer_tax_id || '',
    subtotal: inv.subtotal ?? 0,
    tax_amount: inv.tax_amount ?? 0,
    total_amount: inv.total_amount ?? 0,
    currency: inv.currency || 'EUR',
    tax_rate: inv.tax_rate ?? '',
    payment_method: inv.payment_method || '',
    category: inv.category || '',
    notes: inv.notes || '',
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewQueuePage() {
  const { t } = useTranslation();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [editInvoice, setEditInvoice] = useState<ReviewInvoice | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/review', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setData(await res.json());
    } catch {
      toast.error(t.review.fetchFailed);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Quick approve / reject via /api/review
  const quickAct = async (
    itemType: 'invoice' | 'document',
    id: string,
    action: 'approve' | 'reject',
  ) => {
    setActingId(id);
    try {
      const res = await fetch('/api/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType, id, action }),
      });
      if (!res.ok) throw new Error();
      toast.success(action === 'approve' ? t.review.approveSuccess : t.review.rejectSuccess);
      load();
    } catch {
      toast.error(t.review.actionFailed);
    } finally {
      setActingId(null);
    }
  };

  // Edit + approve via /api/invoices/[id]
  const openEdit = (inv: ReviewInvoice) => {
    setEditInvoice(inv);
    setEditForm(buildEditForm(inv));
  };

  const handleSaveAndApprove = async () => {
    if (!editInvoice) return;
    setSaving(true);
    try {
      const payload = {
        ...editForm,
        tax_rate: editForm.tax_rate === '' ? null : Number(editForm.tax_rate),
        due_date: editForm.due_date || null,
        review_status: 'approved',
      };
      const res = await fetch(`/api/invoices/${editInvoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast.success(t.review.editApproveSuccess);
      setEditInvoice(null);
      load();
    } catch {
      toast.error(t.review.actionFailed);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.review.title}</h1>
        <p className="text-gray-600 mt-1">{t.review.subtitle}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">{t.review.pendingInvoices}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {loading ? '—' : (data?.summary.pendingInvoices ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">{t.review.pendingDocuments}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {loading ? '—' : (data?.summary.pendingDocuments ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">{t.review.totalPending}</p>
            <p className="text-3xl font-bold text-amber-600 mt-1">
              {loading ? '—' : (data?.summary.total ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t.common.loading}</span>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ----------------------------------------------------------------
              Invoices
          ---------------------------------------------------------------- */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-amber-500" />
              <CardTitle>{t.review.invoicesSection}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.invoices.length === 0 ? (
                <p className="text-gray-500 text-sm py-4 text-center">{t.review.noInvoicesPending}</p>
              ) : (
                <div className="space-y-3">
                  {data.invoices.map((inv) => {
                    const reasons = getReviewReasons(inv, t);
                    const isActing = actingId === inv.id;
                    const confidencePct = Math.round(inv.extraction_confidence * 100);

                    return (
                      <div
                        key={inv.id}
                        className="border rounded-lg p-4 space-y-3 hover:border-amber-200 hover:bg-amber-50/30 transition-colors"
                      >
                        {/* Row 1: number + type badge + confidence */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-gray-900 truncate">
                              #{inv.invoice_number}
                            </span>
                            <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ring-1 ring-inset ${
                              inv.invoice_type === 'received'
                                ? 'bg-blue-50 text-blue-700 ring-blue-600/20'
                                : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                            }`}>
                              {inv.invoice_type === 'received' ? t.invoices.received : t.invoices.issued}
                            </span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              confidencePct >= 70
                                ? 'bg-green-50 text-green-700'
                                : 'bg-red-50 text-red-600'
                            }`}>
                              {confidencePct}%
                            </span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            {formatCurrency(inv.total_amount ?? 0, inv.currency)}
                          </span>
                        </div>

                        {/* Row 2: supplier → customer · date */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm text-gray-600">
                          <div className="min-w-0">
                            <span className="text-xs text-gray-400 block">{t.invoices.supplier}</span>
                            <span className="truncate block">{inv.supplier_name || '—'}</span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs text-gray-400 block">{t.invoices.customer}</span>
                            <span className="truncate block">{inv.customer_name || '—'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-gray-400 block">{t.common.date}</span>
                            <span>{formatDate(inv.issue_date)}</span>
                          </div>
                          <div>
                            <span className="text-xs text-gray-400 block">{t.review.confidence}</span>
                            <span>{confidencePct}%</span>
                          </div>
                        </div>

                        {/* Row 3: review reasons warning */}
                        {reasons.length > 0 && (
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                            <div className="text-xs text-amber-700">
                              <span className="font-medium">{t.review.reasonsTitle}: </span>
                              {reasons.join(' · ')}
                            </div>
                          </div>
                        )}

                        {/* Row 4: actions */}
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          {/* View document */}
                          {inv.document_id && (
                            <button
                              onClick={() => setPreviewDocId(inv.document_id)}
                              title={t.review.viewDocument}
                              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {t.review.viewDocument}
                            </button>
                          )}

                          {/* Edit & approve — primary CTA when there are reasons */}
                          <button
                            onClick={() => openEdit(inv)}
                            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors ${
                              reasons.length > 0
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t.review.editAndApprove}
                          </button>

                          {/* Divider */}
                          <span className="text-gray-200 select-none">|</span>

                          {/* Quick approve */}
                          <button
                            onClick={() => quickAct('invoice', inv.id, 'approve')}
                            disabled={isActing}
                            title={t.common.approve}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors disabled:opacity-40"
                          >
                            {isActing
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <CheckCircle className="h-4 w-4" />}
                          </button>

                          {/* Quick reject */}
                          <button
                            onClick={() => quickAct('invoice', inv.id, 'reject')}
                            disabled={isActing}
                            title={t.invoices.reject}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-orange-500 hover:bg-orange-50 hover:text-orange-600 transition-colors disabled:opacity-40"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ----------------------------------------------------------------
              Documents
          ---------------------------------------------------------------- */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileText className="h-5 w-5 text-gray-500" />
              <CardTitle>{t.review.documentsSection}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.documents.length === 0 ? (
                <p className="text-gray-500 text-sm py-4 text-center">{t.review.noDocumentsPending}</p>
              ) : (
                <div className="space-y-2">
                  {data.documents.map((doc) => {
                    const isActing = actingId === doc.id;
                    return (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-4 border rounded-lg px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{doc.original_filename}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            <span className="capitalize">{doc.source_channel}</span>
                            {' · '}
                            {formatDateTime(doc.upload_timestamp)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => setPreviewDocId(doc.id)}
                            title={t.review.viewDocument}
                            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Ver
                          </button>
                          <button
                            onClick={() => quickAct('document', doc.id, 'approve')}
                            disabled={isActing}
                            title={t.common.approve}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
                          >
                            {isActing
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <CheckCircle className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => quickAct('document', doc.id, 'reject')}
                            disabled={isActing}
                            title={t.invoices.reject}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-orange-500 hover:bg-orange-50 transition-colors disabled:opacity-40"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ----------------------------------------------------------------
          Document Preview Modal (reutilizado)
      ---------------------------------------------------------------- */}
      <DocumentPreviewModal
        documentId={previewDocId}
        onClose={() => setPreviewDocId(null)}
      />

      {/* ----------------------------------------------------------------
          Edit + Approve Modal
      ---------------------------------------------------------------- */}
      {editInvoice && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150">
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b shrink-0">
              <div>
                <h2 className="text-lg font-semibold">{t.review.editAndApprove}</h2>
                <p className="text-xs text-gray-500 mt-0.5">#{editInvoice.invoice_number}</p>
              </div>
              <button
                onClick={() => setEditInvoice(null)}
                className="text-gray-400 hover:text-gray-600 rounded-md p-1 hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">

              {/* Invoice type + number */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.invoiceType}</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editForm.invoice_type}
                    onChange={(e: any) => setEditForm({ ...editForm, invoice_type: e.target.value })}
                  >
                    <option value="received">{t.invoices.received}</option>
                    <option value="issued">{t.invoices.issued}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.invoiceNumber}</Label>
                  <Input
                    value={editForm.invoice_number}
                    onChange={(e: any) => setEditForm({ ...editForm, invoice_number: e.target.value })}
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.issueDate}</Label>
                  <Input
                    type="date"
                    value={editForm.issue_date}
                    onChange={(e: any) => setEditForm({ ...editForm, issue_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.dueDate}</Label>
                  <Input
                    type="date"
                    value={editForm.due_date}
                    onChange={(e: any) => setEditForm({ ...editForm, due_date: e.target.value })}
                  />
                </div>
              </div>

              {/* Supplier */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.supplier}</Label>
                  <Input
                    value={editForm.supplier_name}
                    onChange={(e: any) => setEditForm({ ...editForm, supplier_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.supplierTaxId}</Label>
                  <Input
                    value={editForm.supplier_tax_id}
                    onChange={(e: any) => setEditForm({ ...editForm, supplier_tax_id: e.target.value })}
                  />
                </div>
              </div>

              {/* Customer */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.customer}</Label>
                  <Input
                    value={editForm.customer_name}
                    onChange={(e: any) => setEditForm({ ...editForm, customer_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.customerTaxId}</Label>
                  <Input
                    value={editForm.customer_tax_id}
                    onChange={(e: any) => setEditForm({ ...editForm, customer_tax_id: e.target.value })}
                  />
                </div>
              </div>

              {/* Amounts */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.subtotal}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.subtotal}
                    onChange={(e: any) => setEditForm({ ...editForm, subtotal: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.taxAmount}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.tax_amount}
                    onChange={(e: any) => setEditForm({ ...editForm, tax_amount: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.totalAmount}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.total_amount}
                    onChange={(e: any) => setEditForm({ ...editForm, total_amount: e.target.value })}
                  />
                </div>
              </div>

              {/* Currency + tax rate */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.currency}</Label>
                  <Input
                    value={editForm.currency}
                    onChange={(e: any) => setEditForm({ ...editForm, currency: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.taxRate}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.tax_rate}
                    onChange={(e: any) => setEditForm({ ...editForm, tax_rate: e.target.value })}
                  />
                </div>
              </div>

              {/* Category + notes */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.category}</Label>
                  <Input
                    value={editForm.category}
                    onChange={(e: any) => setEditForm({ ...editForm, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.notes}</Label>
                  <Input
                    value={editForm.notes}
                    onChange={(e: any) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </div>
              </div>

              {/* Confidence indicator */}
              <div className="bg-gray-50 rounded-md px-3 py-2 text-xs text-gray-500">
                {t.review.confidence}: {Math.round(editInvoice.extraction_confidence * 100)}%
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between gap-3 p-5 border-t shrink-0">
              {/* Preview button inside modal */}
              {editInvoice.document_id && (
                <button
                  onClick={() => setPreviewDocId(editInvoice.document_id)}
                  className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {t.review.viewDocument}
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={() => setEditInvoice(null)}>
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={handleSaveAndApprove}
                  disabled={saving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      {t.review.saving}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                      {t.review.editAndApprove}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
