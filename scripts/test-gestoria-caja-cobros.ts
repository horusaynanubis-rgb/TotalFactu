/**
 * Tests for the gestoria-side "Caja y cobros" read + CSV export
 * (app/api/gestoria/clients/[clientCompanyId]/caja-cobros/{route,export/route}.ts),
 * added so a gestor can view/download the same DailyCashRegister data the
 * company already sees, without duplicating the CSV/period logic.
 *
 * Matching the style of scripts/test-gestoria-packs-purchase-authz.ts and
 * scripts/test-gestoria-eligibility.ts: getServerSession() only resolves a
 * real session inside a live HTTP request, and this repo's test scripts
 * don't mock next-auth/Prisma — so (a) pure period/CSV logic is exercised
 * directly by importing the real lib functions, and (b) authorization /
 * "no writes" / "canonical CSV reuse" guarantees are verified as structural
 * regression checks against the actual route source (same technique used
 * for the packs/purchase and sync-gestoria-eligibility security fixes).
 * The authenticated-session paths (authorized gestor sees data, unlicensed
 * gestor gets 403, CSV downloads with correct content-type) were verified
 * manually against a local dev server per the accompanying report.
 *
 * Run with: npx tsx scripts/test-gestoria-caja-cobros.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { getMonthRange, getCajaExportRange } from '../lib/caja-period';
import { generateCajaCSV, CajaRegisterRow } from '../lib/caja-csv';
import { getFiscalQuarterInfo } from '../lib/fiscal-calendar';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const ROOT = path.join(__dirname, '..');
const listRoutePath = path.join(ROOT, 'app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'caja-cobros', 'route.ts');
const exportRoutePath = path.join(ROOT, 'app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'caja-cobros', 'export', 'route.ts');
const companyRoutePath = path.join(ROOT, 'app', 'api', 'caja-cobros', 'route.ts');
const companyExportRoutePath = path.join(ROOT, 'app', 'api', 'caja-cobros', 'export', 'route.ts');
const fiscalExportBuilderPath = path.join(ROOT, 'lib', 'fiscal-export-builder.ts');
const fiscalExportPlanRoutePath = path.join(ROOT, 'app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'fiscal-export', 'plan', 'route.ts');

const listSrc = fs.readFileSync(listRoutePath, 'utf8');
const exportSrc = fs.readFileSync(exportRoutePath, 'utf8');

function row(overrides: Partial<CajaRegisterRow> = {}): CajaRegisterRow {
  return {
    date: new Date('2026-03-10'),
    cash_amount: 100,
    card_amount: 50,
    bizum_amount: 0,
    transfer_amount: 0,
    other_amount: 0,
    total_amount: 150,
    notes: null,
    status: 'confirmed',
    source: 'manual',
    ai_raw_data: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1+2. Authorization — resolveGestoriaAccess gates every query, unauthorized → 403 before any Prisma read');
// ─────────────────────────────────────────────────────────────────────────

for (const [label, src] of [['list route', listSrc], ['export route', exportSrc]] as const) {
  const idxAccessCall = src.indexOf('resolveGestoriaAccess(session.user.id, params.clientCompanyId)');
  const idxForbidden = src.indexOf("status: 403");
  const idxDailyCashRegisterQuery = src.indexOf('prisma.dailyCashRegister.find');

  assert(idxAccessCall !== -1, `${label}: calls resolveGestoriaAccess(session.user.id, params.clientCompanyId)`);
  assert(idxForbidden !== -1, `${label}: returns a 403 status somewhere`);
  assert(
    idxAccessCall !== -1 && idxForbidden !== -1 && idxAccessCall < idxForbidden,
    `${label}: the 403 guard comes AFTER the access check (i.e. gates on its result)`,
  );
  assert(
    idxAccessCall !== -1 && idxDailyCashRegisterQuery !== -1 && idxAccessCall < idxDailyCashRegisterQuery,
    `${label}: resolveGestoriaAccess() runs BEFORE any DailyCashRegister query (no data read for unauthorized callers)`,
  );
  assert(
    idxForbidden !== -1 && idxDailyCashRegisterQuery !== -1 && idxForbidden < idxDailyCashRegisterQuery,
    `${label}: the 403 early-return is positioned before the query (unauthorized request never reaches Prisma)`,
  );

  // resolveGestoriaAccess itself: only a real assigned License for this exact
  // gestoria ties clientCompanyId access — same check as the sibling
  // import-excel route (app/api/gestoria/clients/[clientCompanyId]/caja-cobros/import-excel/route.ts).
  assert(src.includes("company_type !== 'gestoria'"), `${label}: rejects non-gestoria companies`);
  assert(src.includes("status: 'assigned'"), `${label}: requires an assigned License`);
  assert(src.includes('pack: { gestoria_company_id: membership.company_id }'), `${label}: License must belong to the CALLING gestoria (not an arbitrary one)`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. Period filter — getMonthRange / getCajaExportRange (shared with the company routes)');
// ─────────────────────────────────────────────────────────────────────────

{
  const { from, to } = getMonthRange(2026, 2);
  assert(from.getTime() === new Date(2026, 1, 1).getTime(), 'getMonthRange(2026, 2): from = 2026-02-01');
  assert(to.getTime() === new Date(2026, 2, 1).getTime(), 'getMonthRange(2026, 2): to = 2026-03-01 (exclusive upper bound)');
}
{
  // December -> next January must not silently roll into the wrong year
  const { from, to } = getMonthRange(2026, 12);
  assert(from.getFullYear() === 2026 && from.getMonth() === 11, 'getMonthRange(2026, 12): from is December 2026');
  assert(to.getFullYear() === 2027 && to.getMonth() === 0, 'getMonthRange(2026, 12): to rolls over to January 2027');
}
{
  const range = getCajaExportRange('monthly', 2026, 3, 0);
  assert(range !== null && range.label === '03/2026', 'getCajaExportRange monthly scope: label = 03/2026');
}
{
  const range = getCajaExportRange('quarterly', 2026, 0, 2);
  const info = getFiscalQuarterInfo(2026, 2);
  assert(range !== null && range.start.getTime() === info.period_start.getTime(), 'getCajaExportRange quarterly scope: start matches getFiscalQuarterInfo (same calendar as company export)');
  assert(range !== null && range.end.getTime() === info.period_end.getTime(), 'getCajaExportRange quarterly scope: end matches getFiscalQuarterInfo');
  assert(range !== null && range.label === 'Q2 2026', 'getCajaExportRange quarterly scope: label = "Q2 2026"');
}
assert(getCajaExportRange('monthly', 2026, 13, 0) === null, 'getCajaExportRange rejects an invalid month (13)');
assert(getCajaExportRange('quarterly', 2026, 0, 5) === null, 'getCajaExportRange rejects an invalid quarter (5)');
assert(getCajaExportRange('bogus', 2026, 3, 0) === null, 'getCajaExportRange rejects an unknown scope');

// Both the company export route and the gestoria export route must import
// the SAME period helper — no second copy of the quarter-boundary logic.
const companyExportSrc = fs.readFileSync(companyExportRoutePath, 'utf8');
assert(companyExportSrc.includes("from '@/lib/caja-period'"), 'company export route imports period logic from lib/caja-period (refactored out of a local getRange())');
assert(exportSrc.includes("from '@/lib/caja-period'"), 'gestoria export route imports the SAME lib/caja-period helper (no duplicated period math)');
assert(!companyExportSrc.includes('function getRange('), 'company export route no longer has its own local getRange() — single source of truth');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. Gaps — days without a register are never zero-filled or invented');
// ─────────────────────────────────────────────────────────────────────────

{
  // A sparse month: only the 3rd and 20th have a confirmed register.
  const sparse = [row({ date: new Date('2026-03-03') }), row({ date: new Date('2026-03-20') })];
  const csv = generateCajaCSV(sparse);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  const bodyLines = lines.slice(1, lines.length - 1); // drop header + TOTAL PERIODO row
  assert(bodyLines.length === 2, `generateCajaCSV on a 2-row sparse input produces exactly 2 data rows (got ${bodyLines.length}), not 31 (no day-by-day fill)`);
  assert(!csv.includes('2026-03-01;0.00'), 'no synthetic zero row is generated for 2026-03-01 (a day with no register)');
}

for (const [label, src] of [['list route', listSrc], ['export route', exportSrc]] as const) {
  assert(src.includes('findMany('), `${label}: uses findMany (returns only rows that actually exist)`);
  assert(!/for\s*\(.*date/i.test(src) && !/while\s*\(/.test(src), `${label}: contains no date-iteration loop that could synthesize missing days`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. CSV generator — canonical lib/caja-csv.ts, no fourth variant');
// ─────────────────────────────────────────────────────────────────────────

assert(exportSrc.includes("import { generateCajaCSV } from '@/lib/caja-csv'"), 'gestoria export route imports generateCajaCSV from lib/caja-csv (the canonical generator)');
assert(companyExportSrc.includes("import { generateCajaCSV } from '@/lib/caja-csv'"), 'company export route imports the SAME generateCajaCSV (unchanged)');
assert(!exportSrc.includes('function generateCajaCSV'), 'gestoria export route does not redefine its own CSV generator');

const canonicalCsv = generateCajaCSV([row()]);
assert(canonicalCsv.includes('fecha;efectivo;tarjeta;bizum;transferencia;otros;total;descuadre;origen;estado;notas'), 'canonical CSV header/columns are exactly the company format (fecha..notas)');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. CSV scope — only the authorized clientCompanyId, never an arbitrary companyId');
// ─────────────────────────────────────────────────────────────────────────

assert(exportSrc.includes('const companyId = params.clientCompanyId;'), 'export route derives companyId strictly from the URL clientCompanyId param (route-scoped, cannot be overridden by query/body)');
assert(exportSrc.includes('where: { company_id: companyId,'), 'export route\'s DailyCashRegister query filters by that companyId');
assert(!/company_id:\s*(req(uest)?\.|searchParams\.get|body\.)/i.test(exportSrc), 'company_id is never taken from a request query param or JSON body (only from the authorized route param)');
assert(listSrc.includes('const companyId = params.clientCompanyId;'), 'list route also derives companyId strictly from the URL clientCompanyId param');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. Direct CSV download — correct content-type, no ZIP for this endpoint');
// ─────────────────────────────────────────────────────────────────────────

assert(exportSrc.includes("'Content-Type': 'text/csv; charset=utf-8'"), 'export route responds with Content-Type: text/csv; charset=utf-8');
assert(exportSrc.includes('Content-Disposition'), 'export route sets a Content-Disposition attachment header (direct download, not a JSON+signed-url indirection)');
assert(
  !/application\/zip|JSZip|archiver|\.zip['"`]/i.test(exportSrc),
  'export route contains no ZIP-generation code (no archiver import, no application/zip content-type, no .zip filename) — plain CSV response only',
);
assert(exportSrc.includes('new Response(csv'), 'export route streams the CSV directly as the HTTP response body');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. Existing ZIP export ("Exportación completa" / Exportar A3) still wired up');
// ─────────────────────────────────────────────────────────────────────────

const fiscalBuilderSrc = fs.readFileSync(fiscalExportBuilderPath, 'utf8');
assert(fiscalBuilderSrc.includes("from './caja-csv'") || fiscalBuilderSrc.includes('generateCajaCSV'), 'lib/fiscal-export-builder.ts still generates caja_tpv.csv via generateCajaCSV (untouched)');
assert(fs.existsSync(fiscalExportPlanRoutePath), 'gestoria fiscal-export/plan route still exists');
const fiscalPlanSrc = fs.readFileSync(fiscalExportPlanRoutePath, 'utf8');
assert(fiscalPlanSrc.includes('planFiscalExport'), 'fiscal-export/plan route still calls planFiscalExport (ZIP planning logic untouched)');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n9. New gestoria routes are strictly read-only — no DailyCashRegister writes');
// ─────────────────────────────────────────────────────────────────────────

for (const [label, src] of [['list route', listSrc], ['export route', exportSrc]] as const) {
  assert(!/dailyCashRegister\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(src), `${label}: no DailyCashRegister write call of any kind`);
  assert(src.includes('export async function GET'), `${label}: exports a GET handler`);
  assert(!/export async function (POST|PUT|PATCH|DELETE)/.test(src), `${label}: exports no POST/PUT/PATCH/DELETE handler`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n10. Company-side "Caja y Cobros" behavior is unchanged for a normal company user');
// ─────────────────────────────────────────────────────────────────────────

const companySrc = fs.readFileSync(companyRoutePath, 'utf8');
assert(companySrc.includes('pendingAI'), 'company list route still returns pendingAI (AI-detected pending closures) — company workflow untouched');
assert(companySrc.includes('export async function POST'), 'company list route still exports POST (manual register creation) — untouched');
assert(companySrc.includes("import { getMonthRange } from '@/lib/caja-period'"), 'company list route now sources its month range from the shared helper (same math, refactored, not reimplemented)');
{
  // Prove the refactor is behavior-preserving: recompute what the old inline
  // `new Date(year, month-1, 1)` / `new Date(year, month, 1)` calc produced
  // and confirm it's bit-for-bit identical to getMonthRange's output.
  const year = 2026, month = 6;
  const oldFrom = new Date(year, month - 1, 1);
  const oldTo = new Date(year, month, 1);
  const { from, to } = getMonthRange(year, month);
  assert(from.getTime() === oldFrom.getTime() && to.getTime() === oldTo.getTime(), 'getMonthRange() output is bit-for-bit identical to the previous inline calculation (no behavior change for the company page)');
}
const companyExportRouteSrc2 = companyExportSrc; // already loaded above
assert(companyExportRouteSrc2.includes('resolveActiveCompanyId'), 'company export route still scopes by the caller\'s own active company (unchanged auth path, distinct from the gestoria route\'s resolveGestoriaAccess)');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
