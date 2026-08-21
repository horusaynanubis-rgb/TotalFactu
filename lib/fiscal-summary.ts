// Aggregates Invoice data into "resumen_fiscal.csv" — informational quarterly
// fiscal summary used both standalone (company "Fiscal" export) and inside the
// "Paquete trimestral" ZIP. No existing helper computes this breakdown —
// lib/csv-generator.ts only emits a flat per-invoice CSV.
import { prisma } from './prisma';
import { getInvoiceFiscalBreakdown } from './fiscal-breakdown';

const CSV_DELIMITER = ';';
// Sentinel for "rate outside 0/4/10/21" (IGIC/IPSI, OCR artifact) — distinct
// from `null` ("sin clasificar"). See lib/fiscal-breakdown.ts otherBase/otherVat.
const OTHER_RATE = -1;
const STANDARD_RATE_SORT_CEILING = 999; // sorts OTHER_RATE after 21%, before "sin clasificar"

export interface MonthlyTotals {
  month: string; // YYYY-MM
  ventas: number;
  compras: number;
}

// rate === null bucket = "sin clasificar" — only invoices where no source
// (line rate, header rate, or a base+cuota calculation) identifies a rate,
// or where lines disagree and the split can't be reconciled against header
// totals. Invoices with multiple line-level rates are otherwise split across
// the corresponding 0/4/10/21 rows — see lib/fiscal-breakdown.ts. rate ===
// OTHER_RATE (-1, rendered "Otro tipo (no estándar)") is a rate outside
// 0/4/10/21 (IGIC/IPSI, or an extraction artifact) — kept separate so it's
// never silently folded into "sin clasificar" or a wrong standard bucket.
export interface RateBreakdown {
  rate: number | null;
  ventasBase: number;
  ventasIva: number;
  ventasCount: number;
  comprasBase: number;
  comprasIva: number;
  comprasCount: number;
}

export interface CajaTotals {
  cash: number;
  card: number;
  bizum: number;
  transfer: number;
  other: number;
  total: number;
}

export interface FiscalSummary {
  periodLabel: string;
  monthly: MonthlyTotals[];
  rates: RateBreakdown[];
  totalVentas: number;
  totalCompras: number;
  totalBaseImponible: number;
  ivaRepercutido: number; // IVA de ventas (solo facturas emitidas — ver nota caja/TPV)
  ivaSoportado: number;   // IVA de compras
  resultadoOrientativo: number; // ivaRepercutido - ivaSoportado
  sinClasificarVentasCount: number;
  sinClasificarComprasCount: number;
  // Live-computed via lib/fiscal-breakdown.ts (getInvoiceFiscalBreakdown),
  // not read from the persisted Invoice.fiscal_status column — this is the
  // one place that decides the count, so it can never drift from what the
  // rest of this summary shows. Independent of processing_status/review_status.
  fiscalStatusCounts: {
    classified: number;
    pendingClassification: number;
    mixedVat: number;
    manualReview: number;
  };
  caja: CajaTotals;
  control: {
    totalFacturasEmitidas: number;
    totalCajaTpv: number;
    diferencia: number;
  };
}

export interface SpecialExpenseEntry {
  label: string;
  count: number;
}

