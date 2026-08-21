/**
 * Pure logic tests for lib/fiscal-breakdown.ts (getInvoiceFiscalBreakdown) and
 * lib/csv-generator.ts (generateCSV) — no DB, no network.
 * Run with: npx tsx scripts/test-fiscal-breakdown.ts
 *
 * Covers audit cases:
 *   4. Invoice with a single VAT rate.
 *   5. Invoice with mixed VAT rates (reconciled line split).
 *   6. facturas.csv and resumen_fiscal.csv derive identical totals — because
 *      both now call the exact same function, this test proves it by
 *      independently summing generateCSV's per-row columns and comparing
 *      against a direct getInvoiceFiscalBreakdown aggregation (the same
 *      shape lib/fiscal-summary.ts builds).
 *   Plus regression coverage for two bugs the audit found:
 *     - falsy-0: tax_rate === 0 must not render blank.
 *     - fraction-vs-percentage: tax_rate === 0.1 must be read as 10%, not ~0%.
 */
import { getInvoiceFiscalBreakdown, FiscalBreakdownInput } from '../lib/fiscal-breakdown';
import { generateCSV, InvoiceWithDocument } from '../lib/csv-generator';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nCase 4: single VAT rate (header only, no lines)\n');
{
  const input: FiscalBreakdownInput = {
    tax_rate: 21, subtotal: 100, tax_amount: 21, total_amount: 121,
    invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false,
  };
  const b = getInvoiceFiscalBreakdown(input);
  assert(b.base21 === 100 && b.vat21 === 21, 'Single 21% invoice lands entirely in base21/vat21');
  assert(b.base0 === 0 && b.base4 === 0 && b.base10 === 0, 'Other rate buckets stay at 0');
  assert(b.classificationStatus === 'classified', 'classificationStatus = classified');
  assert(b.classificationSource === 'invoice_header', 'classificationSource = invoice_header');
  assert(b.confidence === 'verified', 'confidence = verified for a header rate');
  assert(b.warnings.length === 0, 'No warnings for a clean single-rate invoice');
}

console.log('\nCase 5: mixed VAT rates (lines disagree, split reconciles with header)\n');
{
  // 60€ @ 4% (2.40) + 40€ @ 21% (8.40) = 100€ base, 10.80€ IVA, reconciles with header.
  const input: FiscalBreakdownInput = {
    tax_rate: null, subtotal: 100, tax_amount: 10.80, total_amount: 110.80,
    invoice_lines: [
      { tax_rate: 4, total_amount: 60 },
      { tax_rate: 21, total_amount: 40 },
    ],
    ai_vat_breakdown: null, vat_reclassification_attempted: false,
  };
  const b = getInvoiceFiscalBreakdown(input);
  assert(Math.abs(b.base4 - 60) < 0.01 && Math.abs(b.vat4 - 2.4) < 0.01, 'base4/vat4 correct for the mixed invoice');
  assert(Math.abs(b.base21 - 40) < 0.01 && Math.abs(b.vat21 - 8.4) < 0.01, 'base21/vat21 correct for the mixed invoice');
  assert(b.classificationSource === 'line_items', 'classificationSource = line_items for a reconciled multi-rate split');
  assert(b.classificationStatus === 'classified', 'A reconciled mixed-VAT invoice is still classified, not mixed_vat');
}

console.log('\nRegression: falsy-0 bug (tax_rate === 0 must not render blank)\n');
{
  const input: FiscalBreakdownInput = {
    tax_rate: 0, subtotal: 50, tax_amount: 0, total_amount: 50,
    invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false,
  };
  const b = getInvoiceFiscalBreakdown(input);
  assert(b.classificationStatus === 'classified', 'tax_rate=0 is classified, not unclassified (old bug treated 0 as falsy)');
  assert(b.base0 === 50, 'tax_rate=0 lands in base0, not silently dropped');

  const mockInvoice: Partial<InvoiceWithDocument> = {
    invoice_type: 'received', issue_date: new Date('2026-04-07'), due_date: null,
    invoice_number: '255', supplier_name: 'FECOTUR', supplier_tax_id: null,
    customer_name: 'BYOU', customer_tax_id: null,
    subtotal: 50, tax_amount: 0, total_amount: 50, currency: 'EUR', tax_rate: 0,
    payment_method: null, category: null, notes: null, extraction_confidence: 0.9,
    review_status: 'approved', document: { source_channel: 'web' } as any,
    invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false,
  };
  const csv = generateCSV([mockInvoice as InvoiceWithDocument]);
  const dataLine = csv.split('\r\n')[1];
  assert(!!dataLine && dataLine.split(';')[12] === '0.00', 'facturas.csv tax_rate column prints "0.00" for a real 0% invoice, not blank');
}

