/**
 * Pure logic tests for lib/economic-summary.ts (buildEconomicSummaryFromData)
 * — no DB, no network. Run with: npx tsx scripts/test-economic-summary.ts
 *
 * Covers the approved MVP spec cases:
 *   1. Sin Caja: issued net - received net.
 *   2. Con Caja: incomeSource=tpv.
 *   3. Con Caja: resultado=null y margen=null.
 *   4. Con Caja: facturas emitidas NO se suman a ingresos.
 *   5. unconfirmedByGestoria: incluida provisionalmente cuando es válida.
 *   6. manual_review/reviewed_issue: tratamiento según reglas definidas.
 *   7. moneda != EUR: exclusión.
 *   8. periodo vacío: no_data vs zero real.
 *   9. ingresos=0: sin división por cero.
 *   10. month/quarter/year: cubierto por lib/fiscal-calendar.ts ya probado en
 *       producción (getFiscalQuarterInfo); aquí se prueba que el resumen
 *       económico no depende del cálculo de periodo, solo consume from/to
 *       ya resueltos — ver test de invariancia al final.
 */
import { buildEconomicSummaryFromData, EconomicInvoiceInput, EconomicCashRegisterInput } from '../lib/economic-summary';
import { getFiscalQuarterInfo } from '../lib/fiscal-calendar';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

function invoice(overrides: Partial<EconomicInvoiceInput>): EconomicInvoiceInput {
  return {
    invoice_type: 'received',
    subtotal: 100,
    currency: 'EUR',
    fiscal_status: 'classified',
    gestoria_review_status: 'reviewed_ok',
    ...overrides,
  };
}

function register(overrides: Partial<EconomicCashRegisterInput>): EconomicCashRegisterInput {
  return { total_amount: 100, status: 'confirmed', ...overrides };
}

console.log('\nCase 1: sin Caja/TPV — Resultado = facturas emitidas netas - recibidas netas\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q1 2026',
    invoices: [
      invoice({ invoice_type: 'issued', subtotal: 1000 }),
      invoice({ invoice_type: 'received', subtotal: 400 }),
    ],
    cashRegisters: [],
  });
  assert(s.incomeSource === 'invoices', 'incomeSource = invoices sin Caja/TPV');
  assert(s.ingresos === 1000, 'ingresos = 1000 (facturas emitidas)');
  assert(s.gastos === 400, 'gastos = 400 (facturas recibidas)');
  assert(s.resultado === 600, 'resultado = 1000 - 400 = 600');
  assert(s.margen === 60, 'margen = 600/1000*100 = 60');
  assert(s.facturasEmitidasInformativas === null, 'sin bloque informativo de emitidas cuando ya son el ingreso principal');
}

console.log('\nCase 2 y 3: con Caja/TPV confirmada — incomeSource=tpv, resultado/margen=null\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Agosto 2026',
    invoices: [
      invoice({ invoice_type: 'issued', subtotal: 173.75, gestoria_review_status: 'reviewed_ok' }),
      invoice({ invoice_type: 'received', subtotal: 7388.01 }),
    ],
    cashRegisters: [register({ total_amount: 33229.24 })],
  });
  assert(s.incomeSource === 'tpv', 'incomeSource = tpv cuando hay Caja confirmada');
  assert(s.ingresos === 33229.24, 'ingresos = total de Caja/TPV (bruto)');
  assert(s.resultado === null, 'resultado = null con Caja/TPV (bases no comparables)');
  assert(s.margen === null, 'margen = null con Caja/TPV');
  assert(s.disclaimer.length > 0 && !s.disclaimer.toLowerCase().includes('beneficio contable'), 'disclaimer presente y sin la palabra "beneficio contable"');
}

