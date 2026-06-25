'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Upload, FileText, Filter, RotateCw, Trash2, X, Eye } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';
import { DocumentPreviewModal } from '@/components/document-preview-modal';

const PAGE_SIZE = 50;

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const { t } = useTranslation();

  const fetchDocuments = useCallback(async (offset: number, replace: boolean) => {
    if (replace) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.append('status', filterStatus);
      if (filterChannel !== 'all') params.append('channel', filterChannel);
      params.append('limit', String(PAGE_SIZE));
      params.append('offset', String(offset));

      const response = await fetch(`/api/documents?${params.toString()}`);
      const data = await response.json();
      const incoming = data?.documents ?? [];

      if (replace) {
        setDocuments(incoming);
      } else {
        setDocuments((prev) => [...prev, ...incoming]);
      }
      setHasMore(data?.hasMore ?? false);
    } catch (error: any) {
      toast.error(t.documents.fetchFailed);
    } finally {
      if (replace) setLoading(false);
      else setLoadingMore(false);
    }
  }, [filterStatus, filterChannel, t]);

  useEffect(() => {
    fetchDocuments(0, true);
  }, [fetchDocuments]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      toast.error(t.documents.fileTooLarge);
      return;
    }

    setUploading(true);

    try {
      const presignedResponse = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          isPublic: false,
        }),
      });

      const { uploadUrl, cloud_storage_path } = await presignedResponse.json();

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(t.documents.uploadFailed);
      }

      const completeResponse = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloud_storage_path,
          isPublic: false,
          fileName: file.name,
          mimeType: file.type,
          sourceChannel: 'web',
        }),
      });

      if (!completeResponse.ok) {
        const errorData = await completeResponse.json().catch(() => ({}));
        if (errorData.code === 'DEMO_LIMIT_REACHED') {
          const checkoutRes = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'plan', plan: 'profesional' }),
          });
          const checkoutData = await checkoutRes.json();
          if (checkoutData.url) {
            window.location.href = checkoutData.url;
          } else {
            toast.error('Has alcanzado el límite de 5 facturas del plan Demo. Ve a Facturación para actualizar tu plan.');
          }
          return;
        }
        throw new Error(t.documents.uploadFailed);
      }

      toast.success(t.documents.uploadSuccess);
      fetchDocuments(0, true);

      if (e?.target) {
        e.target.value = '';
      }
    } catch (error: any) {
      toast.error(`${t.documents.uploadFailed}: ${error?.message ?? ''}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRetry = async (docId: string) => {
    setRetryingId(docId);
    try {
      const response = await fetch(`/api/documents/${docId}/process`, {
        method: 'POST',
      });
      if (response.ok) {
        toast.success(t.documents.retrySuccess);
      } else {
        const data = await response.json();
        toast.error(`${t.documents.retryFailed}: ${data?.message || ''}`);
      }
      fetchDocuments(0, true);
    } catch (error: any) {
      toast.error(t.documents.retryFailed);
    } finally {
      setRetryingId(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDeleteId) return;
    const docId = confirmDeleteId;
    setConfirmDeleteId(null);
    setDeletingId(docId);
    try {
      const response = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.message ?? t.documents.deleteFailed);
      }
      toast.success(t.documents.deleteSuccess);
      fetchDocuments(0, true);
    } catch (error: any) {
      toast.error(error?.message ?? t.documents.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.documents.title}</h1>
        <p className="text-gray-600 mt-1">{t.documents.subtitle}</p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t.documents.uploadInvoice}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary transition-colors">
            <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">{t.documents.dragAndDrop}</p>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileUpload}
              disabled={uploading}
              className="max-w-xs mx-auto cursor-pointer"
            />
            {uploading && <p className="text-sm text-gray-500 mt-2">{t.documents.uploading}</p>}
            <p className="text-xs text-gray-500 mt-2">{t.documents.supported}</p>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                <Filter className="h-4 w-4 inline mr-1" />{t.documents.statusFilter}
              </label>
              <select
                value={filterStatus}
                onChange={(e: any) => setFilterStatus(e?.target?.value ?? 'all')}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">{t.common.all}</option>
                <option value="processing">{t.documents.statusProcessing}</option>
                <option value="completed">{t.documents.statusCompleted}</option>
                <option value="needs_review">{t.documents.statusNeedsReview}</option>
                <option value="failed">{t.documents.statusFailed}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                <Filter className="h-4 w-4 inline mr-1" />{t.documents.channelFilter}
              </label>
              <select
                value={filterChannel}
                onChange={(e: any) => setFilterChannel(e?.target?.value ?? 'all')}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="all">{t.common.all}</option>
                <option value="web">Web</option>
                <option value="telegram">Telegram</option>
                <option value="email">Email</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t.documents.uploadedDocuments}</span>
            {!loading && documents.length > 0 && (
              <span className="text-sm font-normal text-gray-500">
                {documents.length} documento{documents.length !== 1 ? 's' : ''}{hasMore ? '+' : ''}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : documents && documents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.filename}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.uploadDate}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.channel}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.status}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.documents.confidence}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc: any) => (
                    <tr key={doc?.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center">
                          <FileText className="h-4 w-4 text-gray-400 mr-2" />
                          <span className="text-sm">{doc?.original_filename}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {formatDateTime(doc?.upload_timestamp)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm capitalize">{doc?.source_channel}</span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={doc?.processing_status} type="processing" />
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {doc?.confidence_score ? `${(doc?.confidence_score * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          {(doc?.processing_status === 'failed' || doc?.processing_status === 'needs_review') && (
                            <button
                              onClick={() => handleRetry(doc.id)}
                              disabled={retryingId === doc.id}
                              title={t.documents.retryProcessing}
                              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-40"
                            >
                              <RotateCw className={`h-3.5 w-3.5 ${retryingId === doc.id ? 'animate-spin' : ''}`} />
                              {retryingId === doc.id ? t.documents.retrying : t.documents.retryProcessing}
                            </button>
                          )}
                          <button
                            onClick={() => setPreviewDocId(doc.id)}
                            title={t.documents.previewDocument}
                            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Ver
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(doc.id)}
                            disabled={deletingId === doc.id}
                            title={t.documents.deleteDocument}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">{t.documents.noDocuments}</p>
          )}
          {hasMore && (
            <div className="pt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchDocuments(documents.length, false)}
                disabled={loadingMore}
              >
                {loadingMore ? t.common.loading : 'Cargar más documentos'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <DocumentPreviewModal
        documentId={previewDocId}
        onClose={() => setPreviewDocId(null)}
      />

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold text-red-600">{t.documents.deleteConfirmTitle}</h2>
              <button onClick={() => setConfirmDeleteId(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-700">{t.documents.deleteConfirmMessage}</p>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t">
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
                {t.common.cancel}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirmed}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {t.common.delete}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
