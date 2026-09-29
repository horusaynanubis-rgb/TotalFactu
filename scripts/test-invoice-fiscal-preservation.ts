/**
 * Pure logic tests for lib/invoice-fiscal-preservation.ts
 * (extractPreservedFiscalFields) — no DB, no network.
 * Run with: npx tsx scripts/test-invoice-fiscal-preservation.ts
 *
 * Guards the Fase Gascón (2026-09) requirement: reprocessing a document must
 * never erase a human-confirmed document_type or fiscal_period, even though
 * lib/document-processing.ts#processDocument() deletes and recreates the
 * Invoice row from scratch on every retry.
 */
import { extractPreservedFiscalFields, PreservableFiscalFields } from '../lib/invoice-fiscal-preservation';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

function invoice(overrides: Partial<PreservableFiscalFields>): PreservableFiscalFields {
  return {
    document_type: null,
    suggested_document_type: null,
    document_type_classified_by: null,
    document_type_classified_at: null,
    fiscal_period_year: null,
    fiscal_period_quarter: null,
    fiscal_period_set_by: null,
    fiscal_period_set_at: null,
    ...overrides,
  };
}

console.log('\nCase 1: untouched invoice (all NULL) — nothing to preserve\n');
{
  const preserved = extractPreservedFiscalFields(invoice({}));
  assert(Object.keys(preserved).length === 0, 'objeto de preservación vacío cuando no hay nada confirmado por humano');
}

console.log('\nCase 2: human-confirmed document_type must survive reprocess\n');
{
  const classifiedAt = new Date('2026-09-29T10:00:00Z');
  const old = invoice({
    document_type: 'SIMPLIFIED_INVOICE',
    document_type_classified_by: 'user_barbara',
    document_type_classified_at: classifiedAt,
    suggested_document_type: 'SIMPLIFIED_INVOICE',
  });
  const preserved = extractPreservedFiscalFields(old);
  assert(preserved.document_type === 'SIMPLIFIED_INVOICE', 'document_type confirmado se preserva');
  assert(preserved.document_type_classified_by === 'user_barbara', 'document_type_classified_by se preserva');
  assert(preserved.document_type_classified_at === classifiedAt, 'document_type_classified_at se preserva');
  assert(!('suggested_document_type' in preserved), 'suggested_document_type NO se preserva — se recalcula de cero en cada intento');
  assert(!('fiscal_period_year' in preserved), 'fiscal_period no se toca cuando solo document_type estaba confirmado');
}

console.log('\nCase 3: merely-suggested (never confirmed) document_type is dropped, not preserved\n');
{
  const old = invoice({
    suggested_document_type: 'SIMPLIFIED_INVOICE',
    document_type: null,
    document_type_classified_by: null,
  });
  const preserved = extractPreservedFiscalFields(old);
  assert(!('document_type' in preserved), 'document_type sin confirmar humanamente no se preserva — puede volver a sugerirse desde cero');
}

console.log('\nCase 4: human-confirmed fiscal_period (manual override) must survive reprocess\n');
{
  const setAt = new Date('2026-09-29T11:00:00Z');
  const old = invoice({
    fiscal_period_year: 2026,
    fiscal_period_quarter: 3,
    fiscal_period_set_by: 'user_gascon',
    fiscal_period_set_at: setAt,
  });
  const preserved = extractPreservedFiscalFields(old);
  assert(preserved.fiscal_period_year === 2026, 'fiscal_period_year confirmado se preserva');
  assert(preserved.fiscal_period_quarter === 3, 'fiscal_period_quarter confirmado se preserva');
  assert(preserved.fiscal_period_set_by === 'user_gascon', 'fiscal_period_set_by se preserva');
  assert(preserved.fiscal_period_set_at === setAt, 'fiscal_period_set_at se preserva');
  assert(!('document_type' in preserved), 'document_type no se toca cuando solo fiscal_period estaba confirmado');
}

console.log('\nCase 5: default fiscal_period (never manually set) is NOT preserved — must be free to recompute from a possibly-corrected issue_date\n');
{
  const old = invoice({
    fiscal_period_year: 2026,
    fiscal_period_quarter: 2,
    fiscal_period_set_by: null, // default-from-issue_date, never touched by a human
  });
  const preserved = extractPreservedFiscalFields(old);
  assert(!('fiscal_period_year' in preserved), 'fiscal_period sin fiscal_period_set_by no se preserva — no era una decisión humana');
}

console.log('\nCase 6: both document_type and fiscal_period confirmed by humans — both survive independently\n');
{
  const old = invoice({
    document_type: 'FULL_INVOICE',
    document_type_classified_by: 'user_barbara',
    document_type_classified_at: new Date('2026-09-01T00:00:00Z'),
    fiscal_period_year: 2026,
    fiscal_period_quarter: 3,
    fiscal_period_set_by: 'user_gascon',
    fiscal_period_set_at: new Date('2026-09-02T00:00:00Z'),
  });
  const preserved = extractPreservedFiscalFields(old);
  assert(preserved.document_type === 'FULL_INVOICE', 'document_type se preserva junto con fiscal_period');
  assert(preserved.fiscal_period_quarter === 3, 'fiscal_period_quarter se preserva junto con document_type');
}

console.log('\nCase 7: preserved fields, once merged into a fresh invoiceData, must win over extraction defaults (spread-order contract)\n');
{
  // Mirrors the exact merge lib/document-processing.ts performs:
  //   { ...invoiceData, ...preservedFiscalFields }
  const old = invoice({
    document_type: 'SIMPLIFIED_INVOICE',
    document_type_classified_by: 'user_barbara',
    document_type_classified_at: new Date('2026-09-01T00:00:00Z'),
  });
  const preserved = extractPreservedFiscalFields(old);
  const freshInvoiceData: Record<string, unknown> = { document_type: null, some_other_field: 'from-extraction' };
  const merged: Record<string, unknown> = { ...freshInvoiceData, ...preserved };
  assert(merged.document_type === 'SIMPLIFIED_INVOICE', 'el spread de preservedFiscalFields tras invoiceData hace que el valor humano gane sobre el de extracción');
  assert(merged.some_other_field === 'from-extraction', 'campos de extracción no relacionados no se ven afectados por el merge');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
