/**
 * Pure logic tests for the billing-exhausted vs transient-error
 * classification in lib/ai-extraction.ts — no DB, no network.
 * Run with: npx tsx scripts/test-gemini-error-classification.ts
 *
 * Covers the 2026-09-07 incident: the API returned 429 for a permanently
 * depleted prepaid balance, and the old code retried it 3x per document
 * like a transient rate limit — tripling wasted request volume for a
 * failure that retrying could never fix.
 */
import { isBillingExhaustedError, isBillingExhaustedGeminiError, GEMINI_BILLING_EXHAUSTED_MARKER } from '../lib/ai-extraction';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const REAL_BILLING_EXHAUSTED_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay. ',
    status: 'RESOURCE_EXHAUSTED',
  },
});

console.log('\nCase: billing-exhausted 429 (the real 2026-09-07 error body)\n');
{
  assert(isBillingExhaustedError(429, REAL_BILLING_EXHAUSTED_BODY) === true, 'Detected as billing-exhausted');
}

console.log('\nCase: transient rate-limit 429 (generic quota message, no billing text)\n');
{
  const body = JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } });
  assert(isBillingExhaustedError(429, body) === false, 'NOT classified as billing-exhausted');
}

console.log('\nCase: 503 UNAVAILABLE (transient, not billing)\n');
{
  const body = JSON.stringify({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } });
  assert(isBillingExhaustedError(503, body) === false, '503 is never billing-exhausted (wrong status code)');
}

console.log('\nCase: 200 OK is never billing-exhausted regardless of body text\n');
{
  assert(isBillingExhaustedError(200, REAL_BILLING_EXHAUSTED_BODY) === false, 'Only 429 can be billing-exhausted');
}

console.log('\nCase: error marker round-trip — isBillingExhaustedGeminiError detects the tagged Error\n');
{
  const taggedError = new Error(`${GEMINI_BILLING_EXHAUSTED_MARKER} ${REAL_BILLING_EXHAUSTED_BODY.slice(0, 100)}`);
  const genericError = new Error('Gemini API error (429): some other 429 body');
  assert(isBillingExhaustedGeminiError(taggedError) === true, 'Tagged billing-exhausted Error is detected');
  assert(isBillingExhaustedGeminiError(genericError) === false, 'A generic 429 Error (not billing-tagged) is NOT flagged as billing-exhausted');
  assert(isBillingExhaustedGeminiError(new Error('MAX_TOKENS')) === false, 'Unrelated errors are not flagged');
  assert(isBillingExhaustedGeminiError('not an Error object') === false, 'Non-Error values never throw, just return false');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