console.log('\nCase 4: con Caja/TPV — facturas emitidas NO se suman a ingresos\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Agosto 2026',
    invoices: [invoice({ invoice_type: 'issued', subtotal: 173.75 })],
    cashRegisters: [register({ total_amount: 1065.45 })],
  });
  assert(s.ingresos === 1065.45, 'ingresos = solo Caja/TPV, sin sumar la factura emitida');
  assert(s.facturasEmitidasInformativas?.total === 173.75, 'factura emitida mostrada aparte, como informativa');
  assert(s.facturasEmitidasInformativas?.count === 1, 'count informativo correcto');
}

console.log('\nCase 5: unconfirmedByGestoria — se incluye provisionalmente, solo se cuenta\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q2 2026',
    invoices: [
      invoice({ invoice_type: 'received', subtotal: 100, gestoria_review_status: null }),
      invoice({ invoice_type: 'received', subtotal: 100, gestoria_review_status: 'legacy_unreviewed' }),
      invoice({ invoice_type: 'received', subtotal: 100, gestoria_review_status: 'reviewed_ok' }),
    ],
    cashRegisters: [],
  });
  assert(s.gastos === 300, 'las 3 facturas SIN confirmar por gestoría se incluyen igualmente en el total (300, no 100)');
  assert(s.counts.unconfirmedByGestoria === 2, 'se cuentan 2 como no confirmadas (null y legacy_unreviewed), sin excluirlas');
}

console.log('\nCase 6: manual_review y reviewed_issue se EXCLUYEN del total (a diferencia de "sin confirmar")\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q2 2026',
    invoices: [
      invoice({ invoice_type: 'received', subtotal: 100, fiscal_status: 'manual_review' }),
      invoice({ invoice_type: 'received', subtotal: 100, gestoria_review_status: 'reviewed_issue' }),
      invoice({ invoice_type: 'received', subtotal: 100, fiscal_status: 'pending_classification', gestoria_review_status: null }),
    ],
    cashRegisters: [],
  });
  assert(s.gastos === 100, 'solo la factura pending_classification (sin confirmar, pero no excluida) cuenta: 100');
  assert(s.counts.excluded.manualReview === 1, 'manual_review excluida y contada');
  assert(s.counts.excluded.gestoriaIssue === 1, 'reviewed_issue excluida y contada');
  assert(s.counts.unconfirmedByGestoria === 1, 'la factura pending_classification incluida cuenta como no confirmada');
}

console.log('\nCase 7: moneda != EUR se excluye\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q2 2026',
    invoices: [
      invoice({ invoice_type: 'received', subtotal: 100, currency: 'USD' }),
      invoice({ invoice_type: 'received', subtotal: 50, currency: 'EUR' }),
    ],
    cashRegisters: [],
  });
  assert(s.gastos === 50, 'factura en USD excluida del total de gastos');
  assert(s.counts.excluded.nonEur === 1, 'nonEur contabilizada');
}

console.log('\nCase 8: periodo vacío — no_data vs cero real\n');
{
  const empty = buildEconomicSummaryFromData({ periodLabel: 'Q1 2020', invoices: [], cashRegisters: [] });
  assert(empty.dataStatus === 'no_data', 'periodo totalmente vacío -> dataStatus = no_data');
  assert(empty.ingresos === 0 && empty.gastos === 0, 'los importes son 0 numéricamente (uso interno), pero no deben mostrarse como "cero real" sin mirar dataStatus');

  // Case A: cero facturas emitidas DE ORIGEN (nunca hubo ninguna) + gastos
  // válidos + sin TPV -> es un cero real de ingresos, no falta de datos.
  const zeroIssuedRealZero = buildEconomicSummaryFromData({
    periodLabel: 'Q1 2026',
    invoices: [invoice({ invoice_type: 'received', subtotal: 500 })],
    cashRegisters: [],
  });
  assert(zeroIssuedRealZero.dataStatus === 'available', 'cero facturas emitidas de origen -> cero real, dataStatus = available');
  assert(zeroIssuedRealZero.ingresos === 0, 'ingresos = 0 (real)');
  assert(zeroIssuedRealZero.resultado === -500, 'resultado = 0 - 500 = -500, calculable normalmente');

  // Case B: SÍ existían facturas emitidas de origen, pero TODAS quedaron
  // excluidas (p.ej. manual_review) -> el 0 resultante es un artefacto del
  // filtrado, no un hecho de negocio -> insufficient.
  const allIssuedExcluded = buildEconomicSummaryFromData({
    periodLabel: 'Q1 2026',
    invoices: [
      invoice({ invoice_type: 'issued', subtotal: 300, fiscal_status: 'manual_review' }),
      invoice({ invoice_type: 'received', subtotal: 500 }),
    ],
    cashRegisters: [],
  });
  assert(allIssuedExcluded.dataStatus === 'insufficient', 'existían emitidas pero todas se excluyeron -> insufficient, el 0 no es de fiar');
  assert(allIssuedExcluded.ingresos === 0, 'ingresos numérico sigue siendo 0 internamente (uso interno, no se muestra como cero real)');

  const realZero = buildEconomicSummaryFromData({
    periodLabel: 'Q1 2026',
    invoices: [invoice({ invoice_type: 'issued', subtotal: 0 }), invoice({ invoice_type: 'received', subtotal: 500 })],
    cashRegisters: [],
  });
  assert(realZero.dataStatus === 'available', 'existe 1 factura emitida elegible (aunque su importe sea 0) -> se confía en el cero como real');
}

