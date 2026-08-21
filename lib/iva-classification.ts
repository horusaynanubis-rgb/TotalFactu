// Shared IVA-rate classification for an invoice, used by both
// lib/fiscal-summary.ts (aggregate rate breakdown) and lib/iva-detalle.ts
// (per-invoice detail listing) so the two never disagree on which bucket an
// invoice falls into.
//
// Why this exists: Invoice.tax_rate (header) is frequently null on
// OCR-extracted invoices. Classification order (most to least trusted):
//   1. InvoiceLine.tax_rate, when every line agrees on one rate, OR when
//      lines disagree and a per-rate split can be reconciled (see below).
//   2. Invoice.tax_rate (header) — this already IS the OCR/Gemini result for
//      the document: extraction is never persisted separately from the
//      Invoice/InvoiceLine rows (lib/ai-extraction.ts writes nothing else),
//      so there is no distinct "raw OCR" or "raw Gemini" source to fall back
//      to beyond these two fields.
//   3. Calculated from header subtotal + tax_amount, when the implied rate
//      lands close to a standard Spanish VAT rate (0/4/10/21).
//   4. Unclassified — only when none of the above identify a rate.
//
// Mixed-rate invoices (lines with >=2 distinct tax_rate values): rather than
// dumping the whole invoice into "sin clasificar", split base/cuota per rate
// from the line amounts. Line InvoiceLine.total_amount is NOT consistently
// net-of-tax vs gross-of-tax across documents (depends on what the source
// invoice printed / how Gemini read it), so we try both interpretations and
// keep whichever one reconciles with the (trusted) header subtotal/tax_amount
// within rounding tolerance. If neither reconciles, the split is not
// trustworthy and the invoice falls through to "unclassified" rather than
// guessing.
//
// aiBreakdown (5th param): result of the one-shot VAT-only Gemini micro pass
// (lib/ai-extraction.ts extractVatBreakdown, persisted to
// Invoice.ai_vat_breakdown by the gestoria "Reprocesar pendientes" action).
// Only ever populated for invoices where every local signal above failed —
// so it's checked FIRST: no local source could contradict it, and re-running
// the same local logic on every read would be wasted work.
export type IvaClassificationSource = 'ai-vat' | 'header' | 'lines' | 'calc' | 'lines-split' | 'unclassified';

export interface IvaLineInput {
  tax_rate: number | null | undefined;
  total_amount: number | null | undefined;
}

export interface IvaRateBreakdownEntry {
  rate: number;
  base: number;
  iva: number;
}

export interface IvaClassification {
  rate: number | null; // null = sin clasificar, or split across multiple rates (see breakdown)
  source: IvaClassificationSource;
  breakdown?: IvaRateBreakdownEntry[]; // present whenever the invoice spans multiple rates (source 'lines-split' or 'ai-vat')
  unclassifiedReason?: 'no-data' | 'multi-rate-unreconciled';
}

const STANDARD_RATES = [0, 4, 10, 21];
const CALC_TOLERANCE_POINTS = 0.6; // percentage points, header calc vs nearest standard rate
const SPLIT_RECONCILE_TOLERANCE_EUR = 0.15; // absolute EUR, allows cent-rounding across many lines

// Defensive normalization for a known OCR/extraction defect: a rate stored as
// a fraction (0.1) instead of a percentage (10). Spanish VAT only has
// 0/4/10/21 — any non-zero rate strictly between -1 and 1 is unambiguously a
// fraction-vs-percentage mixup, never a real rate. Confirmed in production
// (auditoría 2026-07-15): Invoice.tax_rate = 0.1 on a BYOU Q2 invoice that
// should have been 10 — silently classified as ~0% before this fix.
function normalizeRatePercent(rate: number | null | undefined): number | null | undefined {
  if (rate === null || rate === undefined) return rate;
  if (rate !== 0 && Math.abs(rate) < 1) return rate * 100;
  return rate;
}

function splitByInterpretation(lines: IvaLineInput[], lineIsNetBase: boolean): IvaRateBreakdownEntry[] {
  const byRate = new Map<number, IvaRateBreakdownEntry>();
  for (const l of lines) {
    if (l.tax_rate === null || l.tax_rate === undefined || l.total_amount === null || l.total_amount === undefined) continue;
    const rate = l.tax_rate;
    const base = lineIsNetBase ? l.total_amount : l.total_amount / (1 + rate / 100);
    const iva = base * (rate / 100);
    const entry = byRate.get(rate) ?? { rate, base: 0, iva: 0 };
    entry.base += base;
    entry.iva += iva;
    byRate.set(rate, entry);
  }
  return Array.from(byRate.values()).sort((a, b) => a.rate - b.rate);
}

