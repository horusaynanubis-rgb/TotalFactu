/**
 * Unit tests for lib/exception-engine.ts — pure logic, no DB, no network.
 * Run with: npx tsx scripts/test-exception-engine.ts
 *
 * Covers: each of the 7 HARD gates in isolation (pass + fail), missing
 * critical fields, combined failures, and the conservative-on-malformed-
 * input contract that lib/invoice-decision.ts relies on for its own
 * engine_error fallback.
 */
import { evaluateInvoiceDecision, EvaluateInvoiceDecisionInput, GateName } from '../lib/exception-engine';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

function baseline(): EvaluateInvoiceDecisionInput {
  return {
    extraction: {
      invoice_number: 'F-0001',
      issue_date: '2026-01-15',
      supplier_name: 'Acme Supplies SL',
      customer_name: 'Test Company SL',
      total_amount: 121,
      extraction_confidence: 0.95,
    },
    invoice: {
      subtotal: 100,
      tax_amount: 21,
      total_amount: 121,
      invoice_type: 'received',
      supplier_tax_id: 'B12345678',
    },
    fiscalStatus: 'classified',
    duplicateProbableMatchCount: 0,
    invoiceTypeConfirmed: true,
  };
}

function failedGateNames(result: ReturnType<typeof evaluateInvoiceDecision>): GateName[] {
  return result.rules_failed.map((f) => f.gate);
}

console.log('\nException Engine — clean baseline invoice\n');
{
  const result = evaluateInvoiceDecision(baseline());
  assert(result.decision === 'AUTO_APPROVED', 'Clean invoice -> AUTO_APPROVED');
  assert(result.rules_failed.length === 0, 'Clean invoice -> zero failed gates');
  assert(result.rules_evaluated.length === 7, 'All 7 gates evaluated');
  assert(result.rules_passed.length === 7, 'All 7 gates passed');
}

console.log('\nException Engine — EXTRACTION_COMPLETE\n');
{
  for (const field of ['invoice_number', 'issue_date', 'supplier_name', 'customer_name'] as const) {
    const input = baseline();
    (input.extraction as any)[field] = '';
    const result = evaluateInvoiceDecision(input);
    assert(
      failedGateNames(result).includes('EXTRACTION_COMPLETE'),
      `Missing extraction.${field} -> EXTRACTION_COMPLETE fails`,
    );
    assert(result.decision === 'REVIEW_REQUIRED', `Missing extraction.${field} -> REVIEW_REQUIRED`);
  }
  const zeroTotal = baseline();
  zeroTotal.extraction.total_amount = 0;
  const result = evaluateInvoiceDecision(zeroTotal);
  assert(failedGateNames(result).includes('EXTRACTION_COMPLETE'), 'total_amount=0 -> EXTRACTION_COMPLETE fails');
}

console.log('\nException Engine — EXTRACTION_CONFIDENCE\n');
{
  const input = baseline();
  input.extraction.extraction_confidence = 0.5;
  const result = evaluateInvoiceDecision(input);
  assert(failedGateNames(result).includes('EXTRACTION_CONFIDENCE'), 'confidence 0.5 (<0.70) -> gate fails');
  assert(result.decision === 'REVIEW_REQUIRED', 'Low confidence -> REVIEW_REQUIRED');

  const borderline = baseline();
  borderline.extraction.extraction_confidence = 0.7;
  const borderlineResult = evaluateInvoiceDecision(borderline);
  assert(!failedGateNames(borderlineResult).includes('EXTRACTION_CONFIDENCE'), 'confidence exactly 0.70 -> gate passes (inclusive floor)');
}

console.log('\nException Engine — ARITHMETIC_VALID\n');
{
  const input = baseline();
  input.invoice.total_amount = 200; // subtotal(100) + tax(21) = 121 != 200
  const result = evaluateInvoiceDecision(input);
  assert(failedGateNames(result).includes('ARITHMETIC_VALID'), 'subtotal+tax far from total -> gate fails');

  const withinTolerance = baseline();
  withinTolerance.invoice.total_amount = 121.4; // 0.40€ off, tolerance is 0.50€
  const toleranceResult = evaluateInvoiceDecision(withinTolerance);
  assert(!failedGateNames(toleranceResult).includes('ARITHMETIC_VALID'), '0.40€ discrepancy within 0.50€ tolerance -> gate passes');
}

console.log('\nException Engine — FISCAL_CLASSIFICATION_VALID\n');
{
  for (const status of ['pending_classification', 'mixed_vat', 'manual_review']) {
    const input = baseline();
    input.fiscalStatus = status;
    const result = evaluateInvoiceDecision(input);
    assert(failedGateNames(result).includes('FISCAL_CLASSIFICATION_VALID'), `fiscal_status='${status}' -> gate fails`);
    const failure = result.rules_failed.find((f) => f.gate === 'FISCAL_CLASSIFICATION_VALID');
    assert(failure?.reason === `fiscal_status_${status}`, `review_reason encodes the specific fiscal_status ('${status}')`);
  }
}

