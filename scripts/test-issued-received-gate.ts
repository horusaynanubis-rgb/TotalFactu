/**
 * Regression tests for ISSUED_RECEIVED_CONFIRMED — pure logic, no DB.
 * Run with: npx tsx scripts/test-issued-received-gate.ts
 *
 * Reuses the EXISTING lib/invoice-type-classifier.ts#classifyInvoiceType()
 * verbatim — no classification logic is duplicated here. Proves that the
 * structural pattern behind the two known real corrections found during the
 * exception-review audit (an invoice whose customer field is an individual
 * person, not the company's own legal name/tax_id — so no identity match is
 * possible on either side) reliably produces needs_review=true today, and
 * therefore REVIEW_REQUIRED through the full shadow engine.
 *
 * SANITIZED FIXTURES ONLY: no real company/person names, tax IDs, invoice
 * numbers or amounts from BYOU production data appear below. Only the
 * relevant *structural* condition is reproduced (company identity absent
 * from both supplier and customer fields).
 */
import { classifyInvoiceType, CompanyIdentity } from '../lib/invoice-type-classifier';
import { evaluateInvoiceDecision, EvaluateInvoiceDecisionInput } from '../lib/exception-engine';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

// Sanitized stand-in for the audited company (BYOU). Not the real name/NIF.
const SYNTHETIC_COMPANY: CompanyIdentity = {
  name: 'Café Ejemplo SL',
  tax_id: 'B00000001',
  aliases: [],
};

function buildEvaluateInput(overrides: Partial<EvaluateInvoiceDecisionInput> = {}): EvaluateInvoiceDecisionInput {
  return {
    extraction: {
      invoice_number: 'SYN-0001',
      issue_date: '2026-01-10',
      supplier_name: 'Proveedor Sintético SL',
      customer_name: 'Café Ejemplo SL',
      total_amount: 100,
      extraction_confidence: 0.95,
    },
    invoice: {
      subtotal: 82.64,
      tax_amount: 17.36,
      total_amount: 100,
      invoice_type: 'received',
      supplier_tax_id: 'B99999999',
    },
    fiscalStatus: 'classified',
    duplicateProbableMatchCount: 0,
    invoiceTypeConfirmed: true,
    ...overrides,
  };
}

console.log('\nISSUED_RECEIVED_CONFIRMED — sanitized "Culligan Water"-shaped scenario\n');
{
  // Structural pattern: supplier is a genuine third-party company; customer
  // is an individual person's name/NIF that matches neither the company's
  // legal name nor its tax_id. AI's original (wrong) guess was 'issued'.
  const extraction = {
    invoice_type: 'issued' as const,
    supplier_name: 'Distribuidora de Bebidas Sintética SL',
    supplier_tax_id: 'B11111111',
    customer_name: 'Persona Física de Prueba',
    customer_tax_id: '00000000X',
    needs_review: false,
  };
  const classification = classifyInvoiceType(extraction, SYNTHETIC_COMPANY);
  assert(classification.needs_review === true, 'classifyInvoiceType() forces needs_review — no identity match on either side');
  assert(classification.was_corrected === false, 'No confident correction is made either — AI type kept, but flagged');

  const engineResult = evaluateInvoiceDecision(
    buildEvaluateInput({ invoiceTypeConfirmed: !classification.needs_review }),
  );
  assert(engineResult.decision === 'REVIEW_REQUIRED', 'Full engine: Culligan-shaped scenario -> REVIEW_REQUIRED');
  assert(
    engineResult.rules_failed.some((f) => f.gate === 'ISSUED_RECEIVED_CONFIRMED'),
    'Full engine: ISSUED_RECEIVED_CONFIRMED is the gate that catches it',
  );
}

console.log('\nISSUED_RECEIVED_CONFIRMED — sanitized "Transgourmet"-shaped scenario\n');
{
  // Same structural pattern, different synthetic supplier — proves this
  // isn't a coincidence of one specific fixture.
  const extraction = {
    invoice_type: 'issued' as const,
    supplier_name: 'Alimentación Mayorista Sintética SL',
    supplier_tax_id: 'B22222222',
    customer_name: 'Persona Física de Prueba',
    customer_tax_id: '00000000X',
    needs_review: false,
  };
  const classification = classifyInvoiceType(extraction, SYNTHETIC_COMPANY);
  assert(classification.needs_review === true, 'classifyInvoiceType() forces needs_review — no identity match on either side');

  const engineResult = evaluateInvoiceDecision(
    buildEvaluateInput({ invoiceTypeConfirmed: !classification.needs_review }),
  );
  assert(engineResult.decision === 'REVIEW_REQUIRED', 'Full engine: Transgourmet-shaped scenario -> REVIEW_REQUIRED');
  assert(
    engineResult.rules_failed.some((f) => f.gate === 'ISSUED_RECEIVED_CONFIRMED'),
    'Full engine: ISSUED_RECEIVED_CONFIRMED is the gate that catches it',
  );
}

console.log('\nISSUED_RECEIVED_CONFIRMED — normal invoice, exact tax_id match (control case)\n');
{
  // Company appears as customer via exact tax_id match -> confident,
  // confirmed classification. Proves the gate does not over-block normal
  // invoices where identity is genuinely resolvable.
  const extraction = {
    invoice_type: 'received' as const,
    supplier_name: 'Proveedor Sintético SL',
    supplier_tax_id: 'B99999999',
    customer_name: 'Café Ejemplo SL',
    customer_tax_id: 'B00000001', // exact match on SYNTHETIC_COMPANY.tax_id
    needs_review: false,
  };
  const classification = classifyInvoiceType(extraction, SYNTHETIC_COMPANY);
  assert(classification.needs_review === false, 'Exact tax_id match on customer side -> confirmed, no review forced');
  assert(classification.was_corrected === false, 'AI type already agreed with the confirmed direction');

  const engineResult = evaluateInvoiceDecision(
    buildEvaluateInput({ invoiceTypeConfirmed: !classification.needs_review }),
  );
  assert(
    !engineResult.rules_failed.some((f) => f.gate === 'ISSUED_RECEIVED_CONFIRMED'),
    'Full engine: confirmed invoice_type -> gate passes (does not block normal invoices)',
  );
}

console.log('\nISSUED_RECEIVED_CONFIRMED — name-based match (no tax_id), still resolvable\n');
{
  const extraction = {
    invoice_type: 'issued' as const,
    supplier_name: 'Café Ejemplo SL', // matches company name directly
    supplier_tax_id: null,
    customer_name: 'Cliente Sintético SL',
    customer_tax_id: null,
    needs_review: false,
  };
  const classification = classifyInvoiceType(extraction, SYNTHETIC_COMPANY);
  assert(classification.needs_review === false, 'Name match alone is still treated as confident by the existing classifier');
  assert(classification.invoice_type === 'issued', 'Correctly resolves as issued when company matches supplier_name');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