console.log('\nCase 8b: Caja/TPV existe en el periodo pero TODOS los registros están pending_review\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Agosto 2026',
    invoices: [invoice({ invoice_type: 'issued', subtotal: 173.75 })],
    cashRegisters: [
      register({ total_amount: 500, status: 'pending_review' }),
      register({ total_amount: 300, status: 'pending_review' }),
    ],
  });
  assert(s.incomeSource === 'tpv', 'la existencia de registros de Caja/TPV (aunque pendientes) mantiene incomeSource=tpv — NO cae a "invoices"');
  assert(s.dataStatus === 'insufficient', 'ningún registro confirmado -> dataStatus = insufficient');
  assert(s.resultado === null, 'resultado = null (no se calcula con TPV, confirmado o no)');
  assert(s.margen === null, 'margen = null');
  assert(s.ingresos === 0, 'ingresos = 0 porque no hay ningún registro CONFIRMADO que sumar (no se inventa una cifra de lo pendiente)');
  assert(s.counts.pendingCashRegisters === 2, 'los 2 registros pendientes se cuentan correctamente');
  assert(s.facturasEmitidasInformativas?.total === 173.75, 'la factura emitida se sigue mostrando como informativa, no se usa como fallback de ingresos');
}

console.log('\nCase 9: ingresos=0 — sin división por cero en margen\n');
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q1 2026',
    invoices: [invoice({ invoice_type: 'issued', subtotal: 0 }), invoice({ invoice_type: 'received', subtotal: 200 })],
    cashRegisters: [],
  });
  assert(s.ingresos === 0, 'ingresos = 0');
  assert(s.margen === null, 'margen = null en vez de NaN/Infinity cuando ingresos = 0');
  assert(s.resultado === -200, 'resultado sigue siendo calculable (-200) aunque el margen no');
}

console.log('\nCase 10: el resumen económico es agnóstico del cálculo de periodo (usa fiscal-calendar.ts ya probado)\n');
{
  // Prueba de integración ligera: confirma que getFiscalQuarterInfo (usado por
  // el endpoint) sigue produciendo rangos que un caller puede pasar tal cual
  // a buildEconomicSummaryFromData sin transformación adicional.
  const q3 = getFiscalQuarterInfo(2026, 3);
  assert(q3.period_start.getMonth() === 6 && q3.period_end.getMonth() === 8, 'Q3 2026 cubre julio-septiembre, igual que el resto del sistema fiscal');
  const s = buildEconomicSummaryFromData({ periodLabel: `Q3 2026`, invoices: [], cashRegisters: [] });
  assert(s.periodLabel === 'Q3 2026', 'el periodLabel se propaga sin modificarse — el cálculo de fechas es responsabilidad exclusiva de fiscal-calendar.ts / la ruta API');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
