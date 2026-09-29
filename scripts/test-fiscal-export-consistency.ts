/**
 * Pure logic tests — detalle_iva.csv deducible/no-deducible split, and
 * explicit-vs-automatic export fiscal_period consistency (Fase Gascón,
 * follow-up after code review). No DB, no network.
 * Run with: npx tsx scripts/test-fiscal-export-consistency.ts
 */
import { splitVatDeductibility, invoiceEffectivePeriodWhere, getDeductibleInputVat, getExpenseAmount } from '../lib/invoice-fiscal-treatment';
import { generateIvaDetalleCSV, IvaDetalleRow } from '../lib/iva-detalle';
import { getDateRange } from '../lib/csv-generator';
import { getFiscalQuarterInfo, FiscalQuarter } from '../lib/fiscal-calendar';
import { suggestDocumentType } from '../lib/document-type-classifier';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

function row(overrides: Partial<IvaDetalleRow>): IvaDetalleRow {
  return {
    fecha: '2026-08-01', numeroFactura: 'F1', contraparte: 'Proveedor', tipo: 'recibida',
    baseImponible: 10, tipoIva: 21, cuotaIva: 2.10, ivaNoDeducible: 0, total: 12.10,
    origen: 'Web', estadoClasificacion: 'clasificada (cabecera)', observaciones: '',
    ...overrides,
  };
}

console.log('\nCase 1: detalle_iva.csv — SIMPLIFIED_INVOICE — IVA deducible = 0, IVA documental preservado\n');
{
  const split = splitVatDeductibility({ invoice_type: 'received', document_type: 'SIMPLIFIED_INVOICE' }, 2.10);
  assert(split.deductible === 0, 'IVA deducible = 0 para SIMPLIFIED_INVOICE');
  assert(split.nonDeductible === 2.10, 'el IVA documental completo (2.10) se conserva en la columna no-deducible');

  const r = row({ cuotaIva: split.deductible, ivaNoDeducible: split.nonDeductible });
  const csv = generateIvaDetalleCSV([r]);
  assert(csv.includes('cuota_iva') && csv.includes('iva_no_deducible'), 'el CSV incluye ambas columnas');
  const dataLine = csv.split('\r\n')[1];
  assert(dataLine.includes(';0.00;2.10;'), 'la fila de datos muestra cuota_iva=0.00 y iva_no_deducible=2.10 en ese orden');
}

console.log('\nCase 2: detalle_iva.csv — FULL_INVOICE — comportamiento anterior (todo deducible)\n');
{
  const split = splitVatDeductibility({ invoice_type: 'received', document_type: 'FULL_INVOICE' }, 21);
  assert(split.deductible === 21, 'IVA deducible = importe completo para FULL_INVOICE');
  assert(split.nonDeductible === 0, 'iva_no_deducible = 0 para FULL_INVOICE');
}

console.log('\nCase 3: detalle_iva.csv — legacy document_type=NULL — comportamiento anterior\n');
{
  const split = splitVatDeductibility({ invoice_type: 'received', document_type: null }, 21);
  assert(split.deductible === 21, 'IVA deducible = importe completo cuando document_type es NULL (legacy)');
  assert(split.nonDeductible === 0, 'iva_no_deducible = 0 para legacy NULL');
}

console.log('\nCase: issued invoices are never treated as non-deductible, regardless of document_type\n');
{
  // Simplified-invoice concept only applies to received invoices — an issued
  // invoice with document_type='SIMPLIFIED_INVOICE' (should never happen in
  // practice, the classifier never suggests it for issued) must not zero out
  // ivaRepercutido.
  const split = splitVatDeductibility({ invoice_type: 'issued', document_type: 'SIMPLIFIED_INVOICE' }, 21);
  assert(split.deductible === 21 && split.nonDeductible === 0, 'una factura emitida nunca se trata como no deducible, aunque document_type esté (erróneamente) marcado simplificada');
}

