// Aggregates Invoice data into "resumen_fiscal.csv" — informational quarterly
// fiscal summary used both standalone (company "Fiscal" export) and inside the
// "Paquete trimestral" ZIP. No existing helper computes this breakdown —
// lib/csv-generator.ts only emits a flat per-invoice CSV.
import { prisma } from './prisma';
import { classifyInvoiceRate, IvaRateBreakdownEntry } from './iva-classification';

const CSV_DELIMITER = ';';

export interface MonthlyTotals {
  month: string; // YYYY-MM
  ventas: number;
  compras: number;
}

// rate === null bucket = "sin clasificar" — only invoices where no source
// (line rate, header rate, or a base+cuota calculation) identifies a rate,
// or where lines disagree and the split can't be reconciled against header
// totals. Invoices with multiple line-level rates are otherwise split across
// the corresponding 4/10/21 rows — see lib/iva-classification.ts.
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
  // Persisted Invoice.fiscal_status counts for the period — independent of
  // processing_status/review_status. See lib/fiscal-status.ts.
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
        fiscal_status: true,
        ai_vat_breakdown: true,
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
    if (inv.fiscal_status === 'classified') fiscalStatusCounts.classified++;
    else if (inv.fiscal_status === 'mixed_vat') fiscalStatusCounts.mixedVat++;
    else if (inv.fiscal_status === 'manual_review') fiscalStatusCounts.manualReview++;
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

    let aiBreakdown: IvaRateBreakdownEntry[] | null = null;
    if (inv.ai_vat_breakdown) {
      try { aiBreakdown = JSON.parse(inv.ai_vat_breakdown); } catch { aiBreakdown = null; }
    }
    const classification = classifyInvoiceRate(inv.tax_rate, inv.invoice_lines, inv.subtotal, inv.tax_amount, aiBreakdown);

    if (classification.breakdown) {
      // Invoice spans multiple rates (mixed lines reconciled, or a multi-rate
      // AI answer) — contribute base/cuota to each rate row it actually
      // touches instead of one "sin clasificar" bucket.
      for (const entry of classification.breakdown) {
        const rate = Math.round(entry.rate);
        const r = rateMap.get(rate) ?? { ventasBase: 0, ventasIva: 0, ventasCount: 0, comprasBase: 0, comprasIva: 0, comprasCount: 0 };
        if (isVenta) {
          r.ventasBase += entry.base;
          r.ventasIva += entry.iva;
          r.ventasCount += 1;
        } else {
          r.comprasBase += entry.base;
          r.comprasIva += entry.iva;
          r.comprasCount += 1;
        }
        rateMap.set(rate, r);
      }
    } else {
      const rate = classification.rate === null ? null : Math.round(classification.rate);
      if (rate === null) {
        if (isVenta) sinClasificarVentasCount++; else sinClasificarComprasCount++;
      }
      const r = rateMap.get(rate) ?? { ventasBase: 0, ventasIva: 0, ventasCount: 0, comprasBase: 0, comprasIva: 0, comprasCount: 0 };
      if (isVenta) {
        r.ventasBase += inv.subtotal;
        r.ventasIva += inv.tax_amount;
        r.ventasCount += 1;
      } else {
        r.comprasBase += inv.subtotal;
        r.comprasIva += inv.tax_amount;
        r.comprasCount += 1;
      }
      rateMap.set(rate, r);
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

  const rates = Array.from(rateMap.entries())
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
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
    lines.push([
      r.rate === null ? 'Sin clasificar' : `${r.rate}%`,
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
