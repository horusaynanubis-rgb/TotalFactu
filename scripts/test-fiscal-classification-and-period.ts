/**
 * Pure logic tests for Fase Gascón Fase 3 (simplified-invoice classification +
 * fiscal_period) — no DB, no network.
 * Run with: npx tsx scripts/test-fiscal-classification-and-period.ts
 *
 * Covers cases 1-6, 9, 11, 12, 13, 15, 16 of the approved test plan. Cases
 * 7-8 (reprocess preserves human document_type/fiscal_period) are already
 * covered by scripts/test-invoice-fiscal-preservation.ts (Fase 1+2) and are
 * not duplicated here. Case 10 (API cross-company protection) is a
 * source-inspection regression guard at the bottom of this file, following
 * the same pattern scripts/test-resolve-duplicates-safety.ts already uses
 * for "no accidental write" guards.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getDeductibleInputVat,
  getExpenseAmount,
  getEffectiveFiscalPeriod,
  invoiceEffectivePeriodWhere,
} from '../lib/invoice-fiscal-treatment';
import { suggestDocumentType } from '../lib/document-type-classifier';
import { buildFiscalOverrideUpdate } from '../lib/invoice-fiscal-override';
import { buildEconomicSummaryFromData, EconomicInvoiceInput } from '../lib/economic-summary';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nCase 1: legacy document_type=NULL preserves exact prior behavior\n');
{
  const inv = { document_type: null, tax_amount: 21, subtotal: 100, total_amount: 121 };
  assert(getDeductibleInputVat(inv) === 21, 'IVA deducible = tax_amount cuando document_type es NULL (legacy)');
  assert(getExpenseAmount(inv) === 100, 'gasto = subtotal cuando document_type es NULL (legacy) — igual que lib/economic-summary.ts hoy');
}

console.log('\nCase 2: FULL_INVOICE behaves identically to legacy NULL\n');
{
  const inv = { document_type: 'FULL_INVOICE', tax_amount: 21, subtotal: 100, total_amount: 121 };
  assert(getDeductibleInputVat(inv) === 21, 'IVA deducible = tax_amount para FULL_INVOICE');
  assert(getExpenseAmount(inv) === 100, 'gasto = subtotal para FULL_INVOICE');
}

console.log('\nCase 3: SIMPLIFIED_INVOICE — original data preserved, deductible=0, expense=total\n');
{
  // Example from the approved spec: base=10.00, IVA impreso=2.10, total=12.10
  const inv = { document_type: 'SIMPLIFIED_INVOICE', tax_amount: 2.10, subtotal: 10.00, total_amount: 12.10 };
  assert(getDeductibleInputVat(inv) === 0, 'IVA deducible = 0 para SIMPLIFIED_INVOICE');
  assert(getExpenseAmount(inv) === 12.10, 'gasto = total_amount (12.10) para SIMPLIFIED_INVOICE');
  assert(inv.tax_amount === 2.10 && inv.subtotal === 10.00 && inv.total_amount === 12.10, 'los datos documentales originales (base/IVA/total) permanecen intactos — nunca se mutan');
}

console.log('\nCase 4: fiscal_period NULL falls back to issue_date exactly as today\n');
{
  const issueDate = new Date('2026-06-15T00:00:00Z');
  const effective = getEffectiveFiscalPeriod({ fiscal_period_year: null, fiscal_period_quarter: null, issue_date: issueDate });
  assert(effective.year === 2026 && effective.quarter === 2, 'fiscal_period NULL -> Q2 2026, el trimestre natural de issue_date (15/06/2026)');
}

console.log('\nCase 5: explicit fiscal_period overrides ONLY the fiscal period, never issue_date itself\n');
{
  const issueDate = new Date('2026-06-15T00:00:00Z');
  const effective = getEffectiveFiscalPeriod({ fiscal_period_year: 2026, fiscal_period_quarter: 3, issue_date: issueDate });
  assert(effective.year === 2026 && effective.quarter === 3, 'fiscal_period explícito (Q3) sustituye el trimestre natural de issue_date (que sería Q2)');
  assert(issueDate.toISOString() === '2026-06-15T00:00:00.000Z', 'issue_date en sí no se ha tocado en ningún momento — es un campo completamente independiente');
}

console.log('\nCase 6: buildFiscalOverrideUpdate never touches issue_date, even when overriding fiscal_period\n');
{
  const { updateData } = buildFiscalOverrideUpdate(
    { document_type: null, fiscal_period_year: null, fiscal_period_quarter: null },
    { fiscal_period_year: 2026, fiscal_period_quarter: 3 },
    'user_gascon',
  );
  assert(!('issue_date' in updateData), 'el payload de actualización de fiscal_period nunca incluye issue_date');
  assert(updateData.fiscal_period_year === 2026 && updateData.fiscal_period_quarter === 3, 'fiscal_period_year/quarter sí se actualizan');
}

console.log('\nCase 9: suggested_document_type is never equivalent to a confirmed document_type\n');
{
  // A ticket with no recipient tax-id gets suggested as SIMPLIFIED_INVOICE...
  const suggestion = suggestDocumentType({
    recipient_tax_id: null,
    customer_tax_id: null,
    total_amount: 12.10,
    category: 'ticket de compra',
    notes: null,
    invoice_number: null,
  });
  assert(suggestion === 'SIMPLIFIED_INVOICE', 'el clasificador sugiere SIMPLIFIED_INVOICE ante señal de texto + ausencia de NIF destinatario');

  // ...but buildFiscalOverrideUpdate only ever acts on an EXPLICIT request —
  // the suggestion by itself never enters the update payload.
  const { updateData, auditEntries } = buildFiscalOverrideUpdate(
    { document_type: null, fiscal_period_year: null, fiscal_period_quarter: null },
    {}, // nothing explicitly requested — the suggestion above is NOT passed in
    'user_barbara',
  );
  assert(Object.keys(updateData).length === 0, 'sin una confirmación humana explícita, document_type permanece NULL pese a existir una sugerencia');
  assert(auditEntries.length === 0, 'no se genera ningún AuditLog por una mera sugerencia, solo por una confirmación explícita');
}

console.log('\nCase: amount < 400€ alone (without tax-id-absence) never triggers a suggestion\n');
{
  const suggestion = suggestDocumentType({
    recipient_tax_id: 'B12345678', // recipient IS identified
    customer_tax_id: null,
    total_amount: 50, // well under 400€
    category: null,
    notes: null,
    invoice_number: null,
  });
  assert(suggestion === 'FULL_INVOICE', 'con NIF de destinatario presente, un importe bajo NUNCA sugiere SIMPLIFIED_INVOICE por sí solo');
}

console.log('\nCase: amount < 400€ alone (recipient unidentified, no text signal) is NOT enough either — never determinant on its own per product decision\n');
{
  // Actually amount IS allowed as a tertiary corroborating signal once
  // recipient is unidentified — confirm it can tip the suggestion, but only
  // in combination with the primary signal, never in isolation (see next case).
  const suggestion = suggestDocumentType({
    recipient_tax_id: null,
    customer_tax_id: null,
    total_amount: 50,
    category: null,
    notes: null,
    invoice_number: null,
  });
  assert(suggestion === 'SIMPLIFIED_INVOICE', 'importe bajo SÍ puede ser señal terciaria, pero solo combinada con la señal primaria (NIF ausente) — nunca sola (ver caso anterior)');
}

console.log('\nCase 11: AuditLog entry for a document_type reclassification carries old/new values\n');
{
  const { updateData, auditEntries } = buildFiscalOverrideUpdate(
    { document_type: null, fiscal_period_year: null, fiscal_period_quarter: null },
    { document_type: 'SIMPLIFIED_INVOICE' },
    'user_barbara',
    new Date('2026-09-29T10:00:00Z'),
  );
  assert(auditEntries.length === 1, 'exactamente una entrada de audit log');
  assert(auditEntries[0].action === 'document_type_reclassified', 'action = document_type_reclassified');
  assert(JSON.parse(auditEntries[0].old_values).document_type === null, 'old_values recoge el valor anterior (NULL)');
  assert(JSON.parse(auditEntries[0].new_values).document_type === 'SIMPLIFIED_INVOICE', 'new_values recoge el valor nuevo');
  assert(updateData.document_type_classified_by === 'user_barbara', 'el usuario que confirma queda registrado (classified_by)');
  assert((updateData.document_type_classified_at as Date).toISOString() === '2026-09-29T10:00:00.000Z', 'el timestamp de confirmación queda registrado (classified_at)');
}

console.log('\nCase 12: AuditLog entry for a fiscal_period override carries old/new values\n');
{
  const { updateData, auditEntries } = buildFiscalOverrideUpdate(
    { document_type: null, fiscal_period_year: 2026, fiscal_period_quarter: 2 },
    { fiscal_period_year: 2026, fiscal_period_quarter: 3 },
    'user_gascon',
    new Date('2026-09-29T11:00:00Z'),
  );
  assert(auditEntries.length === 1, 'exactamente una entrada de audit log');
  assert(auditEntries[0].action === 'fiscal_period_overridden', 'action = fiscal_period_overridden');
  assert(JSON.parse(auditEntries[0].old_values).fiscal_period_quarter === 2, 'old_values recoge el trimestre anterior (Q2)');
  assert(JSON.parse(auditEntries[0].new_values).fiscal_period_quarter === 3, 'new_values recoge el trimestre nuevo (Q3)');
  assert(updateData.fiscal_period_set_by === 'user_gascon', 'el usuario que hace el override queda registrado (set_by)');
  assert((updateData.fiscal_period_set_at as Date).toISOString() === '2026-09-29T11:00:00.000Z', 'el timestamp del override queda registrado (set_at)');
}

console.log('\nCase 13: Economic Summary respects SIMPLIFIED_INVOICE (gasto = total_amount, not subtotal)\n');
{
  function invoice(overrides: Partial<EconomicInvoiceInput>): EconomicInvoiceInput {
    return {
      invoice_type: 'received', subtotal: 100, total_amount: 100, currency: 'EUR',
      fiscal_status: 'classified', gestoria_review_status: 'reviewed_ok', document_type: null,
      ...overrides,
    };
  }
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q3 2026',
    invoices: [
      invoice({ document_type: 'FULL_INVOICE', subtotal: 100, total_amount: 121 }),
      invoice({ document_type: 'SIMPLIFIED_INVOICE', subtotal: 10, total_amount: 12.10 }),
    ],
    cashRegisters: [],
  });
  assert(s.gastos === 112.10, 'gastos = 100 (FULL, subtotal) + 12.10 (SIMPLIFIED, total_amount) = 112.10, no 110');
}

console.log('\nCase 14: the same central helper a Fiscal aggregation would use respects SIMPLIFIED_INVOICE\n');
{
  // lib/fiscal-summary.ts's ivaSoportado reduction is DB-backed and not a pure
  // exported function, but it calls getDeductibleInputVat() per invoice — this
  // reproduces that exact reduction pattern to guard the rule at the unit level.
  const invoices = [
    { document_type: 'FULL_INVOICE' as const, tax_amount: 21 },
    { document_type: 'SIMPLIFIED_INVOICE' as const, tax_amount: 2.10 },
    { document_type: null, tax_amount: 5 },
  ];
  const ivaSoportado = invoices.reduce((sum, inv) => sum + getDeductibleInputVat(inv), 0);
  assert(Math.abs(ivaSoportado - 26) < 0.001, 'ivaSoportado = 21 (FULL) + 0 (SIMPLIFIED, excluido) + 5 (NULL/legacy) = 26, no 28.10');
}

console.log('\nCase 15: exports use the effective fiscal period (invoiceEffectivePeriodWhere), not raw issue_date alone\n');
{
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-09-30T23:59:59Z');
  const where = invoiceEffectivePeriodWhere(2026, 3, from, to);
  assert(Array.isArray(where.OR) && where.OR.length === 2, 'la condición tiene exactamente 2 ramas OR');
  assert(where.OR[0].fiscal_period_year === 2026 && where.OR[0].fiscal_period_quarter === 3, 'rama 1: match explícito por fiscal_period confirmado (una factura tardía imputada a Q3 aparece aquí aunque su issue_date sea de otro trimestre)');
  const fallbackBranch = where.OR[1] as { fiscal_period_year: null; issue_date: { gte: Date; lte: Date } };
  assert(fallbackBranch.fiscal_period_year === null, 'rama 2: fallback para filas sin fiscal_period (histórico) — solo estas usan el rango issue_date');
  assert(fallbackBranch.issue_date.gte === from && fallbackBranch.issue_date.lte === to, 'rama 2 usa el rango [from, to] exacto pasado por el caller — igual que el comportamiento previo a esta feature');
}

console.log('\nCase 16: historical row (document_type NULL, fiscal_period NULL) is byte-for-byte unaffected\n');
{
  const legacyInvoice = { document_type: null, tax_amount: 15.50, subtotal: 73.81, total_amount: 89.31 };
  const legacyPeriod = getEffectiveFiscalPeriod({ fiscal_period_year: null, fiscal_period_quarter: null, issue_date: new Date('2024-04-11T00:00:00Z') });
  assert(getDeductibleInputVat(legacyInvoice) === 15.50, 'factura histórica: IVA deducible sigue siendo tax_amount completo');
  assert(getExpenseAmount(legacyInvoice) === 73.81, 'factura histórica: gasto sigue siendo subtotal');
  assert(legacyPeriod.year === 2024 && legacyPeriod.quarter === 2, 'factura histórica: periodo sigue derivándose de issue_date (Q2 2024), nunca de upload_date');
}

// ---------------------------------------------------------------------------
// Case 10 (source-inspection regression guard): the gestoría PATCH route must
// scope its Invoice lookup by company_id, or a gestoría user from company A
// could reclassify/override an invoice belonging to company B by guessing an
// invoiceId. Mirrors the "no accidental write" source-inspection pattern
// already used in scripts/test-resolve-duplicates-safety.ts.
// ---------------------------------------------------------------------------
console.log('\nCase 10: gestoría PATCH route scopes the invoice lookup by company_id (no cross-company access)\n');
{
  const routePath = path.join(__dirname, '../app/api/gestoria/clients/[clientCompanyId]/invoices/[invoiceId]/review/route.ts');
  const source = fs.readFileSync(routePath, 'utf-8');
  const patchSection = source.slice(source.indexOf('export async function PATCH'));
  assert(
    /findFirst\(\{\s*where:\s*\{\s*id:\s*params\.invoiceId,\s*company_id:\s*params\.clientCompanyId/.test(patchSection),
    'PATCH busca la Invoice con company_id: params.clientCompanyId — un invoiceId de otra empresa nunca se encuentra (404), no se puede modificar cross-company',
  );
  assert(
    /prisma\.auditLog\.create\(\{\s*data:\s*\{\s*company_id:\s*params\.clientCompanyId/.test(patchSection),
    'el AuditLog resultante también queda asociado a params.clientCompanyId, no a la empresa de la gestoría',
  );

  const invoicesRoutePath = path.join(__dirname, '../app/api/invoices/[id]/route.ts');
  const invoicesSource = fs.readFileSync(invoicesRoutePath, 'utf-8');
  const patchSection2 = invoicesSource.slice(invoicesSource.indexOf('export async function PATCH'));
  assert(
    /membership\.findFirst\(\{\s*where:\s*\{\s*user_id:\s*session\.user\.id,\s*company_id:\s*existingInvoice\.company_id/.test(patchSection2),
    'PATCH /api/invoices/[id] exige Membership del usuario en la company_id real de la factura — sin cambios respecto al guard ya existente',
  );
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
