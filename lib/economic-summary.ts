// "Resumen económico" — Ingresos / Gastos / Resultado estimado for a period.
//
// Root finding this encodes (auditoría read-only previa a esta feature): a
// company that sells mostly through TPV (e.g. BYOU) issues almost no
// "facturas emitidas" — its real income lives in DailyCashRegister, which is
// gross (VAT-included) and has no VAT breakdown anywhere in the pipeline
// (manual entry, AI Z-report extraction, and the bespoke Excel parsers all
// lack a tax field). Meanwhile expenses (facturas recibidas) are net
// (sin IVA). Subtracting one from the other would mix incompatible bases, so
// when TPV data exists for the period we deliberately do NOT compute a
// Resultado/Margen — see buildEconomicSummaryFromData below.
//
// There is also no reconciliation between Invoice and DailyCashRegister (see
// the "Próximamente: conciliación automática..." placeholder already in
// app/(dashboard)/dashboard/caja-cobros/page.tsx), so issued invoices are
// never summed into TPV income — doing so risks double-counting a sale that
// already went through the till and was separately invoiced on request.
//
// This module is intentionally split into a pure function (testable without
// a DB, mirrors lib/fiscal-breakdown.ts's style) and a thin Prisma-backed
// wrapper — same separation as lib/fiscal-summary.ts.
import { prisma } from './prisma';

export type IncomeSource = 'tpv' | 'invoices';

// Distinguishes "the period genuinely has a zero result" from "we don't have
// enough data to say" — see aclaración 2 of the approved spec.
//   no_data     — nothing at all recorded in the period (no invoices, no cash registers).
//   insufficient— some data exists in the period, but not enough on the income
//                 side specifically (income source is invoices and there are
//                 zero eligible issued invoices) to trust ingresos as a real figure.
//   available   — at least one eligible entry feeds ingresos; the numbers can be trusted.
export type DataStatus = 'available' | 'no_data' | 'insufficient';

export interface EconomicInvoiceInput {
  invoice_type: string; // 'issued' | 'received'
  subtotal: number;
  currency: string;
  fiscal_status: string; // 'classified' | 'pending_classification' | 'mixed_vat' | 'manual_review'
  gestoria_review_status: string | null;
}

export interface EconomicCashRegisterInput {
  total_amount: number;
  status: string; // 'confirmed' | 'pending_review'
}

export interface EconomicSummaryInput {
  periodLabel: string;
  invoices: EconomicInvoiceInput[];
  cashRegisters: EconomicCashRegisterInput[];
}

export interface ExclusionCounts {
  manualReview: number;
  gestoriaIssue: number;
  nonEur: number;
}

export interface InformativeIssuedInvoices {
  total: number;
  count: number;
}

export interface EconomicSummary {
  periodLabel: string;
  incomeSource: IncomeSource;
  dataStatus: DataStatus;
  ingresos: number;
  ingresosLabel: string;
  gastos: number;
  gastosLabel: string;
  resultado: number | null;
  margen: number | null; // percentage points, e.g. 12.5 means 12.5%
  facturasEmitidasInformativas: InformativeIssuedInvoices | null;
  counts: {
    ingresosCount: number;
    gastosCount: number;
    unconfirmedByGestoria: number;
    pendingCashRegisters: number;
    excluded: ExclusionCounts;
  };
  disclaimer: string;
}

const METHODOLOGY_DISCLAIMER_INVOICES =
  'Resultado estimado a partir de las facturas registradas en TotalFactu. No representa el cierre contable definitivo.';

const METHODOLOGY_DISCLAIMER_TPV =
  'Resultado no disponible: las ventas registradas incluyen IVA y los gastos se muestran sin IVA — no son directamente comparables.';

// Real exclusion reasons — never "no ha sido revisada por gestoría todavía"
// (that's tracked separately as unconfirmedByGestoria, informational only;
// absence of human review must never be read as confirmation, but it is also
// not, by itself, a reason to drop a real invoice from the totals).
function exclusionReason(inv: EconomicInvoiceInput): keyof ExclusionCounts | null {
  if (inv.currency !== 'EUR') return 'nonEur';
  if (inv.fiscal_status === 'manual_review') return 'manualReview';
  if (inv.gestoria_review_status === 'reviewed_issue') return 'gestoriaIssue';
  return null;
}

