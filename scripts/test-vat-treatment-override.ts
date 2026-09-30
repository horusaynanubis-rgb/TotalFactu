/**
 * Tests for Invoice.vat_treatment_override (2026-09-30, Marc/Gascón "AIGÜES
 * DE PALAMÓS" case) — a FULL_INVOICE whose fiscal recipient is a third party
 * (e.g. a utility bill addressed to the premises' individual owner,
 * repercuted to the company): deductible VAT must be 0 and the expense must
 * be the full total_amount, WITHOUT reclassifying the document as
 * SIMPLIFIED_INVOICE (that would corrupt the documental/legal
 * classification — see design discussion with Jesús Gascón).
 *
 * Effects are centralized EXCLUSIVELY in
 * lib/invoice-fiscal-treatment.ts's VAT_TREATMENT_OVERRIDE_EFFECTS table —
 * getDeductibleInputVat/getExpenseAmount/splitVatDeductibility each read
 * their own property of the SAME looked-up effect; neither infers one
 * outcome from the other (no scattered "if deductibleVat===0 then
 * expense=total" logic anywhere).
 *
 * Matching this repo's test convention (see scripts/test-fiscal-classification-and-period.ts,
 * scripts/test-gestoria-caja-cobros.ts): pure-logic tests against the real
 * lib functions (no DB, no network), plus structural regression checks on
 * route/schema/migration source where a live DB/session isn't needed to
 * prove the point.
 *
 * Run with: npx tsx scripts/test-vat-treatment-override.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getDeductibleInputVat,
  getExpenseAmount,
  splitVatDeductibility,
  VAT_TREATMENT_THIRD_PARTY_RECIPIENT,
  DOCUMENT_TYPE_FULL_INVOICE,
  DOCUMENT_TYPE_SIMPLIFIED_INVOICE,
} from '../lib/invoice-fiscal-treatment';
import {
  buildFiscalOverrideUpdate,
  isValidVatTreatmentOverrideValue,
  isVatTreatmentOverrideConsistentWithDocumentType,
  CurrentFiscalFields,
} from '../lib/invoice-fiscal-override';
import { extractPreservedFiscalFields, PreservableFiscalFields } from '../lib/invoice-fiscal-preservation';
import { buildEconomicSummaryFromData, EconomicInvoiceInput } from '../lib/economic-summary';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const ROOT = path.join(__dirname, '..');

function currentFields(overrides: Partial<CurrentFiscalFields> = {}): CurrentFiscalFields {
  return {
    document_type: null,
    fiscal_period_year: null,
    fiscal_period_quarter: null,
    vat_treatment_override: null,
    vat_treatment_override_note: null,
    ...overrides,
  };
}

function preservable(overrides: Partial<PreservableFiscalFields> = {}): PreservableFiscalFields {
  return {
    document_type: null,
    suggested_document_type: null,
    document_type_classified_by: null,
    document_type_classified_at: null,
    fiscal_period_year: null,
    fiscal_period_quarter: null,
    fiscal_period_set_by: null,
    fiscal_period_set_at: null,
    vat_treatment_override: null,
    vat_treatment_override_note: null,
    vat_treatment_override_set_by: null,
    vat_treatment_override_set_at: null,
    ...overrides,
  };
}

function economicInvoice(overrides: Partial<EconomicInvoiceInput> = {}): EconomicInvoiceInput {
  return {
    invoice_type: 'received', subtotal: 196.33, total_amount: 209.61, currency: 'EUR',
    fiscal_status: 'pending_classification', gestoria_review_status: null,
    document_type: null, vat_treatment_override: null,
    ...overrides,
  };
}

// The AIGÜES invoice's real extracted amounts (subtotal recorded == total_amount
// in production — an extraction quirk noted separately, not something these
// tests assume away; they use realistic-but-distinct numbers to prove nothing
// gets mixed up).
const AIGUES_LIKE = { subtotal: 196.33, tax_amount: 13.28, total_amount: 209.61 };

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. FULL_INVOICE (no override) keeps today\'s exact behavior');
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = { document_type: DOCUMENT_TYPE_FULL_INVOICE, ...AIGUES_LIKE, vat_treatment_override: null };
  assert(getDeductibleInputVat(inv) === 13.28, 'FULL_INVOICE sin override: IVA deducible = tax_amount completo');
  assert(getExpenseAmount(inv) === 196.33, 'FULL_INVOICE sin override: gasto = subtotal (comportamiento normal, sin tocar)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. FULL_INVOICE + THIRD_PARTY_RECIPIENT: deductible VAT = 0');
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = { document_type: DOCUMENT_TYPE_FULL_INVOICE, ...AIGUES_LIKE, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT };
  assert(getDeductibleInputVat(inv) === 0, 'FULL_INVOICE + THIRD_PARTY_RECIPIENT: IVA deducible = 0');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. FULL_INVOICE + THIRD_PARTY_RECIPIENT: expense = total_amount');
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = { document_type: DOCUMENT_TYPE_FULL_INVOICE, ...AIGUES_LIKE, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT };
  assert(getExpenseAmount(inv) === 209.61, 'FULL_INVOICE + THIRD_PARTY_RECIPIENT: gasto = total_amount, NO subtotal');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4-6. Original tax_amount / subtotal / total_amount are never mutated');
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = { document_type: DOCUMENT_TYPE_FULL_INVOICE, ...AIGUES_LIKE, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT };
  const snapshot = { ...inv };
  getDeductibleInputVat(inv);
  getExpenseAmount(inv);
  splitVatDeductibility({ invoice_type: 'received', document_type: inv.document_type, vat_treatment_override: inv.vat_treatment_override }, inv.tax_amount);
  assert(inv.tax_amount === snapshot.tax_amount && inv.tax_amount === 13.28, 'tax_amount original permanece intacto (13.28) tras derivar el tratamiento fiscal');
  assert(inv.subtotal === snapshot.subtotal && inv.subtotal === 196.33, 'subtotal original permanece intacto (196.33)');
  assert(inv.total_amount === snapshot.total_amount && inv.total_amount === 209.61, 'total original permanece intacto (209.61)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. SIMPLIFIED_INVOICE keeps today\'s exact behavior (unaffected by the new override)');
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = { document_type: DOCUMENT_TYPE_SIMPLIFIED_INVOICE, subtotal: 10, tax_amount: 2.10, total_amount: 12.10, vat_treatment_override: null };
  assert(getDeductibleInputVat(inv) === 0, 'SIMPLIFIED_INVOICE: IVA deducible = 0 (sin cambios)');
  assert(getExpenseAmount(inv) === 12.10, 'SIMPLIFIED_INVOICE: gasto = total_amount (sin cambios)');
  const split = splitVatDeductibility({ invoice_type: 'received', document_type: DOCUMENT_TYPE_SIMPLIFIED_INVOICE, vat_treatment_override: null }, 2.10);
  assert(split.deductible === 0 && split.nonDeductible === 2.10, 'splitVatDeductibility SIMPLIFIED_INVOICE: sin cambios');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. legacy document_type NULL keeps today\'s exact behavior (unaffected by the new override)');
// ─────────────────────────────────────────────────────────────────────────
{
  const inv = { document_type: null, subtotal: 73.81, tax_amount: 15.50, total_amount: 89.31, vat_treatment_override: null };
  assert(getDeductibleInputVat(inv) === 15.50, 'legacy NULL: IVA deducible = tax_amount completo (sin cambios)');
  assert(getExpenseAmount(inv) === 73.81, 'legacy NULL: gasto = subtotal (sin cambios)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n9. detalle_iva.csv: THIRD_PARTY_RECIPIENT never shows the documental VAT as deductible');
// ─────────────────────────────────────────────────────────────────────────
{
  // Exactly the computation lib/iva-detalle.ts performs per rate-bucket/row.
  const split = splitVatDeductibility(
    { invoice_type: 'received', document_type: DOCUMENT_TYPE_FULL_INVOICE, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT },
    13.28,
  );
  assert(split.deductible === 0, 'detalle_iva: cuota_iva (deducible) = 0 para THIRD_PARTY_RECIPIENT');
  assert(split.nonDeductible === 13.28, 'detalle_iva: iva_no_deducible conserva el importe documental real (13.28)');
  assert(split.deductible + split.nonDeductible === 13.28, 'invariante: deducible + no_deducible siempre suma el IVA impreso real');

  const ivaDetalleSrc = fs.readFileSync(path.join(ROOT, 'lib', 'iva-detalle.ts'), 'utf8');
  assert(ivaDetalleSrc.includes('vat_treatment_override: true'), 'lib/iva-detalle.ts consulta vat_treatment_override en su select de Prisma');
  assert(ivaDetalleSrc.includes('splitVatDeductibility(inv,'), 'lib/iva-detalle.ts pasa la fila completa (con vat_treatment_override) a splitVatDeductibility, no un literal recortado');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n10. Economic Summary: gastos usa el TOTAL cuando hay THIRD_PARTY_RECIPIENT');
// ─────────────────────────────────────────────────────────────────────────
{
  const s = buildEconomicSummaryFromData({
    periodLabel: 'Q3 2026',
    invoices: [
      economicInvoice({ document_type: DOCUMENT_TYPE_FULL_INVOICE, subtotal: 100, total_amount: 121, vat_treatment_override: null }),
      economicInvoice({ document_type: DOCUMENT_TYPE_FULL_INVOICE, subtotal: 196.33, total_amount: 209.61, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT }),
    ],
    cashRegisters: [],
  });
  assert(s.gastos === 309.61, 'gastos = 100 (FULL normal, subtotal) + 209.61 (THIRD_PARTY_RECIPIENT, total_amount) = 309.61, no 296.33 (que sería si se usase subtotal también para la segunda)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n11. Fiscal (ivaSoportado): THIRD_PARTY_RECIPIENT contribuye 0');
// ─────────────────────────────────────────────────────────────────────────
{
  // Reproduces lib/fiscal-summary.ts's exact per-invoice reduction pattern
  // (getDeductibleInputVat called once per received invoice).
  const invoices = [
    { document_type: DOCUMENT_TYPE_FULL_INVOICE, tax_amount: 21, vat_treatment_override: null },
    { document_type: DOCUMENT_TYPE_FULL_INVOICE, tax_amount: 13.28, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT },
    { document_type: DOCUMENT_TYPE_SIMPLIFIED_INVOICE, tax_amount: 2.10, vat_treatment_override: null },
  ];
  const ivaSoportado = invoices.reduce((sum, inv) => sum + getDeductibleInputVat(inv), 0);
  assert(Math.abs(ivaSoportado - 21) < 0.001, 'ivaSoportado = 21 (FULL normal) + 0 (THIRD_PARTY_RECIPIENT) + 0 (SIMPLIFIED) = 21, no 34.28 ni 36.38');

  const fiscalSummarySrc = fs.readFileSync(path.join(ROOT, 'lib', 'fiscal-summary.ts'), 'utf8');
  assert(fiscalSummarySrc.includes('vat_treatment_override: true'), 'lib/fiscal-summary.ts consulta vat_treatment_override en su select de Prisma');
  assert(fiscalSummarySrc.includes('vat_treatment_override: inv.vat_treatment_override'), 'lib/fiscal-summary.ts pasa vat_treatment_override a getDeductibleInputVat()');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n12. Reprocessing preserva la decisión humana (y solo si es humana)');
// ─────────────────────────────────────────────────────────────────────────
{
  const setAt = new Date('2026-09-30T10:00:00Z');
  const old = preservable({
    document_type: DOCUMENT_TYPE_FULL_INVOICE,
    document_type_classified_by: 'user_barbara',
    document_type_classified_at: setAt,
    vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT,
    vat_treatment_override_note: 'Factura de suministros del local, emitida a la propietaria',
    vat_treatment_override_set_by: 'user_barbara',
    vat_treatment_override_set_at: setAt,
  });
  const preserved = extractPreservedFiscalFields(old);
  assert(preserved.vat_treatment_override === VAT_TREATMENT_THIRD_PARTY_RECIPIENT, 'vat_treatment_override confirmado se preserva tras un reprocesado');
  assert(preserved.vat_treatment_override_note === 'Factura de suministros del local, emitida a la propietaria', 'vat_treatment_override_note se preserva');
  assert(preserved.vat_treatment_override_set_by === 'user_barbara', 'vat_treatment_override_set_by se preserva');
  assert(preserved.vat_treatment_override_set_at === setAt, 'vat_treatment_override_set_at se preserva');
  assert(preserved.document_type === DOCUMENT_TYPE_FULL_INVOICE, 'document_type confirmado (FULL_INVOICE) también se preserva junto al override');
}
{
  // Never touched by a human (no _set_by) — must NOT be preserved, exactly
  // like a merely-suggested document_type.
  const old = preservable({ vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT, vat_treatment_override_set_by: null });
  const preserved = extractPreservedFiscalFields(old);
  assert(!('vat_treatment_override' in preserved), 'vat_treatment_override sin vat_treatment_override_set_by NO se preserva (nunca debería darse, pero por seguridad no se propaga un dato sin autoría)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n13. Otra factura sin override no cambia (no hay mezcla entre facturas del mismo lote)');
// ─────────────────────────────────────────────────────────────────────────
{
  const untouched = { document_type: DOCUMENT_TYPE_FULL_INVOICE, subtotal: 500, tax_amount: 105, total_amount: 605, vat_treatment_override: null };
  const overridden = { document_type: DOCUMENT_TYPE_FULL_INVOICE, subtotal: 196.33, tax_amount: 13.28, total_amount: 209.61, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT };
  // Evaluate both, in the same "batch", in both orders — the presence of one
  // override must never leak into the other invoice's own computation (these
  // are pure per-invoice functions with no shared/global state).
  assert(getDeductibleInputVat(untouched) === 105 && getExpenseAmount(untouched) === 500, 'la factura SIN override conserva su tratamiento normal (105 deducible, 500 de gasto) al margen de la otra factura con override');
  assert(getDeductibleInputVat(overridden) === 0 && getExpenseAmount(overridden) === 209.61, 'la factura CON override sigue dando 0/209.61 en el mismo lote');
  assert(getDeductibleInputVat(untouched) === 105, 'reevaluar en otro orden no cambia el resultado de la factura sin override (sin estado compartido)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n14. AuditLog registra la decisión (vat_treatment_overridden)');
// ─────────────────────────────────────────────────────────────────────────
{
  const { updateData, auditEntries } = buildFiscalOverrideUpdate(
    currentFields({ document_type: DOCUMENT_TYPE_FULL_INVOICE }),
    { vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT, vat_treatment_override_note: 'Factura emitida a un tercero' },
    'user_barbara',
    new Date('2026-09-30T12:00:00Z'),
  );
  assert(auditEntries.length === 1, 'exactamente una entrada de audit log para el cambio de vat_treatment_override');
  assert(auditEntries[0].action === 'vat_treatment_overridden', 'action = vat_treatment_overridden');
  assert(JSON.parse(auditEntries[0].old_values).vat_treatment_override === null, 'old_values recoge el valor anterior (NULL)');
  assert(JSON.parse(auditEntries[0].new_values).vat_treatment_override === VAT_TREATMENT_THIRD_PARTY_RECIPIENT, 'new_values recoge el código nuevo');
  assert(JSON.parse(auditEntries[0].new_values).vat_treatment_override_note === 'Factura emitida a un tercero', 'new_values recoge también la nota');
  assert(updateData.vat_treatment_override_set_by === 'user_barbara', 'el usuario que confirma queda registrado (set_by)');
  assert((updateData.vat_treatment_override_set_at as Date).toISOString() === '2026-09-30T12:00:00.000Z', 'el timestamp de confirmación queda registrado (set_at)');
}
{
  // Resending the exact same value is a silent no-op — no spurious audit line.
  const { updateData, auditEntries } = buildFiscalOverrideUpdate(
    currentFields({ document_type: DOCUMENT_TYPE_FULL_INVOICE, vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT, vat_treatment_override_note: 'x' }),
    { vat_treatment_override: VAT_TREATMENT_THIRD_PARTY_RECIPIENT, vat_treatment_override_note: 'x' },
    'user_barbara',
  );
  assert(Object.keys(updateData).length === 0 && auditEntries.length === 0, 'reenviar el mismo valor no genera update ni audit log (no-op silencioso, igual que document_type)');
}

// Guard: THIRD_PARTY_RECIPIENT must never combine with SIMPLIFIED_INVOICE.
{
  assert(isValidVatTreatmentOverrideValue(null) === true, 'NULL es un valor válido de vat_treatment_override');
  assert(isValidVatTreatmentOverrideValue(VAT_TREATMENT_THIRD_PARTY_RECIPIENT) === true, 'THIRD_PARTY_RECIPIENT es un valor válido');
  assert(isValidVatTreatmentOverrideValue('BOGUS_CODE') === false, 'un código arbitrario/no soportado es rechazado');
  assert(isVatTreatmentOverrideConsistentWithDocumentType(DOCUMENT_TYPE_FULL_INVOICE, VAT_TREATMENT_THIRD_PARTY_RECIPIENT) === true, 'FULL_INVOICE + THIRD_PARTY_RECIPIENT es una combinación válida');
  assert(isVatTreatmentOverrideConsistentWithDocumentType(DOCUMENT_TYPE_SIMPLIFIED_INVOICE, VAT_TREATMENT_THIRD_PARTY_RECIPIENT) === false, 'SIMPLIFIED_INVOICE + THIRD_PARTY_RECIPIENT se rechaza — no reutilizar SIMPLIFIED_INVOICE para este caso');
  assert(isVatTreatmentOverrideConsistentWithDocumentType(DOCUMENT_TYPE_SIMPLIFIED_INVOICE, null) === true, 'SIMPLIFIED_INVOICE sin override sigue siendo válido (caso normal, sin tocar)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n15. Autorización de empresa/gestoría sigue funcionando (sin regresión)');
// ─────────────────────────────────────────────────────────────────────────
{
  const companyRouteSrc = fs.readFileSync(path.join(ROOT, 'app', 'api', 'invoices', '[id]', 'route.ts'), 'utf8');
  const patchSection = companyRouteSrc.slice(companyRouteSrc.indexOf('export async function PATCH'));
  const idxMembership = patchSection.indexOf('membership.findFirst');
  const idxForbidden = patchSection.indexOf("status: 403");
  const idxVatOverride = patchSection.indexOf('vat_treatment_override');
  assert(idxMembership !== -1 && idxForbidden !== -1, 'la ruta de empresa sigue comprobando Membership (guard existente intacto)');
  assert(idxMembership < idxVatOverride, 'la comprobación de Membership sigue estando ANTES de cualquier lógica de vat_treatment_override');

  const gestoriaRouteSrc = fs.readFileSync(
    path.join(ROOT, 'app', 'api', 'gestoria', 'clients', '[clientCompanyId]', 'invoices', '[invoiceId]', 'review', 'route.ts'),
    'utf8',
  );
  const gestoriaPatchSection = gestoriaRouteSrc.slice(gestoriaRouteSrc.indexOf('export async function PATCH'));
  const idxAccess = gestoriaPatchSection.indexOf('resolveGestoriaAccess(session.user.id, params.clientCompanyId)');
  const idxViewerGuard = gestoriaPatchSection.indexOf("role === 'viewer'");
  const idxGestoriaVatOverride = gestoriaPatchSection.indexOf('vat_treatment_override');
  const idxCompanyScopedLookup = gestoriaPatchSection.indexOf('company_id: params.clientCompanyId');
  assert(idxAccess !== -1 && idxViewerGuard !== -1, 'la ruta de gestoría sigue comprobando resolveGestoriaAccess() y el guard de viewer (guards existentes intactos)');
  assert(idxAccess < idxGestoriaVatOverride, 'resolveGestoriaAccess() sigue ejecutándose ANTES de cualquier lógica de vat_treatment_override');
  assert(idxViewerGuard < idxGestoriaVatOverride, 'el guard de viewer sigue ejecutándose ANTES de cualquier lógica de vat_treatment_override');
  assert(idxCompanyScopedLookup !== -1 && idxCompanyScopedLookup < idxGestoriaVatOverride, 'la Invoice se sigue buscando con company_id: params.clientCompanyId ANTES del nuevo código — sin acceso cross-company');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nExtra: schema/migration son aditivos, nullable, sin backfill');
// ─────────────────────────────────────────────────────────────────────────
{
  const schemaSrc = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  assert(schemaSrc.includes('vat_treatment_override          String?'), 'schema: vat_treatment_override es String? (nullable)');
  assert(schemaSrc.includes('vat_treatment_override_note     String?'), 'schema: vat_treatment_override_note es String? (nullable)');
  assert(schemaSrc.includes('vat_treatment_override_set_by   String?'), 'schema: vat_treatment_override_set_by es String? (nullable)');
  assert(schemaSrc.includes('vat_treatment_override_set_at   DateTime?'), 'schema: vat_treatment_override_set_at es DateTime? (nullable)');
  assert(schemaSrc.includes('@@index([vat_treatment_override])'), 'schema: índice sobre vat_treatment_override presente');

  const migrationPath = path.join(ROOT, 'prisma', 'migrations', 'add_invoice_vat_treatment_override.sql');
  assert(fs.existsSync(migrationPath), 'el fichero de migración existe');
  const migrationSrc = fs.readFileSync(migrationPath, 'utf8');
  const migrationDdlOnly = migrationSrc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert(!/NOT NULL/i.test(migrationDdlOnly), 'la migración no añade ninguna columna NOT NULL (fuera de los comentarios explicativos)');
  assert(!/DROP\s/i.test(migrationSrc), 'la migración no elimina nada (DROP)');
  assert(!/UPDATE\s+"?Invoice"?\s+SET/i.test(migrationSrc), 'la migración no hace backfill (sin UPDATE ... SET sobre Invoice)');
  assert((migrationSrc.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length === 4, 'la migración añade exactamente 4 columnas, todas con IF NOT EXISTS (idempotente)');
  assert(migrationSrc.includes('CREATE INDEX IF NOT EXISTS'), 'el índice también se crea de forma idempotente (IF NOT EXISTS)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
