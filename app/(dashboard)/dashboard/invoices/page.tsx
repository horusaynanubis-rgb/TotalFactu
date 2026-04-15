'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { Search, Filter, X, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterReview, setFilterReview] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editInvoice, setEditInvoice] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  const fetchInvoices = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType !== 'all') params.append('type', filterType);
      if (filterReview !== 'all') params.append('review', filterReview);
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`/api/invoices?${params.toString()}`);
      const data = await response.json();
      setInvoices(data?.invoices ?? []);
    } catch (error: any) {
      toast.error(t.invoices.fetchFailed);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterReview, searchQuery, t]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleApprove = async (invoiceId: string) => {
    try {
      await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'approved' }),
      });
      toast.success(t.invoices.approveSuccess);
      fetchInvoices();
    } catch (error: any) {
      toast.error(t.invoices.approveFailed);
    }
  };

  const handleReject = async (invoiceId: string) => {
    try {
      await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'rejected' }),
      });
      toast.success(t.invoices.approveSuccess);
      fetchInvoices();
    } catch (error: any) {
      toast.error(t.invoices.approveFailed);
    }
  };

  const openEdit = (inv: any) => {
    setEditInvoice(inv);
    setEditForm({
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
    });
  };

  const handleSaveEdit = async () => {
    if (!editInvoice) return;
    setSaving(true);
    try {
      const payload = {
        ...editForm,
        tax_rate: editForm.tax_rate === '' ? null : Number(editForm.tax_rate),
        due_date: editForm.due_date || null,
        review_status: 'approved',
      };
      const response = await fetch(`/api/invoices/${editInvoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error();
      toast.success(t.invoices.editSuccess);
      setEditInvoice(null);
      fetchInvoices();
    } catch (error: any) {
      toast.error(t.invoices.editFailed);
    } finally {
      setSaving(false);
    }
  };

  const typeLabels: Record<string, string> = {
    received: t.invoices.received,
    issued: t.invoices.issued,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.invoices.title}</h1>
        <p className="text-gray-600 mt-1">{t.invoices.subtitle}</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                <Search className="h-4 w-4 inline mr-1" />{t.common.search}
              </label>
              <Input
                placeholder={t.invoices.searchPlaceholder}
                value={searchQuery}
                onChange={(e: any) => setSearchQuery(e?.target?.value ?? '')}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                <Filter className="h-4 w-4 inline mr-1" />{t.invoices.typeFilter}
              </label>
              <select
                value={filterType}
                onChange={(e: any) => setFilterType(e?.target?.value ?? 'all')}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">{t.common.all}</option>
                <option value="received">{t.invoices.received}</option>
                <option value="issued">{t.invoices.issued}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                <Filter className="h-4 w-4 inline mr-1" />{t.invoices.reviewFilter}
              </label>
              <select
                value={filterReview}
                onChange={(e: any) => setFilterReview(e?.target?.value ?? 'all')}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">{t.common.all}</option>
                <option value="pending">{t.invoices.pending}</option>
                <option value="approved">{t.invoices.approved}</option>
                <option value="rejected">{t.invoices.rejected}</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t.invoices.invoiceList}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : invoices && invoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.invoices.invoiceNumber}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.type}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.date}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.invoices.supplier}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.invoices.customer}</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-700">{t.invoices.amount}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.invoices.confidence}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.invoices.review}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv: any) => (
                    <tr key={inv?.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium">{inv?.invoice_number}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          inv?.invoice_type === 'received' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {typeLabels[inv?.invoice_type] || inv?.invoice_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{formatDate(inv?.issue_date)}</td>
                      <td className="py-3 px-4 text-sm">{inv?.supplier_name}</td>
                      <td className="py-3 px-4 text-sm">{inv?.customer_name}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium">
                        {formatCurrency(inv?.total_amount ?? 0, inv?.currency)}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {inv?.extraction_confidence ? `${(inv.extraction_confidence * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={inv?.review_status} type="review" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1">
                          {inv?.review_status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleApprove(inv?.id)}
                                title={t.common.approve}
                              >
                                <CheckCircle className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReject(inv?.id)}
                                title={t.invoices.reject}
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(inv)}
                            title={t.invoices.editInvoice}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">{t.invoices.noInvoices}</p>
          )}
        </CardContent>
      </Card>

      {/* Edit Modal */}
      {editInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold">{t.invoices.editInvoice}</h2>
              <button onClick={() => setEditInvoice(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Row 1: Type + Invoice Number */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.invoiceType}</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editForm.invoice_type}
                    onChange={(e: any) => setEditForm({ ...editForm, invoice_type: e?.target?.value })}
                  >
                    <option value="received">{t.invoices.received}</option>
                    <option value="issued">{t.invoices.issued}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.invoiceNumber}</Label>
                  <Input
                    value={editForm.invoice_number}
                    onChange={(e: any) => setEditForm({ ...editForm, invoice_number: e?.target?.value ?? '' })}
                  />
                </div>
              </div>

              {/* Row 2: Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.issueDate}</Label>
                  <Input
                    type="date"
                    value={editForm.issue_date}
                    onChange={(e: any) => setEditForm({ ...editForm, issue_date: e?.target?.value ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.dueDate}</Label>
                  <Input
                    type="date"
                    value={editForm.due_date}
                    onChange={(e: any) => setEditForm({ ...editForm, due_date: e?.target?.value ?? '' })}
                  />
                </div>
              </div>

              {/* Row 3: Supplier */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.supplier}</Label>
                  <Input
                    value={editForm.supplier_name}
                    onChange={(e: any) => setEditForm({ ...editForm, supplier_name: e?.target?.value ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.supplierTaxId}</Label>
                  <Input
                    value={editForm.supplier_tax_id}
                    onChange={(e: any) => setEditForm({ ...editForm, supplier_tax_id: e?.target?.value ?? '' })}
                  />
                </div>
              </div>

              {/* Row 4: Customer */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.customer}</Label>
                  <Input
                    value={editForm.customer_name}
                    onChange={(e: any) => setEditForm({ ...editForm, customer_name: e?.target?.value ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.customerTaxId}</Label>
                  <Input
                    value={editForm.customer_tax_id}
                    onChange={(e: any) => setEditForm({ ...editForm, customer_tax_id: e?.target?.value ?? '' })}
                  />
                </div>
              </div>

              {/* Row 5: Amounts */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.subtotal}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.subtotal}
                    onChange={(e: any) => setEditForm({ ...editForm, subtotal: e?.target?.value ?? 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.taxAmount}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.tax_amount}
                    onChange={(e: any) => setEditForm({ ...editForm, tax_amount: e?.target?.value ?? 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.totalAmount}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.total_amount}
                    onChange={(e: any) => setEditForm({ ...editForm, total_amount: e?.target?.value ?? 0 })}
                  />
                </div>
              </div>

              {/* Row 6: Currency + Tax Rate */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.currency}</Label>
                  <Input
                    value={editForm.currency}
                    onChange={(e: any) => setEditForm({ ...editForm, currency: e?.target?.value ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.taxRate}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.tax_rate}
                    onChange={(e: any) => setEditForm({ ...editForm, tax_rate: e?.target?.value ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.paymentMethod}</Label>
                  <Input
                    value={editForm.payment_method}
                    onChange={(e: any) => setEditForm({ ...editForm, payment_method: e?.target?.value ?? '' })}
                  />
                </div>
              </div>

              {/* Row 7: Category + Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t.invoices.category}</Label>
                  <Input
                    value={editForm.category}
                    onChange={(e: any) => setEditForm({ ...editForm, category: e?.target?.value ?? '' })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.invoices.notes}</Label>
                  <Input
                    value={editForm.notes}
                    onChange={(e: any) => setEditForm({ ...editForm, notes: e?.target?.value ?? '' })}
                  />
                </div>
              </div>

              {/* Confidence indicator */}
              {editInvoice.extraction_confidence && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                  {t.invoices.confidence}: {(editInvoice.extraction_confidence * 100).toFixed(0)}%
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-6 border-t">
              <Button variant="outline" onClick={() => setEditInvoice(null)}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleSaveEdit} disabled={saving}>
                {saving ? t.invoices.savingChanges : t.invoices.saveChanges}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