function reconciles(breakdown: IvaRateBreakdownEntry[], headerSubtotal: number, headerTaxAmount: number): boolean {
  const base = breakdown.reduce((s, e) => s + e.base, 0);
  const iva = breakdown.reduce((s, e) => s + e.iva, 0);
  return (
    Math.abs(base - headerSubtotal) <= SPLIT_RECONCILE_TOLERANCE_EUR &&
    Math.abs(iva - headerTaxAmount) <= SPLIT_RECONCILE_TOLERANCE_EUR
  );
}

export function classifyInvoiceRate(
  headerTaxRate: number | null | undefined,
  lines: IvaLineInput[],
  headerSubtotal: number,
  headerTaxAmount: number,
  aiBreakdown?: IvaRateBreakdownEntry[] | null,
): IvaClassification {
  // 0. Already resolved by the VAT-only Gemini micro pass in a previous
  // request — this is the final answer, nothing below can override it.
  if (aiBreakdown && aiBreakdown.length > 0) {
    return aiBreakdown.length === 1
      ? { rate: aiBreakdown[0].rate, source: 'ai-vat' }
      : { rate: null, source: 'ai-vat', breakdown: aiBreakdown };
  }

  headerTaxRate = normalizeRatePercent(headerTaxRate);
  lines = lines.map((l) => ({ ...l, tax_rate: normalizeRatePercent(l.tax_rate) }));

  const distinctLineRates = Array.from(
    new Set(lines.map((l) => l.tax_rate).filter((r): r is number => r !== null && r !== undefined)),
  );

  // 1a. Lines disagree on rate -> try to split base/cuota per rate, trusting
  // whichever line-amount interpretation reconciles with header totals.
  if (distinctLineRates.length >= 2) {
    const asNet = splitByInterpretation(lines, true);
    if (reconciles(asNet, headerSubtotal, headerTaxAmount)) {
      return { rate: null, source: 'lines-split', breakdown: asNet };
    }
    const asGross = splitByInterpretation(lines, false);
    if (reconciles(asGross, headerSubtotal, headerTaxAmount)) {
      return { rate: null, source: 'lines-split', breakdown: asGross };
    }
    return { rate: null, source: 'unclassified', unclassifiedReason: 'multi-rate-unreconciled' };
  }

  // 1b. Every line (that has a rate) agrees on one rate.
  if (distinctLineRates.length === 1) {
    return { rate: distinctLineRates[0], source: 'lines' };
  }

  // 2. Header tax_rate.
  if (headerTaxRate !== null && headerTaxRate !== undefined) {
    return { rate: headerTaxRate, source: 'header' };
  }

  // 3. Calculate from base + cuota when both are known and land close to a
  // standard rate.
  if (headerSubtotal !== 0) {
    const impliedPct = (headerTaxAmount / headerSubtotal) * 100;
    let nearestRate = STANDARD_RATES[0];
    let nearestDiff = Math.abs(impliedPct - nearestRate);
    for (const r of STANDARD_RATES.slice(1)) {
      const diff = Math.abs(impliedPct - r);
      if (diff < nearestDiff) {
        nearestRate = r;
        nearestDiff = diff;
      }
    }
    if (nearestDiff <= CALC_TOLERANCE_POINTS) {
      return { rate: nearestRate, source: 'calc' };
    }
  }

  return { rate: null, source: 'unclassified', unclassifiedReason: 'no-data' };
}

export function ivaClassificationObservation(c: IvaClassification): string {
  switch (c.source) {
    case 'header':
      return '';
    case 'ai-vat':
      return c.breakdown
        ? 'Desglose de IVA obtenido mediante verificación adicional con IA (varios tipos)'
        : 'Tipo de IVA obtenido mediante verificación adicional con IA';
    case 'lines':
      return 'Tipo de IVA inferido desde las líneas de factura (cabecera sin tipo)';
    case 'calc':
      return 'Tipo de IVA calculado a partir de base imponible y cuota (cabecera y líneas sin tipo) — revisar si es posible';
    case 'lines-split':
      return 'Factura con varias líneas a distintos tipos de IVA — repartida automáticamente por tipo (ver detalle por línea)';
    case 'unclassified':
      return c.unclassifiedReason === 'multi-rate-unreconciled'
        ? 'Líneas con varios tipos de IVA pero los importes no cuadran con la cabecera — revisar factura manualmente'
        : 'Sin tipo de IVA en cabecera y sin líneas de detalle — revisar factura';
  }
}
