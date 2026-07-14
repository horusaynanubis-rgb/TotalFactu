// Downloads a stored document from Supabase Storage and returns it as base64
// for Gemini inline_data, correcting the MIME type via magic-byte sniffing
// when the stored type is generic (application/octet-stream). Shared by the
// full extraction pipeline (app/api/documents/[id]/process/route.ts) and the
// VAT-only micro pass (app/api/gestoria/clients/[clientCompanyId]/vat-reclassify/route.ts)
// so both read the exact same bytes the same way.
import { getFileUrl } from './storage';

export interface DocumentFileInput {
  cloud_storage_path: string;
  is_public: boolean;
  mime_type: string;
}

export interface DocumentFileResult {
  fileBase64: string;
  effectiveMime: string;
  sizeKb: number;
}

export async function fetchDocumentAsBase64(document: DocumentFileInput, logLabel = 'document-file'): Promise<DocumentFileResult> {
  const fileUrl = await getFileUrl(document.cloud_storage_path, document.is_public);
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Error guardando archivo — storage fetch failed (${fileResponse.status} ${fileResponse.statusText})`);
  }
  const fileBuffer = await fileResponse.arrayBuffer();
  const fileBase64 = Buffer.from(fileBuffer).toString('base64');
  const sizeKb = Math.round(fileBuffer.byteLength / 1024);

  // Magic-byte sniffing: PDF=%PDF, PNG=\x89PNG, JPEG=\xFF\xD8
  const magic = Buffer.from(fileBuffer).slice(0, 5).toString('hex');
  const detectedMime =
    magic.startsWith('255044462d') ? 'application/pdf' :
    magic.startsWith('89504e47') ? 'image/png' :
    magic.startsWith('ffd8ff') ? 'image/jpeg' :
    'unknown';

  const effectiveMime = document.mime_type === 'application/octet-stream' && detectedMime !== 'unknown'
    ? detectedMime
    : document.mime_type;

  console.log(`[${logLabel}] sizeKb=${sizeKb} stored_mime=${document.mime_type} detected_mime=${detectedMime} effective_mime=${effectiveMime}`);

  return { fileBase64, effectiveMime, sizeKb };
}
