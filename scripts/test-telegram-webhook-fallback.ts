/**
 * Pure logic test for shouldWebhookSendFallbackMessage in
 * app/api/webhooks/telegram/route.ts — no DB, no network, no Telegram calls.
 * Run with: npx tsx scripts/test-telegram-webhook-fallback.ts
 *
 * Covers the 2026-09-07 diagnóstico finding: whenever /process failed, the
 * webhook UNCONDITIONALLY overwrote the specific Telegram message that
 * process/route.ts had already sent (e.g. "Servicio de IA ocupado
 * temporalmente" or the new billing-exhausted message) with a generic
 * "Error extrayendo datos" — so users never saw the real reason, and kept
 * resending. This locks in the fix: the webhook only sends its own
 * fallback message when process/route.ts could not possibly have reached
 * its own error handler (document not found).
 */
import { shouldWebhookSendFallbackMessage } from '../lib/telegram-webhook-helpers';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nCase: process/route.ts returned 500 (e.g. Gemini billing exhausted, or any other processing error)\n');
{
  assert(
    shouldWebhookSendFallbackMessage(500) === false,
    'Webhook does NOT send its own message — process/route.ts already sent the specific, accurate one',
  );
}

console.log('\nCase: process/route.ts returned 404 (Document row itself was not found)\n');
{
  assert(
    shouldWebhookSendFallbackMessage(404) === true,
    'Webhook DOES send a fallback — process/route.ts never got far enough to message the user itself',
  );
}

console.log('\nCase: other unexpected status codes do not trigger a duplicate/generic message\n');
{
  assert(shouldWebhookSendFallbackMessage(403) === false, '403 -> no fallback (process/route.ts would have handled it)');
  assert(shouldWebhookSendFallbackMessage(400) === false, '400 -> no fallback');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
