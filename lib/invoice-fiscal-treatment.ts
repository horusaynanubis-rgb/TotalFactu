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

export interface DeductibleVatInput {
  document_type: string | null;
  tax_amount: number;
}

/**
 * Deductible input VAT for a received invoice.
 * - SIMPLIFIED_INVOICE (human-confirmed): 0 — no recipient tax-id identification,
 *   the printed VAT is not legally deductible.
 * - FULL_INVOICE or document_type NULL (legacy/unconfirmed): tax_amount,
 *   unchanged from today's behavior.
 * The original tax_amount/tax_rate/subtotal/total_amount are NEVER mutated —
 * this is a read-time derivation only.
 */
export function getDeductibleInputVat(inv: DeductibleVatInput): number {
  return inv.document_type === DOCUMENT_TYPE_SIMPLIFIED_INVOICE ? 0 : inv.tax_amount;
}

export interface ExpenseAmountInput {
  document_type: string | null;
  subtotal: number;
  total_amount: number;
}

/**
 * Economic "gasto" amount for a received invoice.
 * - SIMPLIFIED_INVOICE: total_amount (VAT is not deductible, so it becomes
 *   part of the real cost).
 * - FULL_INVOICE or NULL (legacy/unconfirmed): subtotal — identical to
 *   lib/economic-summary.ts's existing behavior for every received invoice today.
 */
export function getExpenseAmount(inv: ExpenseAmountInput): number {
  return inv.document_type === DOCUMENT_TYPE_SIMPLIFIED_INVOICE ? inv.total_amount : inv.subtotal;
}

export interface VatDeductibilitySplitInput {
  invoice_type: string; // 'issued' | 'received'
  document_type: string | null;
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
 * SIMPLIFIED_INVOICE rule from getDeductibleInputVat() is never re-derived
 * ad hoc — deductible + nonDeductible always sums back to the original
 * printed amount, so no data is ever lost, only re-labeled.
 */
export function splitVatDeductibility(
  inv: VatDeductibilitySplitInput,
  printedVatAmount: number,
): VatDeductibilitySplit {
  const isNonDeductible = inv.invoice_type !== 'issued' && inv.document_type === DOCUMENT_TYPE_SIMPLIFIED_INVOICE;
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