export async function buildFiscalSummary(
  companyId: string,
  from: Date,
  to: Date,
  periodLabel: string,
): Promise<FiscalSummary> {
  const [invoices, cajaRegisters] = await Promise.all([
    prisma.invoice.findMany({
      where: { company_id: companyId, issue_date: { gte: from, lte: to } },
      select: {
        invoice_type: true,
        issue_date: true,
        subtotal: true,
        tax_amount: true,
        total_amount: true,
        tax_rate: true,
        ai_vat_breakdown: true,
        vat_reclassification_attempted: true,
        invoice_lines: { select: { tax_rate: true, total_amount: true } },
      },
    }),
    prisma.dailyCashRegister.findMany({
      where: { company_id: companyId, date: { gte: from, lte: to }, status: 'confirmed' },
      select: { cash_amount: true, card_amount: true, bizum_amount: true, transfer_amount: true, other_amount: true, total_amount: true },
    }),
  ]);

  const monthlyMap = new Map<string, { ventas: number; compras: number }>();
  const rateMap = new Map<number | null, { ventasBase: number; ventasIva: number; ventasCount: number; comprasBase: number; comprasIva: number; comprasCount: number }>();
  let totalVentas = 0;
  let totalCompras = 0;
  let totalBaseImponible = 0;
  let ivaRepercutido = 0;
  let ivaSoportado = 0;
  let sinClasificarVentasCount = 0;
  let sinClasificarComprasCount = 0;
  const fiscalStatusCounts = { classified: 0, pendingClassification: 0, mixedVat: 0, manualReview: 0 };

  for (const inv of invoices) {
    // Single fiscal source of truth for every exporter — see lib/fiscal-breakdown.ts.
    const breakdown = getInvoiceFiscalBreakdown({
      tax_rate: inv.tax_rate,
      subtotal: inv.subtotal,
      tax_amount: inv.tax_amount,
      total_amount: inv.total_amount,
      invoice_lines: inv.invoice_lines,
      ai_vat_breakdown: inv.ai_vat_breakdown,
      vat_reclassification_attempted: inv.vat_reclassification_attempted,
    });

    if (breakdown.classificationStatus === 'classified') fiscalStatusCounts.classified++;
    else if (breakdown.classificationStatus === 'mixed_vat') fiscalStatusCounts.mixedVat++;
    else if (breakdown.classificationStatus === 'manual_review') fiscalStatusCounts.manualReview++;
    else fiscalStatusCounts.pendingClassification++;

    const isVenta = inv.invoice_type === 'issued';
    const monthKey = `${inv.issue_date.getFullYear()}-${String(inv.issue_date.getMonth() + 1).padStart(2, '0')}`;
    const m = monthlyMap.get(monthKey) ?? { ventas: 0, compras: 0 };
    if (isVenta) {
      m.ventas += inv.total_amount;
      totalVentas += inv.total_amount;
    } else {
      m.compras += inv.total_amount;
      totalCompras += inv.total_amount;
    }
    monthlyMap.set(monthKey, m);

    // Expand the breakdown's fixed buckets into the rate rows this invoice
    // actually touches — mirrors the old per-entry loop, but now every
    // exporter (facturas.csv, detalle_iva.csv, this file) derives the same
    // buckets from the same function instead of re-deriving them.
    const rateEntries: { rate: number | null; base: number; iva: number }[] = [];
    if (breakdown.base0 !== 0 || breakdown.vat0 !== 0) rateEntries.push({ rate: 0, base: breakdown.base0, iva: breakdown.vat0 });
    if (breakdown.base4 !== 0 || breakdown.vat4 !== 0) rateEntries.push({ rate: 4, base: breakdown.base4, iva: breakdown.vat4 });
    if (breakdown.base10 !== 0 || breakdown.vat10 !== 0) rateEntries.push({ rate: 10, base: breakdown.base10, iva: breakdown.vat10 });
    if (breakdown.base21 !== 0 || breakdown.vat21 !== 0) rateEntries.push({ rate: 21, base: breakdown.base21, iva: breakdown.vat21 });
    if (breakdown.otherBase !== 0 || breakdown.otherVat !== 0) rateEntries.push({ rate: OTHER_RATE, base: breakdown.otherBase, iva: breakdown.otherVat });

    if (rateEntries.length === 0) {
      // Genuinely unclassified — never invent a split; the invoice's real
      // money still needs a home, so it goes in the "sin clasificar" row.
      if (isVenta) sinClasificarVentasCount++; else sinClasificarComprasCount++;
      rateEntries.push({ rate: null, base: inv.subtotal, iva: inv.tax_amount });
    }

    for (const entry of rateEntries) {
      const r = rateMap.get(entry.rate) ?? { ventasBase: 0, ventasIva: 0, ventasCount: 0, comprasBase: 0, comprasIva: 0, comprasCount: 0 };
      if (isVenta) {
        r.ventasBase += entry.base;
        r.ventasIva += entry.iva;
        r.ventasCount += 1;
      } else {
        r.comprasBase += entry.base;
        r.comprasIva += entry.iva;
        r.comprasCount += 1;
      }
      rateMap.set(entry.rate, r);
    }

    // IVA repercutido/soportado and base imponible totals always come from
    // the (trusted) header amounts, once per invoice — independent of how
    // many rate rows the breakdown above touched.
    if (isVenta) ivaRepercutido += inv.tax_amount; else ivaSoportado += inv.tax_amount;
    totalBaseImponible += inv.subtotal;
  }

  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  // Sort order: 0/4/10/21 ascending, then "otro tipo" (OTHER_RATE), then
  // "sin clasificar" (null) last.
  const sortKey = (rate: number | null) => (rate === null ? Infinity : rate === OTHER_RATE ? STANDARD_RATE_SORT_CEILING : rate);
  const rates = Array.from(rateMap.entries())
    .sort(([a], [b]) => sortKey(a) - sortKey(b))
    .map(([rate, v]) => ({ rate, ...v }));

  const caja: CajaTotals = cajaRegisters.reduce(
    (acc, r) => ({
      cash: acc.cash + Number(r.cash_amount),
      card: acc.card + Number(r.card_amount),
      bizum: acc.bizum + Number(r.bizum_amount),
      transfer: acc.transfer + Number(r.transfer_amount),
      other: acc.other + Number(r.other_amount),
      total: acc.total + Number(r.total_amount),
    }),
    { cash: 0, card: 0, bizum: 0, transfer: 0, other: 0, total: 0 },
  );

  return {
    periodLabel,
    monthly,
    rates,
    totalVentas,
    totalCompras,
    totalBaseImponible,
    ivaRepercutido,
    ivaSoportado,
    resultadoOrientativo: ivaRepercutido - ivaSoportado,
    sinClasificarVentasCount,
    sinClasificarComprasCount,
    fiscalStatusCounts,
    caja,
    control: {
      totalFacturasEmitidas: totalVentas,
      totalCajaTpv: caja.total,
      diferencia: caja.total - totalVentas,
    },
  };
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateResumenCSV(summary: FiscalSummary, specialExpenses?: SpecialExpenseEntry[]): string {
  const lines: string[] = [];

  lines.push(escapeCSV(`Resumen fiscal trimestral — ${summary.periodLabel}`));
  lines.push(escapeCSV('Documento informativo para revisión por la empresa o gestoría. No es la declaración oficial del Modelo 303.'));
  lines.push('');

  lines.push(['Mes', 'Ventas', 'Compras/Gastos'].join(CSV_DELIMITER));
  for (const m of summary.monthly) {
    lines.push([m.month, m.ventas.toFixed(2), m.compras.toFixed(2)].join(CSV_DELIMITER));
  }
  lines.push('');

  lines.push(escapeCSV('IVA repercutido (ventas) e IVA soportado (compras), desglosado por tipo. Solo incluye facturas — ver aviso Caja y Cobros más abajo sobre ingresos de Caja/TPV.'));
  lines.push([
    'Tipo IVA (%)', 'Base ventas', 'IVA ventas', 'Nº facturas venta', 'Base compras', 'IVA compras', 'Nº facturas compra',
  ].join(CSV_DELIMITER));
  for (const r of summary.rates) {
    const label = r.rate === null ? 'Sin clasificar' : r.rate === OTHER_RATE ? 'Otro tipo (no estándar)' : `${r.rate}%`;
    lines.push([
      label,
      r.ventasBase.toFixed(2), r.ventasIva.toFixed(2), String(r.ventasCount),
      r.comprasBase.toFixed(2), r.comprasIva.toFixed(2), String(r.comprasCount),
    ].join(CSV_DELIMITER));
  }
  lines.push('');

  lines.push(['Total ventas (facturas emitidas)', summary.totalVentas.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total compras/gastos', summary.totalCompras.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Base imponible total', summary.totalBaseImponible.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['IVA repercutido (ventas)', summary.ivaRepercutido.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['IVA soportado (compras)', summary.ivaSoportado.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Resultado orientativo (repercutido - soportado)', summary.resultadoOrientativo.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Facturas venta sin tipo de IVA clasificado', String(summary.sinClasificarVentasCount)].join(CSV_DELIMITER));
  lines.push(['Facturas compra sin tipo de IVA clasificado', String(summary.sinClasificarComprasCount)].join(CSV_DELIMITER));
  lines.push('');

  lines.push(escapeCSV('Clasificación fiscal (estado, no inventa reparto para lo pendiente)'));
  lines.push(['Clasificadas', 'Pendiente clasificación fiscal', 'IVA mixto sin resolver', 'Revisión manual'].join(CSV_DELIMITER));
  lines.push([
    String(summary.fiscalStatusCounts.classified),
    String(summary.fiscalStatusCounts.pendingClassification),
    String(summary.fiscalStatusCounts.mixedVat),
    String(summary.fiscalStatusCounts.manualReview),
  ].join(CSV_DELIMITER));
  if (summary.fiscalStatusCounts.manualReview > 0) {
    lines.push(escapeCSV(`${summary.fiscalStatusCounts.manualReview} factura(s) requieren revisión manual de la gestoría — ver manual_review.csv.`));
  }
  lines.push('');

  lines.push(escapeCSV('Caja y Cobros (TPV, efectivo, etc.) — total cobrado por método de pago en el periodo'));
  lines.push(['Efectivo', 'Tarjeta/TPV', 'Bizum', 'Transferencia', 'Otros', 'Total cobrado'].join(CSV_DELIMITER));
  lines.push([
    summary.caja.cash.toFixed(2), summary.caja.card.toFixed(2), summary.caja.bizum.toFixed(2),
    summary.caja.transfer.toFixed(2), summary.caja.other.toFixed(2), summary.caja.total.toFixed(2),
  ].join(CSV_DELIMITER));
  lines.push(escapeCSV('IVA no desglosado en el cierre TPV — el cierre de caja no registra el tipo de IVA por operación. El desglose de IVA (arriba) sale únicamente de facturas/tickets con tipo identificado.'));
  lines.push('');

  lines.push(escapeCSV('Control: Caja/TPV vs facturas emitidas'));
  lines.push(['Total facturas emitidas', 'Total Caja/TPV', 'Diferencia (Caja - Facturas)'].join(CSV_DELIMITER));
  lines.push([
    summary.control.totalFacturasEmitidas.toFixed(2),
    summary.control.totalCajaTpv.toFixed(2),
    summary.control.diferencia.toFixed(2),
  ].join(CSV_DELIMITER));
  lines.push(escapeCSV('Informativo — no corrige ni concilia automáticamente. En negocios donde el ingreso se registra vía Caja/TPV y no como factura emitida, esta diferencia es esperable.'));

  if (specialExpenses && specialExpenses.length > 0) {
    lines.push('');
    lines.push(escapeCSV('Gastos especiales (documentación complementaria)'));
    lines.push(['Categoría', 'Estado'].join(CSV_DELIMITER));
    for (const e of specialExpenses) {
      lines.push([
        escapeCSV(e.label),
        escapeCSV(e.count > 0 ? `Existe documentación complementaria para revisión (${e.count})` : 'Sin documentación'),
      ].join(CSV_DELIMITER));
    }
  }

  // UTF-8 BOM + CRLF — same convention as lib/csv-generator.ts
  return '﻿' + lines.join('\r\n');
}
