/**
 * Pure logic tests for the review-queue "clasificación fiscal pendiente"
 * behavior (Fase Gascón, 2026-09) — no DB, no network, matching the style of
 * scripts/test-gestoria-eligibility.ts (this repo's test scripts don't mock
 * Prisma).
 *
 * Exercises lib/review-queue.ts (the exact rule GET /api/review's Prisma
 * `where` uses — see reviewQueueInvoiceWhere()) and confirms via
 * lib/invoice-fiscal-treatment.ts that suggested_document_type alone never
 * moves a fiscal calculation; only a confirmed document_type does. Cases
 * 5-7 here overlap by design with scripts/test-fiscal-classification-and-period.ts
 * (not a regression risk, just belt-and-braces for this specific task).
 *
 * Run with: npx tsx scripts/test-review-queue-fiscal-classification.ts
 */
import { isInReviewQueue, isFiscalClassificationPending, ReviewQueueInvoiceInput } from '../lib/review-queue';
import { getDeductibleInputVat, getExpenseAmount } from '../lib/invoice-fiscal-treatment';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

function inv(overrides: Partial<ReviewQueueInvoiceInput>): ReviewQueueInvoiceInput {
  return { review_status: 'approved', document_type: null, suggested_document_type: null, ...overrides };
}

console.log('\nCase 1: review_status=pending appears in the queue regardless of document_type/suggestion\n');
{
  const a = inv({ review_status: 'pending', document_type: null, suggested_document_type: null });
  const b = inv({ review_status: 'pending', document_type: 'FULL_INVOICE', suggested_document_type: 'FULL_INVOICE' });
  assert(isInReviewQueue(a) === true, 'pending, sin sugerencia -> en cola (comportamiento de siempre)');
  assert(isInReviewQueue(b) === true, 'pending, aunque ya tenga document_type confirmado -> sigue en cola por review_status');
}

console.log('\nCase 2: approved + suggested_document_type + document_type NULL appears (the 14 BYOU candidates)\n');
{
  const a = inv({ review_status: 'approved', document_type: null, suggested_document_type: 'SIMPLIFIED_INVOICE' });
  assert(isInReviewQueue(a) === true, 'approved con sugerencia pendiente de confirmar -> SÍ aparece en la cola');
  assert(isFiscalClassificationPending(a) === true, 'se etiqueta como clasificación fiscal pendiente (no como error de procesamiento)');
}

console.log('\nCase 3: approved + suggested + document_type=FULL_INVOICE confirmed does NOT appear\n');
{
  const a = inv({ review_status: 'approved', document_type: 'FULL_INVOICE', suggested_document_type: 'SIMPLIFIED_INVOICE' });
  assert(isInReviewQueue(a) === false, 'una vez confirmado FULL_INVOICE, desaparece de la cola aunque review_status ya fuera approved');
}

console.log('\nCase 4: approved + suggested + document_type=SIMPLIFIED_INVOICE confirmed does NOT appear\n');
{
  const a = inv({ review_status: 'approved', document_type: 'SIMPLIFIED_INVOICE', suggested_document_type: 'SIMPLIFIED_INVOICE' });
  assert(isInReviewQueue(a) === false, 'una vez confirmado SIMPLIFIED_INVOICE, desaparece de la cola aunque review_status ya fuera approved');
}

console.log('\nCase 5: suggested_document_type alone never moves a fiscal calculation\n');
{
  // document_type stays NULL — only suggested_document_type is set, exactly
  // the state of the 14 BYOU candidates after the audit UPDATE.
  const a = { document_type: null as string | null, tax_amount: 21, subtotal: 100, total_amount: 121 };
  assert(getDeductibleInputVat(a) === 21, 'IVA deducible sigue siendo tax_amount completo — la sugerencia no se lee aquí');
  assert(getExpenseAmount(a) === 100, 'gasto sigue siendo subtotal — la sugerencia no se lee aquí');
}

console.log('\nCase 6: confirming FULL_INVOICE keeps normal treatment\n');
{
  const a = { document_type: 'FULL_INVOICE', tax_amount: 21, subtotal: 100, total_amount: 121 };
  assert(getDeductibleInputVat(a) === 21, 'FULL_INVOICE confirmado -> IVA deducible = tax_amount (tratamiento normal)');
  assert(getExpenseAmount(a) === 100, 'FULL_INVOICE confirmado -> gasto = subtotal (tratamiento normal)');
}

console.log('\nCase 7: confirming SIMPLIFIED_INVOICE applies gasto=total and IVA deducible=0\n');
{
  const a = { document_type: 'SIMPLIFIED_INVOICE', tax_amount: 2.10, subtotal: 10.00, total_amount: 12.10 };
  assert(getDeductibleInputVat(a) === 0, 'SIMPLIFIED_INVOICE confirmado -> IVA deducible = 0');
  assert(getExpenseAmount(a) === 12.10, 'SIMPLIFIED_INVOICE confirmado -> gasto = total_amount');
  assert(a.tax_amount === 2.10 && a.subtotal === 10.00 && a.total_amount === 12.10, 'los importes documentales originales no se mutan');
}

console.log('\nCase 8: other approved invoices without any suggestion do NOT appear\n');
{
  const a = inv({ review_status: 'approved', document_type: null, suggested_document_type: null });
  assert(isInReviewQueue(a) === false, 'approved, document_type NULL, sin sugerencia -> NO aparece (comportamiento previo intacto)');
  assert(isFiscalClassificationPending(a) === false, 'no se etiqueta como clasificación fiscal pendiente');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
