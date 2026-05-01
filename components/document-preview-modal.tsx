'use client';

import { useEffect, useState } from 'react';
import { X, ExternalLink, Download, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/context';
import { formatDateTime } from '@/lib/utils';

interface PreviewData {
  url: string;
  mime_type: string;
  original_filename: string;
  status: string;
  source_channel: string;
  upload_timestamp: string;
}

interface DocumentPreviewModalProps {
  documentId: string | null;
  onClose: () => void;
}

const SUPPORTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

export function DocumentPreviewModal({ documentId, onClose }: DocumentPreviewModalProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);

    fetch(`/api/documents/${documentId}/preview`)
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(d?.message ?? 'Error'));
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(typeof err === 'string' ? err : t.documents.previewError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, t]);

  if (!documentId) return null;

  const isSupported = data ? SUPPORTED_TYPES.includes(data.mime_type) : false;
  const isPdf = data?.mime_type === 'application/pdf';
  const isImage = data?.mime_type.startsWith('image/');

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">
              {data?.original_filename ?? t.documents.previewDocument}
            </h2>
            {data && (
              <p className="text-xs text-gray-500 mt-0.5 flex gap-3">
                <span className="capitalize">{data.source_channel}</span>
                <span>·</span>
                <span>{data.status}</span>
                <span>·</span>
                <span>{formatDateTime(data.upload_timestamp)}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {data && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(data.url, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                {t.documents.previewOpenTab}
              </Button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 rounded-md p-1 hover:bg-gray-100 transition-colors"
              aria-label={t.documents.previewClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0 p-4">
          {loading && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">{t.documents.previewLoading}</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-red-500">
              <AlertCircle className="h-8 w-8" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {data && !loading && !error && (
            <>
              {isPdf && (
                <iframe
                  src={data.url}
                  className="w-full rounded border"
                  style={{ height: 'calc(92vh - 180px)', minHeight: '400px' }}
                  title={data.original_filename}
                />
              )}

              {isImage && (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.url}
                    alt={data.original_filename}
                    className="max-w-full max-h-[calc(92vh-180px)] object-contain rounded border"
                  />
                </div>
              )}

              {!isSupported && (
                <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
                  <Download className="h-8 w-8" />
                  <span className="text-sm">{t.documents.previewUnsupported}</span>
                  <Button
                    variant="outline"
                    onClick={() => window.open(data.url, '_blank', 'noopener,noreferrer')}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {t.common.download}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose}>
            {t.documents.previewClose}
          </Button>
        </div>
      </div>
    </div>
  );
}
