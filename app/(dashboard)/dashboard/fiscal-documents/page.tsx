'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Upload, Eye, Download, Pencil, Trash2, FileStack, X,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';
import { DocumentPreviewModal } from '@/components/document-preview-modal';
import {
  FISCAL_DOCUMENT_TYPES, FISCAL_PERIODS,
  FISCAL_DOCUMENT_TYPE_LABELS_ES, FISCAL_PERIOD_LABELS_ES,
} from '@/lib/fiscal-document-types';

const STATUS_LABELS: Record<string, string> = {
  available: 'Disponible',
  reviewed: 'Revisado',
};

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => currentYear - i);

interface FiscalDoc {
  id: string;
  original_filename: string;
  document_type: string;
  fiscal_year: number;
  fiscal_period: string;
  description: string | null;
  status: string;
  created_at: string;
}

export default function FiscalDocumentsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FiscalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<string>(FISCAL_DOCUMENT_TYPES[0]);
  const [uploadYear, setUploadYear] = useState<number>(currentYear);
  const [uploadPeriod, setUploadPeriod] = useState<string>('none');
  const [uploadDescription, setUploadDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editDoc, setEditDoc] = useState<FiscalDoc | null>(null);
  const [editType, setEditType] = useState<string>(FISCAL_DOCUMENT_TYPES[0]);
  const [editYear, setEditYear] = useState<number>(currentYear);
  const [editPeriod, setEditPeriod] = useState<string>('none');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterYear !== 'all') params.set('year', filterYear);
      if (filterPeriod !== 'all') params.set('period', filterPeriod);
      if (filterType !== 'all') params.set('type', filterType);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const res = await fetch(`/api/fiscal-documents?${params.toString()}`);
      const data = await res.json();
      setItems(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch {
      toast.error('No se pudieron cargar los documentos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYear, filterPeriod, filterType, filterStatus]);

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadType(FISCAL_DOCUMENT_TYPES[0]);
    setUploadYear(currentYear);
    setUploadPeriod('none');
    setUploadDescription('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error('Selecciona un archivo');
      return;
    }
    if (!ACCEPTED_TYPES.includes(uploadFile.type)) {
      toast.error('Formato no soportado. Usa PDF, JPG, JPEG o PNG.');
      return;
    }
    if (uploadFile.size > 50 * 1024 * 1024) {
      toast.error('El archivo es demasiado grande (máx. 50 MB)');
      return;
    }

    setUploading(true);
    try {
      const presignedRes = await fetch('/api/fiscal-documents/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: uploadFile.name,
          contentType: uploadFile.type,
          fiscalYear: uploadYear,
          fiscalPeriod: uploadPeriod,
        }),
      });
      if (!presignedRes.ok) throw new Error('No se pudo iniciar la subida');
      const { uploadUrl, cloud_storage_path } = await presignedRes.json();

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': uploadFile.type },
        body: uploadFile,
      });
      if (!putRes.ok) throw new Error('Fallo al subir el archivo');

      const completeRes = await fetch('/api/fiscal-documents/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloud_storage_path,
          fileName: uploadFile.name,
          mimeType: uploadFile.type,
          sizeBytes: uploadFile.size,
          documentType: uploadType,
          fiscalYear: uploadYear,
          fiscalPeriod: uploadPeriod,
          description: uploadDescription,
        }),
      });
      if (!completeRes.ok) {
        const d = await completeRes.json().catch(() => ({}));
        throw new Error(d?.message || 'Fallo al guardar el documento');
      }

      toast.success('Documento subido correctamente');
      setUploadOpen(false);
      resetUploadForm();
      fetchDocs();
    } catch (err: any) {
      toast.error(err?.message || 'Error al subir el documento');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/fiscal-documents/${id}/preview`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Error');
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.original_filename;
      a.click();
    } catch {
      toast.error('No se pudo descargar el documento');
    } finally {
      setDownloadingId(null);
    }
  };

  const openEdit = (doc: FiscalDoc) => {
    setEditDoc(doc);
    setEditType(doc.document_type);
    setEditYear(doc.fiscal_year);
    setEditPeriod(doc.fiscal_period);
    setEditDescription(doc.description ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editDoc) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/fiscal-documents/${editDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: editType,
          fiscalYear: editYear,
          fiscalPeriod: editPeriod,
          description: editDescription,
        }),
      });
      if (!res.ok) throw new Error('Fallo al guardar');
      toast.success('Metadatos actualizados');
      setEditDoc(null);
      fetchDocs();
    } catch {
      toast.error('No se pudieron guardar los cambios');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/fiscal-documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Fallo al eliminar');
      toast.success('Documento eliminado');
      setConfirmDeleteId(null);
      fetchDocs();
    } catch {
      toast.error('No se pudo eliminar el documento');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FileStack className="h-7 w-7 text-primary" />
            Documentación fiscal
          </h1>
          <p className="text-gray-600 mt-1">
            Documentos complementarios para tu gestoría (contratos, escrituras, certificados, retenciones...).
            Estos archivos no son facturas y no se procesan con OCR.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Subir documento
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Documentos ({total})</span>
          </CardTitle>
          <div className="flex flex-wrap gap-2 pt-2">
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-[110px]"><SelectValue placeholder="Año" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los años</SelectItem>
                {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPeriod} onValueChange={setFilterPeriod}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Periodo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los periodos</SelectItem>
                {FISCAL_PERIODS.map((p) => <SelectItem key={p} value={p}>{FISCAL_PERIOD_LABELS_ES[p]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {FISCAL_DOCUMENT_TYPES.map((tp) => (
                  <SelectItem key={tp} value={tp}>{FISCAL_DOCUMENT_TYPE_LABELS_ES[tp]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="available">Disponible</SelectItem>
                <SelectItem value="reviewed">Revisado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">Cargando...</p>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No hay documentos fiscales todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Archivo</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Tipo</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Periodo</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Fecha de subida</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Observaciones</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Estado</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((doc) => (
                    <tr key={doc.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm max-w-[220px] truncate">{doc.original_filename}</td>
                      <td className="py-3 px-4 text-sm">{FISCAL_DOCUMENT_TYPE_LABELS_ES[doc.document_type as keyof typeof FISCAL_DOCUMENT_TYPE_LABELS_ES] ?? doc.document_type}</td>
                      <td className="py-3 px-4 text-sm">{doc.fiscal_year} · {FISCAL_PERIOD_LABELS_ES[doc.fiscal_period as keyof typeof FISCAL_PERIOD_LABELS_ES] ?? doc.fiscal_period}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{formatDateTime(doc.created_at)}</td>
                      <td className="py-3 px-4 text-sm text-gray-600 max-w-[200px] truncate">{doc.description || '—'}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${doc.status === 'reviewed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                          {STATUS_LABELS[doc.status] ?? doc.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setPreviewId(doc.id)} title="Ver">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDownload(doc.id)} disabled={downloadingId === doc.id} title="Descargar">
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(doc)} title="Editar metadatos">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setConfirmDeleteId(doc.id)} title="Eliminar">
                            <Trash2 className="h-4 w-4 text-red-500" />
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

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) resetUploadForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subir documento</DialogTitle>
            <DialogDescription>
              PDF, JPG, JPEG o PNG. Este archivo no se procesará como factura.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Archivo</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tipo de documento</Label>
              <Select value={uploadType} onValueChange={setUploadType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FISCAL_DOCUMENT_TYPES.map((tp) => (
                    <SelectItem key={tp} value={tp}>{FISCAL_DOCUMENT_TYPE_LABELS_ES[tp]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Año</Label>
                <Select value={String(uploadYear)} onValueChange={(v) => setUploadYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Trimestre / periodo</Label>
                <Select value={uploadPeriod} onValueChange={setUploadPeriod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FISCAL_PERIODS.map((p) => <SelectItem key={p} value={p}>{FISCAL_PERIOD_LABELS_ES[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Descripción / observaciones</Label>
              <Textarea
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="Opcional"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? 'Subiendo...' : 'Subir documento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit metadata dialog */}
      <Dialog open={!!editDoc} onOpenChange={(open) => { if (!open) setEditDoc(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar metadatos</DialogTitle>
            <DialogDescription>{editDoc?.original_filename}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo de documento</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FISCAL_DOCUMENT_TYPES.map((tp) => (
                    <SelectItem key={tp} value={tp}>{FISCAL_DOCUMENT_TYPE_LABELS_ES[tp]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Año</Label>
                <Select value={String(editYear)} onValueChange={(v) => setEditYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Trimestre / periodo</Label>
                <Select value={editPeriod} onValueChange={setEditPeriod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FISCAL_PERIODS.map((p) => <SelectItem key={p} value={p}>{FISCAL_PERIOD_LABELS_ES[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción / observaciones</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDoc(null)} disabled={savingEdit}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar documento</DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)} disabled={!!deletingId}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
              disabled={!!deletingId}
            >
              <X className="mr-2 h-4 w-4" />
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentPreviewModal
        documentId={previewId}
        onClose={() => setPreviewId(null)}
        previewEndpoint={(id) => `/api/fiscal-documents/${id}/preview`}
      />
    </div>
  );
}
