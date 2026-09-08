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

// Marker for a storage_download phase that never resolved in time. Root
// cause of the 2026-09-08 15:25 UTC incident: this function had NO timeout
// anywhere (neither the Supabase createSignedUrl() call nor the raw
// fetch() of the file), so a hang here — same failure class as the Gemini
// hang this file already suffered from twice — silently blocked the whole
// function until the platform SIGKILLed it past maxDuration, before any
// catch block, AuditLog entry, or Telegram message. That document's
// content_hash was never even written (it's computed right after this call
// returns), which is how this gap was found.
export const STORAGE_DOWNLOAD_TIMEOUT_MARKER = 'Storage:TIMEOUT:';

// Combined budget for getFileUrl() (Supabase signed-URL API call) + the
// actual file download. Generous for the small PDFs/images this app
// handles (typically well under 1MB), safely under the 60s route
// maxDuration, leaving headroom for the Gemini call that follows.
const STORAGE_DOWNLOAD_TIMEOUT_MS = 20_000;

export function isStorageTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(STORAGE_DOWNLOAD_TIMEOUT_MARKER);
}

/**
 * Soft timeout via Promise.race: doesn't forcibly abort the underlying
 * Supabase SDK call or fetch, but guarantees this function settles within
 * timeoutMs so the caller can reach its own catch block, mark the Document
 * failed, and respond — instead of the whole serverless function hanging
 * until the platform kills it.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${STORAGE_DOWNLOAD_TIMEOUT_MARKER} ${label} exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function fetchDocumentAsBase64(document: DocumentFileInput, logLabel = 'document-file'): Promise<DocumentFileResult> {
  return withTimeout(fetchDocumentAsBase64Inner(document, logLabel), STORAGE_DOWNLOAD_TIMEOUT_MS, 'storage_download');
}

async function fetchDocumentAsBase64Inner(document: DocumentFileInput, logLabel: string): Promise<DocumentFileResult> {
  const fileUrl = await getFileUrl(document.cloud_storage_path, document.is_public);

  const controller = new AbortController();
  // Leaves the signed-URL step its share of the combined budget above.
  const fetchTimer = setTimeout(() => controller.abort(), STORAGE_DOWNLOAD_TIMEOUT_MS);
  let fileResponse: Response;
  try {
    fileResponse = await fetch(fileUrl, { signal: controller.signal });
  } finally {
    clearTimeout(fetchTimer);
  }
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