function isGestoriaConfirmed(inv: EconomicInvoiceInput): boolean {
  return inv.gestoria_review_status === 'reviewed_ok';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure aggregation — no I/O. Callers pass already-fetched rows for the
 * period; see buildEconomicSummary() below for the Prisma-backed wrapper.
 */
export function buildEconomicSummaryFromData(input: EconomicSummaryInput): EconomicSummary {
  const { periodLabel, invoices, cashRegisters } = input;

  const confirmedRegisters = cashRegisters.filter((r) => r.status === 'confirmed');
  const pendingCashRegisters = cashRegisters.length - confirmedRegisters.length;
  const hasConfirmedTpv = confirmedRegisters.length > 0;
  // The mere existence of DailyCashRegister rows in the period proves TPV is
  // this company's economic source — even if none of them are confirmed yet,
  // that is a data-quality gap, not evidence that the business has no TPV.
  // Falling back to 'invoices' in that case would silently understate income
  // for a TPV-driven business (see dataStatus below, which flags this as
  // 'insufficient' rather than trusting either number).
  const hasAnyTpv = cashRegisters.length > 0;
  const incomeSource: IncomeSource = hasAnyTpv ? 'tpv' : 'invoices';

  const excluded: ExclusionCounts = { manualReview: 0, gestoriaIssue: 0, nonEur: 0 };
  const eligibleIssued: EconomicInvoiceInput[] = [];
  const eligibleReceived: EconomicInvoiceInput[] = [];

  for (const inv of invoices) {
    const reason = exclusionReason(inv);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    if (inv.invoice_type === 'issued') eligibleIssued.push(inv);
    else eligibleReceived.push(inv);
  }

  const issuedTotal = round2(eligibleIssued.reduce((s, i) => s + i.subtotal, 0));
  const receivedTotal = round2(eligibleReceived.reduce((s, i) => s + i.subtotal, 0));
  const tpvTotal = round2(confirmedRegisters.reduce((s, r) => s + r.total_amount, 0));

  const gastos = receivedTotal;
  const gastosLabel = incomeSource === 'tpv' ? 'Gastos registrados (sin IVA)' : 'Gastos (sin IVA)';

  let ingresos: number;
  let ingresosLabel: string;
  let ingresosCount: number;
  let facturasEmitidasInformativas: InformativeIssuedInvoices | null;
  let resultado: number | null;
  let margen: number | null;
  let disclaimer: string;

  if (incomeSource === 'tpv') {
    ingresos = tpvTotal;
    ingresosLabel = 'Ventas registradas (IVA incluido)';
    ingresosCount = confirmedRegisters.length;
    facturasEmitidasInformativas = { total: issuedTotal, count: eligibleIssued.length };
    // Never subtract gross TPV income from net expenses — see module header.
    resultado = null;
    margen = null;
    disclaimer = METHODOLOGY_DISCLAIMER_TPV;
  } else {
    ingresos = issuedTotal;
    ingresosLabel = 'Ingresos (sin IVA)';
    ingresosCount = eligibleIssued.length;
    facturasEmitidasInformativas = null;
    resultado = round2(ingresos - gastos);
    margen = ingresos !== 0 ? round2((resultado / ingresos) * 100) : null;
    disclaimer = METHODOLOGY_DISCLAIMER_INVOICES;
  }

  // unconfirmedByGestoria only counts invoices that actually feed a computed
  // total: received invoices always (gastos), issued invoices only when they
  // feed ingresos (i.e. incomeSource === 'invoices') — the informational
  // issued-invoices line under TPV mode is not "a total", so it is not mixed
  // into this provisionality counter.
  const invoicesFeedingTotals = incomeSource === 'tpv' ? eligibleReceived : [...eligibleIssued, ...eligibleReceived];
  const unconfirmedByGestoria = invoicesFeedingTotals.filter((inv) => !isGestoriaConfirmed(inv)).length;

  // Distinguishes "no issued invoices were ever recorded this period" (a real,
  // trustworthy zero) from "issued invoices existed but every one of them got
  // excluded" (the 0 is an artifact of filtering, not a business fact) — see
  // module header and the audit finding this fixes.
  const rawIssuedCount = invoices.filter((inv) => inv.invoice_type === 'issued').length;

  let dataStatus: DataStatus;
  if (invoices.length === 0 && cashRegisters.length === 0) {
    dataStatus = 'no_data';
  } else if (incomeSource === 'tpv') {
    dataStatus = hasConfirmedTpv ? 'available' : 'insufficient';
  } else if (rawIssuedCount === 0 || eligibleIssued.length > 0) {
    dataStatus = 'available';
  } else {
    dataStatus = 'insufficient';
  }

  return {
    periodLabel,
    incomeSource,
    dataStatus,
    ingresos,
    ingresosLabel,
    gastos,
    gastosLabel,
    resultado,
    margen,
    facturasEmitidasInformativas,
    counts: {
      ingresosCount,
      gastosCount: eligibleReceived.length,
      unconfirmedByGestoria,
      pendingCashRegisters,
      excluded,
    },
    disclaimer,
  };
}

export async function buildEconomicSummary(
  companyId: string,
  from: Date,
  to: Date,
  periodLabel: string,
): Promise<EconomicSummary> {
  const [invoices, cashRegisters] = await Promise.all([
    prisma.invoice.findMany({
      where: { company_id: companyId, issue_date: { gte: from, lte: to } },
      select: {
        invoice_type: true,
        subtotal: true,
        currency: true,
        fiscal_status: true,
        gestoria_review_status: true,
      },
    }),
    prisma.dailyCashRegister.findMany({
      where: { company_id: companyId, date: { gte: from, lte: to } },
      select: { total_amount: true, status: true },
    }),
  ]);

  return buildEconomicSummaryFromData({
    periodLabel,
    invoices,
    cashRegisters: cashRegisters.map((r) => ({ total_amount: Number(r.total_amount), status: r.status })),
  });
}