console.log('\nRegression: fraction-vs-percentage bug (tax_rate === 0.1 means 10%, not ~0%)\n');
{
  const input: FiscalBreakdownInput = {
    tax_rate: 0.1, subtotal: 55.56, tax_amount: 5.56, total_amount: 61.12,
    invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false,
  };
  const b = getInvoiceFiscalBreakdown(input);
  assert(b.base10 > 0 && b.base0 === 0, 'tax_rate=0.1 is normalized to 10% (base10), not misread as 0% (base0)');
}

console.log('\nCase 6: facturas.csv per-row columns sum to the same totals as a direct fiscal-breakdown aggregation\n');
{
  const rows: Partial<InvoiceWithDocument>[] = [
    { invoice_type: 'received', issue_date: new Date('2026-04-01'), due_date: null, invoice_number: 'A1', supplier_name: 'S1', supplier_tax_id: null, customer_name: 'BYOU', customer_tax_id: null, subtotal: 100, tax_amount: 21, total_amount: 121, currency: 'EUR', tax_rate: 21, payment_method: null, category: null, notes: null, extraction_confidence: 0.9, review_status: 'approved', document: { source_channel: 'web' } as any, invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false },
    { invoice_type: 'received', issue_date: new Date('2026-04-02'), due_date: null, invoice_number: 'A2', supplier_name: 'S2', supplier_tax_id: null, customer_name: 'BYOU', customer_tax_id: null, subtotal: 50, tax_amount: 2, total_amount: 52, currency: 'EUR', tax_rate: 4, payment_method: null, category: null, notes: null, extraction_confidence: 0.9, review_status: 'approved', document: { source_channel: 'telegram' } as any, invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false },
    // subtotal/tax_amount imply ~13% — not within tolerance of any standard rate (0/4/10/21), so this one is genuinely unclassified.
    { invoice_type: 'received', issue_date: new Date('2026-04-03'), due_date: null, invoice_number: 'A3', supplier_name: 'S3', supplier_tax_id: null, customer_name: 'BYOU', customer_tax_id: null, subtotal: 10, tax_amount: 1.30, total_amount: 11.30, currency: 'EUR', tax_rate: null, payment_method: null, category: null, notes: null, extraction_confidence: 0.9, review_status: 'approved', document: { source_channel: 'web' } as any, invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false },
  ];

  // "facturas.csv" side: parse the generated CSV back out.
  const csv = generateCSV(rows as InvoiceWithDocument[]);
  const lines = csv.replace('﻿', '').split('\r\n');
  const header = lines[0].split(';');
  const idx = (col: string) => header.indexOf(col);
  let csvBase21 = 0, csvVat21 = 0, csvBase4 = 0, csvVat4 = 0, csvUnclassifiedCount = 0;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cols = line.split(';');
    csvBase21 += Number(cols[idx('base_iva_21')] || 0);
    csvVat21 += Number(cols[idx('cuota_iva_21')] || 0);
    csvBase4 += Number(cols[idx('base_iva_4')] || 0);
    csvVat4 += Number(cols[idx('cuota_iva_4')] || 0);
    if (cols[idx('estado_fiscal')] !== 'classified') csvUnclassifiedCount++;
  }

  // "resumen_fiscal.csv" side: the same aggregation lib/fiscal-summary.ts does, via the same function.
  let summaryBase21 = 0, summaryVat21 = 0, summaryBase4 = 0, summaryVat4 = 0, summaryUnclassifiedCount = 0;
  for (const row of rows) {
    const b = getInvoiceFiscalBreakdown({
      tax_rate: row.tax_rate!, subtotal: row.subtotal!, tax_amount: row.tax_amount!, total_amount: row.total_amount!,
      invoice_lines: [], ai_vat_breakdown: null, vat_reclassification_attempted: false,
    });
    summaryBase21 += b.base21; summaryVat21 += b.vat21;
    summaryBase4 += b.base4; summaryVat4 += b.vat4;
    if (b.classificationStatus !== 'classified') summaryUnclassifiedCount++;
  }

  assert(csvBase21 === summaryBase21 && csvVat21 === summaryVat21, 'base21/vat21 totals match between facturas.csv and the resumen-style aggregation');
  assert(csvBase4 === summaryBase4 && csvVat4 === summaryVat4, 'base4/vat4 totals match between facturas.csv and the resumen-style aggregation');
  assert(csvUnclassifiedCount === summaryUnclassifiedCount && csvUnclassifiedCount === 1, '"sin clasificar" count matches (the A3 row with no tax_rate/lines) — the exact bug class the audit found');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
