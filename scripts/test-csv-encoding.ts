/**
 * Smoke test for CSV encoding correctness.
 * Run with: npx tsx scripts/test-csv-encoding.ts
 *
 * Verifies: UTF-8 BOM, Spanish characters, semicolon delimiter, CRLF line endings.
 */

import { generateCSV, InvoiceWithDocument } from '../lib/csv-generator';

const mockInvoices: Partial<InvoiceWithDocument>[] = [
  {
    invoice_type: 'received',
    issue_date: new Date('2024-03-15'),
    due_date: new Date('2024-04-15'),
    invoice_number: 'FA-2024-001',
    supplier_name: 'Energía Solar S.L.',
    supplier_tax_id: 'B12345678',
    customer_name: 'BYOU Coffee House S.L.',
    customer_tax_id: 'A87654321',
    subtotal: 1000.00,
    tax_amount: 210.00,
    total_amount: 1210.00,
    currency: 'EUR',
    tax_rate: 21.00,
    payment_method: 'transfer',
    category: 'Años de servicio',
    notes: 'Cafetería; José Núñez',
    extraction_confidence: 0.95,
    review_status: 'approved',
    document: { source_channel: 'email' } as any,
  },
  {
    invoice_type: 'issued',
    issue_date: new Date('2024-03-20'),
    due_date: null,
    invoice_number: 'FA-2024-002',
    supplier_name: 'Distribuciones Ñoño S.A.',
    supplier_tax_id: 'C11223344',
    customer_name: 'Añoranza Digital',
    customer_tax_id: 'D99887766',
    subtotal: 500.50,
    tax_amount: 105.11,
    total_amount: 605.61,
    currency: 'EUR',
    tax_rate: 21.00,
    payment_method: undefined,
    category: undefined,
    notes: undefined,
    extraction_confidence: undefined,
    review_status: 'pending',
    document: { source_channel: 'telegram' } as any,
  },
];

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

const csv = generateCSV(mockInvoices as InvoiceWithDocument[]);
const buf = Buffer.from(csv, 'utf-8');

console.log('\nCSV Encoding Verification\n');

// BOM: first 3 bytes must be EF BB BF
assert(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'UTF-8 BOM presente (EF BB BF)');

// Spanish characters intact
assert(csv.includes('Energía'), 'Energía OK');
assert(csv.includes('Años'), 'Años OK');
assert(csv.includes('Cafetería'), 'Cafetería OK');
assert(csv.includes('BYOU Coffee House S.L.'), 'BYOU Coffee House S.L. OK');
assert(csv.includes('José'), 'José OK');
assert(csv.includes('Núñez'), 'Núñez OK');
assert(csv.includes('Ñoño'), 'Ñoño OK');
assert(csv.includes('Añoranza'), 'Añoranza OK');

// Semicolon delimiter
assert(csv.includes(';'), 'Separador ; presente');
assert(!csv.startsWith('﻿invoice_type,'), 'No usa coma como separador en cabecera');

// CRLF line endings
assert(csv.includes('\r\n'), 'Saltos de línea CRLF (\\r\\n)');

// Values with semicolons are quoted
assert(csv.includes('"Cafetería; José Núñez"'), 'Valores con ; se encierran en comillas');

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);

if (failed > 0) {
  process.exit(1);
}