console.log('\nCase 4: export "último trimestre cerrado" — factura con issue_date en Q2 pero fiscal_period Q3 aparece en Q3, no en Q2\n');
{
  // Minimal reimplementation of how Prisma evaluates this specific where
  // shape (OR of two AND-implicit-equality branches) — test-only, mirrors
  // exactly the two branches invoiceEffectivePeriodWhere() produces.
  function matchesPeriodWhere(
    where: ReturnType<typeof invoiceEffectivePeriodWhere>,
    invoice: { fiscal_period_year: number | null; fiscal_period_quarter: number | null; issue_date: Date },
  ): boolean {
    return where.OR.some((branch: any) =>
      'issue_date' in branch
        ? invoice.fiscal_period_year === null && invoice.issue_date >= branch.issue_date.gte && invoice.issue_date <= branch.issue_date.lte
        : invoice.fiscal_period_year === branch.fiscal_period_year && invoice.fiscal_period_quarter === branch.fiscal_period_quarter,
    );
  }

  const lateInvoice = { fiscal_period_year: 2026, fiscal_period_quarter: 3, issue_date: new Date('2026-05-15T00:00:00Z') }; // issue_date is Q2, fiscal_period overridden to Q3

  const q2 = getFiscalQuarterInfo(2026, 2);
  const q2Where = invoiceEffectivePeriodWhere(2026, 2, q2.period_start, q2.period_end);
  assert(!matchesPeriodWhere(q2Where, lateInvoice), 'la factura NO aparece en la selección de Q2 pese a que su issue_date es de Q2 — el override manda');

  const q3 = getFiscalQuarterInfo(2026, 3);
  const q3Where = invoiceEffectivePeriodWhere(2026, 3, q3.period_start, q3.period_end);
  assert(matchesPeriodWhere(q3Where, lateInvoice), 'la factura SÍ aparece en la selección de Q3, el trimestre al que fue imputada manualmente');
}

console.log('\nCase 5: export explícito (year+quarter en el body) y export automático ("último trimestre cerrado") resuelven el mismo (year, quarter)\n');
{
  // "Automático" = getDateRange('quarterly', <today>). Pick a fixed "today"
  // inside Q4 2026 so the automatic path resolves to the last COMPLETED
  // quarter (Q3 2026) — same value a user would type explicitly for Q3 2026.
  const fakeToday = new Date('2026-11-15T00:00:00Z'); // Q4 2026 in progress
  const automatic = getDateRange('quarterly', fakeToday);
  assert(automatic.year === 2026 && automatic.quarter === 3, 'la ruta automática resuelve Q3 2026 (último trimestre cerrado) a partir de "hoy"=nov-2026');

  const explicit = getFiscalQuarterInfo(2026, 3 as FiscalQuarter);
  assert(
    automatic.start.getTime() === explicit.period_start.getTime() && automatic.end.getTime() === explicit.period_end.getTime(),
    'el rango [start,end] de la ruta automática coincide exactamente con getFiscalQuarterInfo(2026,3) de la ruta explícita',
  );

  // Both paths now produce the same invoiceEffectivePeriodWhere() input,
  // therefore the same selection — see app/api/exports/generate/route.ts.
  const whereFromAutomatic = invoiceEffectivePeriodWhere(automatic.year!, automatic.quarter!, automatic.start, automatic.end);
  const whereFromExplicit = invoiceEffectivePeriodWhere(2026, 3, explicit.period_start, explicit.period_end);
  assert(JSON.stringify(whereFromAutomatic) === JSON.stringify(whereFromExplicit), 'ambas rutas producen exactamente el mismo where-clause de selección fiscal — no pueden discrepar');
}

console.log('\nCase 6: suggested_document_type=SIMPLIFIED con document_type=NULL no altera IVA deducible ni gasto\n');
{
  const suggestion = suggestDocumentType({
    recipient_tax_id: null, customer_tax_id: null, total_amount: 12.10,
    category: 'ticket', notes: null, invoice_number: null,
  });
  assert(suggestion === 'SIMPLIFIED_INVOICE', 'el clasificador sugiere SIMPLIFIED_INVOICE');

  // The invoice itself is still document_type=NULL (never confirmed) — the
  // suggestion above is advisory-only and is NOT passed into the treatment
  // helpers at all, by construction (they don't even accept a "suggested" field).
  const inv = { document_type: null, tax_amount: 2.10, subtotal: 10, total_amount: 12.10 };
  assert(getDeductibleInputVat(inv) === 2.10, 'IVA deducible sigue siendo el importe completo — la sugerencia no lo ha tocado');
  assert(getExpenseAmount(inv) === 10, 'gasto sigue siendo subtotal — la sugerencia no lo ha tocado');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
