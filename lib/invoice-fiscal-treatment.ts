// Central, single-source-of-truth fiscal treatment rules for Invoice.document_type
// and Invoice.fiscal_period_* (Fase Gascón, 2026-09) — reused by
// lib/fiscal-summary.ts, lib/economic-summary.ts, lib/fiscal-export-builder.ts
// and app/api/exports/generate/route.ts so none of them re-derive these rules
// independently. Pure, DB-agnostic — mirrors lib/fiscal-status.ts style.
//
// NOTE: Invoice.document_type ('FULL_INVOICE' | 'SIMPLIFIED_INVOICE') is
// unrelated to FiscalDocument.document_type (a different model — 'alquiler' |
// 'retenciones' | ... — see lib/fiscal-document-types.ts). Same field name,
// different models, never confuse the two.
import { quarterOfDate, FiscalQuarter } from './fiscal-calendar';

export const DOCUMENT_TYPE_FULL_INVOICE = 'FULL_INVOICE';
export const DOCUMENT_TYPE_SIMPLIFIED_INVOICE = 'SIMPLIFIED_INVOICE';

// VAT-deductibility override, independent of document_type (2026-09-30,
// Marc/Gascón "AIGÜES" case) — see the comment above
// Invoice.vat_treatment_override in prisma/schema.prisma for the full
// rationale. THIRD_PARTY_RECIPIENT: a confirmed FULL_INVOICE whose fiscal
// recipient is not this company; deductible VAT is 0 and the expense is the
// full total_amount, but the document is NEVER reclassified as
// SIMPLIFIED_INVOICE — that would corrupt the documental/legal
// classification for an unrelated reason.
export const VAT_TREATMENT_THIRD_PARTY_RECIPIENT = 'THIRD_PARTY_RECIPIENT';
export const VAT_TREATMENT_OVERRIDE_CODES = [VAT_TREATMENT_THIRD_PARTY_RECIPIENT] as const;
export type VatTreatmentOverrideCode = (typeof VAT_TREATMENT_OVERRIDE_CODES)[number];

interface VatTreatmentEffect {
  deductibleVat: 'ZERO' | 'FULL';
  expenseBasis: 'TOTAL' | 'SUBTOTAL';
}

// Single point of truth for what each vat_treatment_override code means.
// Each code declares BOTH its effects explicitly, in one place — no function
// below ever infers one effect from the other (e.g. no "if deductibleVat ===
// 0 then expense = total" anywhere); they each read their own property of
// the SAME looked-up effect. A future code with a different combination (or
// a partial-deductibility scenario) adds its own row here without touching
// any of the functions that consult this table.
const VAT_TREATMENT_OVERRIDE_EFFECTS: Record<string, VatTreatmentEffect> = {
  [VAT_TREATMENT_THIRD_PARTY_RECIPIENT]: { deductibleVat: 'ZERO', expenseBasis: 'TOTAL' },
};

function resolveVatTreatmentEffect(code: string | null | undefined): VatTreatmentEffect | null {
  if (!code) return null;
  return VAT_TREATMENT_OVERRIDE_EFFECTS[code] ?? null;
}

export interface DeductibleVatInput {
  document_type: string | null;
  tax_amount: number;
  vat_treatment_override?: string | null;
}

/**
 * Deductible input VAT for a received invoice.
 * - vat_treatment_override resolves to an effect (e.g. THIRD_PARTY_RECIPIENT):
 *   that effect's deductibleVat decides — 'ZERO' → 0, independent of document_type.
 * - Otherwise, SIMPLIFIED_INVOICE (human-confirmed): 0 — no recipient tax-id
 *   identification, the printed VAT is not legally deductible.
 * - Otherwise, FULL_INVOICE or document_type NULL (legacy/unconfirmed):
 *   tax_amount, unchanged from today's behavior.
 * The original tax_amount/tax_rate/subtotal/total_amount are NEVER mutated —
 * this is a read-time derivation only.
 */
export function getDeductibleInputVat(inv: DeductibleVatInput): number {
  const effect = resolveVatTreatmentEffect(inv.vat_treatment_override);
  if (effect) return effect.deductibleVat === 'ZERO' ? 0 : inv.tax_amount;
  return inv.document_type === DOCUMENT_TYPE_SIMPLIFIED_INVOICE ? 0 : inv.tax_amount;
}

