/**
 * Pure logic tests for lib/duplicate-detection.ts — no DB, no network.
 * Run with: npx tsx scripts/test-duplicate-detection.ts
 *
 * Covers audit cases:
 *   1. Two uploads of the same document via web + Telegram -> strong match.
 *   2. Same invoice, different filename/channel, resent later -> probable match.
 *   3. A genuinely different invoice that happens to share a total -> no match.
 */
import { checkDuplicate, groupDuplicates, DuplicateInvoiceRef } from '../lib/duplicate-detection';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nDuplicate Detection — Case 1: same doc, web + Telegram (BYOU FE-2479735 pattern)\n');
{
  const existing: DuplicateInvoiceRef[] = [{
    invoiceId: 'inv-web-1',
    documentId: 'doc-web-1',
    invoiceNumber: 'FE-2479735',
    supplierName: 'FRIOLISA S.A.U.',
    supplierTaxId: null, // OCR didn't extract it on this copy — this is exactly why the OLD supplier_tax_id-only UI badge missed it
    issueDate: new Date('2026-04-11'),
    totalAmount: 228.03,
    sourceChannel: 'web',
    originalFilename: 'FE-2479735.pdf',
    createdAt: new Date('2026-06-03T09:48:00Z'),
  }];
  const candidate = {
    invoiceNumber: 'FE-2479735',
    supplierName: 'FRIOLISA S.A.U.',
    supplierTaxId: null,
    issueDate: new Date('2026-04-11'),
    totalAmount: 228.03,
    sourceChannel: 'telegram',
    originalFilename: 'photo_123.jpg',
  };
  const result = checkDuplicate(candidate, existing);
  assert(result.strongMatch !== null, 'Same invoice_number + supplier_name + total across channels -> STRONG match');
  assert(result.strongMatch?.existing.invoiceId === 'inv-web-1', 'Strong match points at the correct existing invoice');
  assert(result.probableMatches.length === 0, 'No leftover probable matches once a strong match is found');
}

console.log('\nDuplicate Detection — Regression: OCR typo in supplier name must still match (BYOU FE-2485420 pattern)\n');
{
  const existing: DuplicateInvoiceRef[] = [{
    invoiceId: 'inv-web-2',
    documentId: 'doc-web-2',
    invoiceNumber: 'FE-2485420',
    supplierName: 'FRIOLISA S.A.U.',
    supplierTaxId: null,
    issueDate: new Date('2026-04-22'),
    totalAmount: 163.18,
    sourceChannel: 'web',
    originalFilename: 'FE-2485420.pdf',
    createdAt: new Date('2026-06-03T09:57:00Z'),
  }];
  const candidate = {
    invoiceNumber: 'FE-2485420',
    supplierName: 'FRIDOLISA S.A.U.', // one inserted letter — real OCR output for the same supplier
    supplierTaxId: null,
    issueDate: new Date('2026-04-22'),
    totalAmount: 163.18,
    sourceChannel: 'telegram',
    originalFilename: 'photo_456.jpg',
  };
  const result = checkDuplicate(candidate, existing);
  assert(result.strongMatch !== null, '"FRIDOLISA" (OCR typo) still matches "FRIOLISA" as the same supplier -> STRONG match');
}

console.log('\nDuplicate Detection — Case 2: same supplier/date/total, different invoice_number/filename -> probable\n');
{
  const existing: DuplicateInvoiceRef[] = [{
    invoiceId: 'inv-1',
    documentId: 'doc-1',
    invoiceNumber: 'A-100',
    supplierName: 'DISTRIBUCIONS DARNES S.L.',
    supplierTaxId: 'B12345678',
    issueDate: new Date('2026-05-20'),
    totalAmount: 162.42,
    sourceChannel: 'telegram',
    originalFilename: 'factura_darnes.pdf',
    createdAt: new Date('2026-05-27T00:00:00Z'),
  }];
  const candidate = {
    invoiceNumber: '', // number missing on this extraction attempt
    supplierName: 'Distribucions Darnes SL',
    supplierTaxId: 'B12345678',
    issueDate: new Date('2026-05-21'), // one day off — still within the probable window
    totalAmount: 162.42,
    sourceChannel: 'web',
    originalFilename: 'factura_darnes_v2.pdf',
  };
  const result = checkDuplicate(candidate, existing);
  assert(result.strongMatch === null, 'Missing invoice_number never produces a strong match');
  assert(result.probableMatches.length === 1, 'Same supplier + close date + same total -> exactly one probable match');
  assert(result.probableMatches[0]?.existing.invoiceId === 'inv-1', 'Probable match points at the right existing invoice');
}

console.log('\nDuplicate Detection — Case 3: genuinely different invoice, same total by coincidence -> no match\n');
{
  const existing: DuplicateInvoiceRef[] = [{
    invoiceId: 'inv-a',
    documentId: 'doc-a',
    invoiceNumber: '260024010011304',
    supplierName: 'TRANSGOURMET',
    supplierTaxId: 'B11111111',
    issueDate: new Date('2026-04-07'),
    totalAmount: 81.30,
    sourceChannel: 'telegram',
    originalFilename: 'transgourmet_1.pdf',
    createdAt: new Date('2026-04-07T00:00:00Z'),
  }];
  const candidate = {
    invoiceNumber: 'ZZ-999',
    supplierName: 'MERCADONA S.A.',
    supplierTaxId: 'A87654321',
    issueDate: new Date('2026-06-30'), // 2+ months later, unrelated
    totalAmount: 81.30, // coincidental same total, different everything else
    sourceChannel: 'telegram',
    originalFilename: 'mercadona_ticket.jpg',
  };
  const result = checkDuplicate(candidate, existing);
  assert(result.strongMatch === null, 'Different supplier + different invoice_number -> no strong match despite same total');
  assert(result.probableMatches.length === 0, 'Different supplier + date far apart + different filename -> no probable match either');
}

console.log('\nDuplicate Detection — groupDuplicates() clusters the same way as checkDuplicate() (audit vs. live parity)\n');
{
  const invoices: DuplicateInvoiceRef[] = [
    { invoiceId: 'p1', documentId: 'd1', invoiceNumber: '260024010016516', supplierName: 'TRANSGOURMET', supplierTaxId: null, issueDate: new Date('2026-05-11'), totalAmount: 138.74, sourceChannel: 'telegram', originalFilename: 'a.pdf', createdAt: new Date('2026-06-01T09:52:00Z') },
    { invoiceId: 'p2', documentId: 'd2', invoiceNumber: '260024010016516', supplierName: 'TRANSGOURMET', supplierTaxId: null, issueDate: new Date('2026-05-11'), totalAmount: 138.74, sourceChannel: 'telegram', originalFilename: 'b.pdf', createdAt: new Date('2026-06-04T08:04:00Z') },
    { invoiceId: 'p3', documentId: 'd3', invoiceNumber: 'ZZ-999', supplierName: 'OTRO PROVEEDOR', supplierTaxId: 'C99999999', issueDate: new Date('2026-06-20'), totalAmount: 50.00, sourceChannel: 'web', originalFilename: 'c.pdf', createdAt: new Date('2026-06-20T00:00:00Z') },
  ];
  const groups = groupDuplicates(invoices);
  assert(groups.length === 1, 'groupDuplicates finds exactly 1 duplicate cluster among 3 invoices (the unrelated one stays out)');
  assert(groups[0]?.matchType === 'strong', 'The BYOU 260024010016516 pattern groups as a STRONG match');
  assert(groups[0]?.members.length === 2, 'The strong group has exactly the 2 duplicate members, not the unrelated invoice');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
