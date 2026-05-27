/**
 * Storage abstraction — Supabase Storage backend.
 * All file I/O goes through this module. Never import @aws-sdk anywhere else.
 *
 * Bucket: SUPABASE_STORAGE_BUCKET (default: "invoices")
 * Paths:  uploads/<companyId>/<timestamp>-<filename>
 *         uploads/telegram/<companyId>/<timestamp>-<filename>
 *         exports/<companyId>/<timestamp>-<filename>
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Filename sanitization
// ---------------------------------------------------------------------------

/**
 * Produces a storage-safe filename: strips accents, replaces spaces and
 * non-ASCII chars with hyphens, normalises to a single lowercase extension.
 *
 * "Envío Factura A418.PDF.pdf" → "envio-factura-a418.pdf"
 */
export function sanitizeFilename(filename: string): string {
  // 1. Strip diacritics via NFD decomposition
  const noAccents = filename.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // 2. Split on last dot to get extension (lowercase)
  const lastDot = noAccents.lastIndexOf('.');
  let nameOnly = lastDot > 0 ? noAccents.slice(0, lastDot) : noAccents;
  const lastExt = lastDot > 0 ? noAccents.slice(lastDot).toLowerCase() : '';

  // 3. Collapse double-extensions (e.g. ".PDF.pdf" left after rename): if the
  //    remaining nameOnly still ends with a known extension, drop it.
  const innerDot = nameOnly.lastIndexOf('.');
  if (innerDot > 0) {
    const innerExt = nameOnly.slice(innerDot).toLowerCase();
    if (/^\.(pdf|jpg|jpeg|png|webp|gif|tiff?)$/.test(innerExt)) {
      nameOnly = nameOnly.slice(0, innerDot);
    }
  }

  // 4. Lowercase + replace any non-alphanumeric run with a single hyphen
  const safeName = nameOnly
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document';

  return safeName + lastExt;
}

function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

function bucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || 'invoices';
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function buildUploadPath(companyId: string, filename: string): string {
  return `uploads/${companyId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export function buildTelegramPath(companyId: string, filename: string): string {
  return `uploads/telegram/${companyId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export function buildExportPath(companyId: string, filename: string): string {
  return `exports/${companyId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Upload a Buffer to Supabase Storage (server-side, e.g. Telegram or exports).
 */
export async function uploadFile(
  buffer: Buffer,
  path: string,
  contentType: string,
): Promise<void> {
  const { error } = await getClient()
    .storage.from(bucket())
    .upload(path, buffer, { contentType, upsert: false });

  if (error) throw new Error(`[storage] Upload failed (${path}): ${error.message}`);
}

/**
 * Create a signed upload URL so the browser can PUT a file directly
 * to Supabase Storage without routing through the Next.js server.
 * Returns the same { uploadUrl, cloud_storage_path } shape the frontend expects.
 */
export async function createSignedUploadUrl(
  path: string,
): Promise<{ uploadUrl: string; cloud_storage_path: string }> {
  const { data, error } = await getClient()
    .storage.from(bucket())
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    throw new Error(`[storage] createSignedUploadUrl failed (${path}): ${error?.message}`);
  }

  return { uploadUrl: data.signedUrl, cloud_storage_path: path };
}

/**
 * Get a signed download URL for a private file (valid for `expiresIn` seconds).
 */
export async function getSignedDownloadUrl(
  path: string,
  expiresIn = 3600,
): Promise<string> {
  const { data, error } = await getClient()
    .storage.from(bucket())
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`[storage] createSignedUrl failed (${path}): ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Alias kept for compatibility with callers that used getFileUrl() from lib/s3.
 * `isPublic` is ignored — Supabase bucket stays private, always returns signed URL.
 */
export async function getFileUrl(path: string, _isPublic = false): Promise<string> {
  return getSignedDownloadUrl(path);
}

/**
 * Delete a file. Silently succeeds if the file does not exist.
 */
export async function deleteFile(path: string): Promise<void> {
  const { error } = await getClient().storage.from(bucket()).remove([path]);
  if (error) throw new Error(`[storage] Delete failed (${path}): ${error.message}`);
}

/**
 * Health-check: upload a tiny probe file, read its signed URL, then delete it.
 * Returns a structured result object — never throws.
 */
export async function runStorageHealthCheck(): Promise<{
  ok: boolean;
  bucket: string;
  error?: string;
  signed_url_ok?: boolean;
}> {
  const b = bucket();
  const probePath = `__probe__/${Date.now()}.txt`;

  try {
    const client = getClient();

    const { error: uploadErr } = await client
      .storage.from(b)
      .upload(probePath, Buffer.from('ok'), { contentType: 'text/plain', upsert: true });
    if (uploadErr) return { ok: false, bucket: b, error: `upload: ${uploadErr.message}` };

    const { data: signedData, error: signErr } = await client
      .storage.from(b)
      .createSignedUrl(probePath, 60);
    const signed_url_ok = !signErr && Boolean(signedData?.signedUrl);

    await client.storage.from(b).remove([probePath]);

    return { ok: true, bucket: b, signed_url_ok };
  } catch (err: any) {
    return { ok: false, bucket: b, error: err?.message ?? 'unknown error' };
  }
}
