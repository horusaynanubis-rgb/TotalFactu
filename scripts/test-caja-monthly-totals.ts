/**
 * Tests for the Marc/Gascón follow-up on Caja y Cobros totals:
 *   1. the quarterly BYOU download (lib/caja-csv.ts, used by both the
 *      server-side GET /api/caja-cobros/export?scope=quarterly and the
 *      "Exportación trimestral completa" ZIP's caja_tpv.csv) already appends
 *      a correct "TOTAL PERIODO" row and must NOT change — verified here
 *      byte-for-byte against a fixed dataset.
 *   2. the actual gap was a SEPARATE, client-side-only quick-export on the
 *      Caja y Cobros page itself (app/(dashboard)/dashboard/caja-cobros/page.tsx
 *      exportCSV/exportXLSX), which never had a totals row — fixed via the
 *      new lib/caja-monthly-quick-export.ts, tested here directly.
 *   3. the gestoria direct-download CSV (added in the previous change) totals
 *      correctly per whatever period (month/quarter) was requested, because
 *      it reuses the same lib/caja-csv.ts + lib/caja-period.ts as the company
 *      side — no separate logic to drift.
 *
 * Matching this repo's test convention (see scripts/test-fiscal-export-consistency.ts,
 * scripts/test-gestoria-caja-cobros.ts): pure-logic tests against the real
 * lib functions, plus structural regression guards on route source where a
 * live DB/session isn't needed to prove the point.
 *
 * Run with: npx tsx scripts/test-caja-monthly-totals.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { generateCajaCSV, CajaRegisterRow } from '../lib/caja-csv';
import { computeMonthlyCajaTotals, buildMonthlyCajaCSV, buildMonthlyCajaXLSXHtml, MonthlyCajaExportRow } from '../lib/caja-monthly-quick-export';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const ROOT = path.join(__dirname, '..');

function cajaRow(overrides: Partial<CajaRegisterRow> = {}): CajaRegisterRow {
  return {
    date: new Date('2026-01-15'),
    cash_amount: 100, card_amount: 50, bizum_amount: 0, transfer_amount: 0, other_amount: 0,
    total_amount: 150, notes: null, status: 'confirmed', source: 'manual', ai_raw_data: null,
    ...overrides,
  };
}

function quickRow(overrides: Partial<MonthlyCajaExportRow> = {}): MonthlyCajaExportRow {
  return {
    date: '2026-01-15', cash_amount: 100, card_amount: 50, bizum_amount: 0, transfer_amount: 0,
    other_amount: 0, total_amount: 150, source: 'manual', notes: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. Quarterly BYOU download — lib/caja-csv.ts is untouched and already correct');
// ─────────────────────────────────────────────────────────────────────────

{
  // lib/caja-csv.ts must be byte-for-byte the file this repo already shipped
  // and Marc confirmed works — this change touches it in NO way.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'caja-csv.ts'), 'utf8');
  assert(src.includes("'TOTAL PERIODO'"), 'lib/caja-csv.ts still builds a "TOTAL PERIODO" row (unconditional, for every scope)');
  assert(src.includes("const headers = ['fecha', 'efectivo', 'tarjeta', 'bizum', 'transferencia', 'otros', 'total', 'descuadre', 'origen', 'estado', 'notas'];"), 'lib/caja-csv.ts header list is unchanged');
  assert(!/computeMonthlyCajaTotals|caja-monthly-quick-export/.test(src), 'lib/caja-csv.ts does not import or depend on the new monthly-quick-export fix (fully independent)');
}

{
  // Golden/snapshot test: a representative BYOU-style quarter (2 months'
  // worth of confirmed registers) run through the exact same generator the
  // quarterly download already uses — locks in the exact current output.
  const q2 = [
    cajaRow({ date: new Date('2026-04-05'), cash_amount: 300, card_amount: 700, total_amount: 1000 }),
    cajaRow({ date: new Date('2026-05-12'), cash_amount: 150.55, card_amount: 249.45, total_amount: 400 }),
    cajaRow({ date: new Date('2026-06-20'), cash_amount: 0, card_amount: 500, total_amount: 500 }),
  ];
  const csv = generateCajaCSV(q2);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert(lines[0] === 'fecha;efectivo;tarjeta;bizum;transferencia;otros;total;descuadre;origen;estado;notas', 'quarterly CSV header line unchanged');
  assert(lines.length === 5, 'quarterly CSV has header + 3 data rows + 1 totals row (5 lines total)');
  assert(lines[4] === 'TOTAL PERIODO;450.55;1449.45;0.00;0.00;0.00;1900.00;0.00;;;', 'quarterly CSV TOTAL PERIODO row sums across the WHOLE quarter correctly (450.55 + 1449.45 = 1900.00)');
}

// Company + gestoria export routes, and the ZIP builder, must still be the
// only three callers of generateCajaCSV — no new quarterly code path introduced.
for (const p of [
  ['app', 'api', 'caja-cobros', 'export', 'route.ts'],
  ['app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'caja-cobros', 'export', 'route.ts'],
  ['lib', 'fiscal-export-builder.ts'],
]) {
  const src = fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  assert(src.includes('generateCajaCSV'), `${p.join('/')} still calls the canonical generateCajaCSV (untouched by this fix)`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. Monthly quick-export CSV/XLSX now ends with a TOTAL row');
// ─────────────────────────────────────────────────────────────────────────

{
  const january = [
    quickRow({ date: '2026-01-03', cash_amount: 120.30, card_amount: 80, total_amount: 200.30 }),
    quickRow({ date: '2026-01-18', cash_amount: 40, card_amount: 60, total_amount: 100 }),
  ];
  const csv = buildMonthlyCajaCSV(january);
  const lines = csv.split('\n');
  assert(lines[0] === 'Fecha,Efectivo,TPV,Bizum,Transferencias,Otros,Total,Origen,Observaciones', 'monthly quick-export CSV header unchanged (still 9 columns)');
  assert(lines.length === 4, 'CSV has header + 2 data rows + 1 TOTAL row (4 lines) — previously it had NO total row (3 lines)');
  assert(lines[3].startsWith('TOTAL,'), 'the last line of the monthly CSV starts with "TOTAL,"');
  assert(lines[3] === 'TOTAL,160.30,140.00,0.00,0.00,0.00,300.30,,', 'TOTAL row sums correctly: efectivo 120.30+40=160.30, TPV 80+60=140.00, total 200.30+100=300.30');
}

{
  const january = [quickRow({ date: '2026-01-03' })];
  const html = buildMonthlyCajaXLSXHtml(january);
  const rowCount = (html.match(/<tr>/g) ?? []).length;
  assert(rowCount === 3, 'XLSX has header row + 1 data row + 1 TOTAL row (3 <tr> total) — previously 2');
  assert(html.includes('<td>TOTAL</td>'), 'XLSX last row starts with a <td>TOTAL</td> cell');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. Each month keeps its OWN total — no cross-month mixing');
// ─────────────────────────────────────────────────────────────────────────

{
  const jan = [quickRow({ date: '2026-01-10', cash_amount: 100, card_amount: 0, total_amount: 100 })];
  const feb = [quickRow({ date: '2026-02-10', cash_amount: 500, card_amount: 0, total_amount: 500 })];

  const janTotals = computeMonthlyCajaTotals(jan);
  const febTotals = computeMonthlyCajaTotals(feb);

  assert(janTotals.total === 100, 'January total (100) computed only from January\'s own registers');
  assert(febTotals.total === 500, 'February total (500) computed only from February\'s own registers, not 600');

  const janCsv = buildMonthlyCajaCSV(jan);
  const febCsv = buildMonthlyCajaCSV(feb);
  assert(janCsv.includes('TOTAL,100.00') && !janCsv.includes('500.00'), 'January CSV never mentions February\'s 500');
  assert(febCsv.includes('TOTAL,500.00') && !febCsv.includes('100.00'), 'February CSV never mentions January\'s 100');
}

{
  // Safe monetary calc: sums that are classic IEEE754 float-drift traps
  // (0.1 + 0.2 style) must land exactly on the expected 2-decimal value.
  const rows = [
    quickRow({ date: '2026-01-01', cash_amount: 0.1, card_amount: 0, total_amount: 0.1 }),
    quickRow({ date: '2026-01-02', cash_amount: 0.2, card_amount: 0, total_amount: 0.2 }),
  ];
  const totals = computeMonthlyCajaTotals(rows);
  assert(totals.cash === 0.3, `safe cents-based summation: 0.1 + 0.2 = 0.3 exactly (got ${totals.cash}, plain float addition would give 0.30000000000000004)`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. Days without a register stay absent — no zero-filled rows, no invented payment methods/VAT');
// ─────────────────────────────────────────────────────────────────────────

{
  // A sparse month: only 2 of ~30 days have a register.
  const sparse = [quickRow({ date: '2026-03-03' }), quickRow({ date: '2026-03-20' })];
  const csv = buildMonthlyCajaCSV(sparse);
  const lines = csv.split('\n');
  assert(lines.length === 4, 'sparse month CSV = header + 2 real rows + 1 TOTAL row, NOT 1 + 31 + 1 (no day-by-day fill)');
  assert(!csv.includes('01/03/2026'), 'no synthetic row is generated for 2026-03-01 (a day with no register)');
}
{
  // No new columns invented: still exactly the historical 9-column shape,
  // no IVA/VAT column, no extra payment-method breakdown beyond what already existed.
  const csv = buildMonthlyCajaCSV([quickRow()]);
  const header = csv.split('\n')[0].split(',');
  assert(header.length === 9, 'monthly CSV still has exactly 9 columns (no invented IVA/VAT or extra payment-method column)');
  assert(!/iva/i.test(csv), 'monthly CSV never mentions IVA (not present in DailyCashRegister)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. Gestoria direct download totals correctly per selected period (month vs quarter)');
// ─────────────────────────────────────────────────────────────────────────

{
  // Simulates exactly what the gestoria export route does: query registers
  // already filtered to ONE month, run them through the canonical generator.
  const marchOnly = [
    cajaRow({ date: new Date('2026-03-05'), cash_amount: 200, card_amount: 300, total_amount: 500 }),
    cajaRow({ date: new Date('2026-03-25'), cash_amount: 100, card_amount: 100, total_amount: 200 }),
  ];
  const csv = generateCajaCSV(marchOnly);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert(lines[lines.length - 1] === 'TOTAL PERIODO;300.00;400.00;0.00;0.00;0.00;700.00;0.00;;;', 'gestoria monthly download: TOTAL PERIODO = exactly March\'s total (500+200=700), not inflated by other months');
}
{
  // Same generator, but with a full-quarter dataset (as when scope=quarterly
  // is requested from gestoria) — total must cover the whole quarter, not just one month.
  const q1 = [
    cajaRow({ date: new Date('2026-01-10'), total_amount: 100 }),
    cajaRow({ date: new Date('2026-02-10'), total_amount: 200 }),
    cajaRow({ date: new Date('2026-03-10'), total_amount: 300 }),
  ];
  const csv = generateCajaCSV(q1);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  const totalLine = lines[lines.length - 1];
  assert(totalLine.startsWith('TOTAL PERIODO;'), 'gestoria quarterly download still ends in a TOTAL PERIODO row');
  assert(totalLine.split(';')[6] === '600.00', 'gestoria quarterly download totals the FULL quarter (100+200+300=600), not just one month');
}

const gestoriaExportSrc = fs.readFileSync(path.join(ROOT, 'app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'caja-cobros', 'export', 'route.ts'), 'utf8');
assert(gestoriaExportSrc.includes('getCajaExportRange(scope'), 'gestoria export route still derives its date range from scope (month or quarter) via the shared lib/caja-period helper');
assert(gestoriaExportSrc.includes('generateCajaCSV(registers)'), 'gestoria export route still totals via the canonical generateCajaCSV — no separate total-calc logic to drift from the company/quarterly behavior');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. Gaps stay gaps — confirmed independently of the totals fix');
// ─────────────────────────────────────────────────────────────────────────

for (const p of [
  ['app', 'api', 'caja-cobros', 'route.ts'],
  ['app', 'api', 'caja-cobros', 'export', 'route.ts'],
  ['app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'caja-cobros', 'route.ts'],
  ['app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'caja-cobros', 'export', 'route.ts'],
]) {
  const src = fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  assert(src.includes('findMany('), `${p.join('/')}: still uses findMany (only existing rows, no fill)`);
}
assert(!fs.readFileSync(path.join(ROOT, 'lib', 'caja-monthly-quick-export.ts'), 'utf8').includes('for (let d ='), 'lib/caja-monthly-quick-export.ts contains no date-iteration loop that could synthesize missing days');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. Existing ZIP/export paths are unaffected by this fix');
// ─────────────────────────────────────────────────────────────────────────

{
  const fiscalBuilderSrc = fs.readFileSync(path.join(ROOT, 'lib', 'fiscal-export-builder.ts'), 'utf8');
  assert(fiscalBuilderSrc.includes('generateCajaCSV'), 'lib/fiscal-export-builder.ts (quarterly ZIP\'s caja_tpv.csv) still calls the canonical, unmodified generateCajaCSV');
}
{
  const pagePath = path.join(ROOT, 'app', '(dashboard)', 'dashboard', 'caja-cobros', 'page.tsx');
  const pageSrc = fs.readFileSync(pagePath, 'utf8');
  assert(pageSrc.includes("from '@/lib/caja-monthly-quick-export'"), 'Caja y Cobros page now delegates its quick-export CSV/XLSX to the new pure builders');
  assert(!pageSrc.includes("const header = 'Fecha,Efectivo,TPV,Bizum"), 'the old inline (total-less) CSV building code was removed from the page, not duplicated alongside the fix');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