export interface ExpenseAmountInput {
  document_type: string | null;
  subtotal: number;
  total_amount: number;
  vat_treatment_override?: string | null;
}

/**
 * Economic "gasto" amount for a received invoice.
 * - vat_treatment_override resolves to an effect: that effect's expenseBasis
 *   decides — 'TOTAL' → total_amount, independent of document_type.
 * - Otherwise, SIMPLIFIED_INVOICE: total_amount (VAT is not deductible, so it
 *   becomes part of the real cost).
 * - Otherwise, FULL_INVOICE or NULL (legacy/unconfirmed): subtotal —
 *   identical to lib/economic-summary.ts's existing behavior for every
 *   received invoice today.
 */
export function getExpenseAmount(inv: ExpenseAmountInput): number {
  const effect = resolveVatTreatmentEffect(inv.vat_treatment_override);
  if (effect) return effect.expenseBasis === 'TOTAL' ? inv.total_amount : inv.subtotal;
  return inv.document_type === DOCUMENT_TYPE_SIMPLIFIED_INVOICE ? inv.total_amount : inv.subtotal;
}

export interface VatDeductibilitySplitInput {
  invoice_type: string; // 'issued' | 'received'
  document_type: string | null;
  vat_treatment_override?: string | null;
}

export interface VatDeductibilitySplit {
  deductible: number;
  nonDeductible: number;
}

/**
 * Splits a real, printed VAT amount (e.g. one rate-bucket's cuota_iva in
 * lib/iva-detalle.ts, or a whole invoice's tax_amount) into its deductible
 * and non-deductible portions. Used wherever a per-invoice or per-rate VAT
 * figure is surfaced in a fiscal report/export, so the same
 * SIMPLIFIED_INVOICE / vat_treatment_override rules from
 * getDeductibleInputVat() are never re-derived ad hoc — deductible +
 * nonDeductible always sums back to the original printed amount, so no data
 * is ever lost, only re-labeled. Only meaningful for received invoices — an
 * issued invoice's VAT is repercutido, never subject to a deductibility
 * question, regardless of document_type or vat_treatment_override.
 */
export function splitVatDeductibility(
  inv: VatDeductibilitySplitInput,
  printedVatAmount: number,
): VatDeductibilitySplit {
  const effect = resolveVatTreatmentEffect(inv.vat_treatment_override);
  const isNonDeductible =
    inv.invoice_type !== 'issued' &&
    (effect ? effect.deductibleVat === 'ZERO' : inv.document_type === DOCUMENT_TYPE_SIMPLIFIED_INVOICE);
  return isNonDeductible
    ? { deductible: 0, nonDeductible: printedVatAmount }
    : { deductible: printedVatAmount, nonDeductible: 0 };
}

export interface EffectiveFiscalPeriodInput {
  fiscal_period_year: number | null;
  fiscal_period_quarter: number | null;
  issue_date: Date;
}

/**
 * The fiscal period an invoice is actually declared under.
 * - Both fiscal_period_year/quarter set (default-from-creation OR manual
 *   override — both are equally authoritative once persisted): use them.
 * - Either is NULL (legacy row, never touched): fall back to the quarter
 *   issue_date naturally falls into — exactly today's behavior.
 */
export function getEffectiveFiscalPeriod(inv: EffectiveFiscalPeriodInput): { year: number; quarter: FiscalQuarter } {
  if (inv.fiscal_period_year != null && inv.fiscal_period_quarter != null) {
    return { year: inv.fiscal_period_year, quarter: inv.fiscal_period_quarter as FiscalQuarter };
  }
  return quarterOfDate(inv.issue_date);
}

/**
 * Prisma where-fragment: invoices whose EFFECTIVE fiscal period matches
 * (year, quarter) — either explicitly set to that period, or untouched
 * (fiscal_period_year IS NULL) and issue_date falls in the equivalent
 * [from, to] calendar range. Only meaningful for a genuine quarter query —
 * callers with an arbitrary (non-quarter-aligned) date range should keep
 * filtering on issue_date directly instead, since fiscal_period is only ever
 * expressed in (year, quarter) granularity.
 */
export function invoiceEffectivePeriodWhere(year: number, quarter: number, from: Date, to: Date) {
  return {
    OR: [
      { fiscal_period_year: year, fiscal_period_quarter: quarter },
      { fiscal_period_year: null, issue_date: { gte: from, lte: to } },
    ],
  };
}
