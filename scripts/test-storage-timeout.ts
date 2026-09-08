/**
 * Pure logic test for the storage-download timeout marker in
 * lib/document-file.ts — no DB, no real network/Supabase calls.
 * Run with: npx tsx scripts/test-storage-timeout.ts
 *
 * Covers the gap found on 2026-09-08: fetchDocumentAsBase64() had no
 * timeout at all (neither the Supabase signed-URL call nor the file
 * download), so a hang there — before Gemini is ever reached, before
 * content_hash is even computed — silently blocked the function until the
 * platform killed it. Confirmed live: documentId cmtstmejk... had
 * content_hash=null and updated_at only 1.4s after creation, then nothing.
 */
import { isStorageTimeoutError, STORAGE_DOWNLOAD_TIMEOUT_MARKER } from '../lib/document-file';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nCase: a tagged storage-timeout Error is recognised\n');
{
  const err = new Error(`${STORAGE_DOWNLOAD_TIMEOUT_MARKER} storage_download exceeded 20000ms`);
  assert(isStorageTimeoutError(err) === true, 'Detected as a storage timeout');
}

console.log('\nCase: unrelated errors are not mistaken for a storage timeout\n');
{
  assert(isStorageTimeoutError(new Error('storage fetch failed (404 Not Found)')) === false, 'A real 404 is not a timeout');
  assert(isStorageTimeoutError(new Error('Gemini:TIMEOUT: no response after 40000ms')) === false, 'A Gemini timeout is a different marker, not confused with storage');
  assert(isStorageTimeoutError('not an Error object') === false, 'Non-Error values never throw, just return false');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