console.log('\nException Engine — NOT_DUPLICATE\n');
{
  const input = baseline();
  input.duplicateProbableMatchCount = 1;
  const result = evaluateInvoiceDecision(input);
  assert(failedGateNames(result).includes('NOT_DUPLICATE'), '1 probable duplicate match -> gate fails');
}

console.log('\nException Engine — SUPPLIER_TAX_ID_PRESENT\n');
{
  const input = baseline();
  input.invoice.supplier_tax_id = null;
  const result = evaluateInvoiceDecision(input);
  assert(failedGateNames(result).includes('SUPPLIER_TAX_ID_PRESENT'), 'received invoice, missing supplier_tax_id -> gate fails');

  const issued = baseline();
  issued.invoice.invoice_type = 'issued';
  issued.invoice.supplier_tax_id = null;
  const issuedResult = evaluateInvoiceDecision(issued);
  assert(
    !failedGateNames(issuedResult).includes('SUPPLIER_TAX_ID_PRESENT'),
    'issued invoice, missing supplier_tax_id -> gate does not apply, passes',
  );
}

console.log('\nException Engine — ISSUED_RECEIVED_CONFIRMED\n');
{
  const input = baseline();
  input.invoiceTypeConfirmed = false;
  const result = evaluateInvoiceDecision(input);
  assert(failedGateNames(result).includes('ISSUED_RECEIVED_CONFIRMED'), 'classifyInvoiceType() found no identity match -> gate fails');
  assert(result.decision === 'REVIEW_REQUIRED', 'Unconfirmed issued/received -> REVIEW_REQUIRED');
}

console.log('\nException Engine — combined failures\n');
{
  const input = baseline();
  input.extraction.extraction_confidence = 0.4;
  input.duplicateProbableMatchCount = 2;
  const result = evaluateInvoiceDecision(input);
  const names = failedGateNames(result);
  assert(names.includes('EXTRACTION_CONFIDENCE') && names.includes('NOT_DUPLICATE'), 'Two independent gate failures both captured');
  assert(result.rules_failed.length === 2, 'Exactly 2 gates failed, not more');
  assert(result.rules_passed.length === 5, 'The other 5 gates still recorded as passed');
  assert(result.decision === 'REVIEW_REQUIRED', 'Any failure -> REVIEW_REQUIRED (never partial auto-approval)');
}

console.log('\nException Engine — signals snapshot\n');
{
  const result = evaluateInvoiceDecision(baseline());
  assert(result.signals.fiscal_status === 'classified', 'signals.fiscal_status captured');
  assert(result.signals.invoice_type_confirmed === true, 'signals.invoice_type_confirmed captured');
  assert(result.signals.supplier_tax_id_present === true, 'signals.supplier_tax_id_present captured');
  assert(typeof result.signals.arithmetic_delta_eur === 'number', 'signals.arithmetic_delta_eur is numeric');
}

console.log('\nException Engine — conservative on malformed input (never silently AUTO_APPROVED)\n');
{
  let threw = false;
  try {
    evaluateInvoiceDecision(null as any);
  } catch {
    threw = true;
  }
  assert(threw, 'null input throws rather than returning a decision — caller (lib/invoice-decision.ts) must catch and fall back to REVIEW_REQUIRED');
}

console.log('\nRegression — realistic full-invoice scenarios\n');
{
  // Known duplicate pattern (mirrors the FRIOLISA/FRIDOLISA-shaped case
  // already covered structurally by scripts/test-duplicate-detection.ts):
  // a probable duplicate match should block AUTO_APPROVED even when every
  // other gate is clean.
  const duplicateCase = baseline();
  duplicateCase.duplicateProbableMatchCount = 1;
  const duplicateResult = evaluateInvoiceDecision(duplicateCase);
  assert(duplicateResult.decision === 'REVIEW_REQUIRED', 'Probable duplicate, everything else clean -> REVIEW_REQUIRED');
  assert(failedGateNames(duplicateResult).length === 1 && failedGateNames(duplicateResult)[0] === 'NOT_DUPLICATE', 'Only NOT_DUPLICATE fails — no unrelated gate side effects');

  // Fiscal pending_classification: local rate resolution hasn't run/succeeded yet.
  const fiscalPendingCase = baseline();
  fiscalPendingCase.fiscalStatus = 'pending_classification';
  const fiscalPendingResult = evaluateInvoiceDecision(fiscalPendingCase);
  assert(fiscalPendingResult.decision === 'REVIEW_REQUIRED', 'fiscal_status=pending_classification -> REVIEW_REQUIRED');

  // Fiscal manual_review: the VAT-only Gemini second pass already tried and failed — terminal state.
  const fiscalManualCase = baseline();
  fiscalManualCase.fiscalStatus = 'manual_review';
  const fiscalManualResult = evaluateInvoiceDecision(fiscalManualCase);
  assert(fiscalManualResult.decision === 'REVIEW_REQUIRED', 'fiscal_status=manual_review -> REVIEW_REQUIRED');

  // Normal, clean invoice (repeated here explicitly as a named regression
  // fixture, not just the baseline sanity check above).
  const normalResult = evaluateInvoiceDecision(baseline());
  assert(normalResult.decision === 'AUTO_APPROVED', 'Normal clean invoice, all 7 gates pass -> AUTO_APPROVED');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
