/**
 * Pure logic tests for the Gemini fetch-timeout marker in lib/ai-extraction.ts
 * — no DB, no real network calls (does not hit Gemini).
 * Run with: npx tsx scripts/test-gemini-timeout.ts
 *
 * Covers the live 2026-09-08 incident: a specific file made Gemini's
 * generateContent call hang with no response, no HTTP error — the request
 * just never resolved. Without a client-side timeout, the only thing that
 * ever stopped it was the serverless platform silently killing the whole
 * function past its maxDuration, which meant the Document stayed
 * "processing" forever with zero AuditLog trail and no Telegram message.
 */
import { isGeminiTimeoutError, GEMINI_TIMEOUT_MARKER, isBillingExhaustedGeminiError } from '../lib/ai-extraction';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nCase: a tagged timeout Error is recognised\n');
{
  const err = new Error(`${GEMINI_TIMEOUT_MARKER} no response after 40000ms`);
  assert(isGeminiTimeoutError(err) === true, 'Detected as a Gemini timeout');
  assert(isBillingExhaustedGeminiError(err) === false, 'A timeout is NOT misclassified as billing-exhausted');
}

console.log('\nCase: a generic error is not mistaken for a timeout\n');
{
  assert(isGeminiTimeoutError(new Error('Gemini API error (429): quota')) === false, 'A 429 body is not a timeout');
  assert(isGeminiTimeoutError(new Error('MAX_TOKENS')) === false, 'Unrelated errors are not timeouts');
  assert(isGeminiTimeoutError('not an Error object') === false, 'Non-Error values never throw, just return false');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
